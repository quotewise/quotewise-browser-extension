/**
 * Chrome extension service worker
 * Handles extension lifecycle, messaging, and background tasks
 *
 * MV3 Resilience: Service workers can be terminated at any time.
 * All services are lazily initialized on demand via ensureServicesInitialized().
 */

import { MessageType, type ExtensionMessage, type CapturedPostData, type CapturePlatform } from '../types/index';
import { DEFAULT_SETTINGS, type Settings } from '../types/chrome';
import { initializeApiHandler } from './api-handler';
import { AuthenticationMonitor } from './auth-monitor';
import { initializeStorageCleanup, STORAGE_CLEANUP_ALARM } from './storage-cleanup';
import { validateCapturedPostData, ValidationError } from '../utils/validators';
import { debugLog, getWebBaseUrl } from '../config/environment';
import { initializeTokenRefresh, handleTokenRefreshAlarm } from '../auth/token-refresh';
import { initiateOAuthFlow } from '../auth/auth-flow';
import {
  initializeAuthStateManager,
  AuthStateManager,
  setAuthPresentationUpdater,
} from '../auth/auth-state-manager';
import { AuthState } from '../auth/auth-state-machine';
import { ICON_STATES } from '../config/icon-states';
import { applyIconPresentation } from './icon-applicator';
import { resolveIconPresentation, type IconPresentation } from './icon-state-resolver';
import type { DuplicateCheckResult, PreflightOriginatorResult } from '../types/api';
import type { CollectionBadgeInfo } from '../types/chrome';
import { clearUserDataCaches, logoutAndClearUserData } from './privacy-cleanup';
import { getSettings, onSettingsChanged } from '../settings/settings-store';
import { buildFeedbackUrl } from '../utils/feedback-url';
import {
  captureAuthorHandle,
  captureIdentityFromData,
  captureIdentityFromUrl,
  capturePlatform,
  captureSourceId,
  captureSourceUrl,
  isSameCaptureUrl,
  isSupportedPermalinkUrl,
  isSupportedPlatformUrl as isSupportedCapturePlatformUrl,
  PLATFORM_DEFINITIONS,
} from '../platforms/capture';
import {
  recordDiagnosticTimingEvent,
  recordExtractionDiagnostic,
  recordPreflightDiagnostic,
  summarizeDuplicateResult,
  summarizeOriginatorResult,
  summarizeHandleLookupResult,
  duplicateResultFromResponse,
  errorMessage,
  getRuntimeDiagnostics,
  type DiagnosticTrigger,
  type DiagnosticTimingEvent,
  type MissingOriginatorInfo,
  type RuntimeDiagnostics,
  type RuntimeDiagnosticsContext,
} from './diagnostics';

// Service instances - lazily initialized to handle MV3 service worker termination
let apiHandler: ReturnType<typeof initializeApiHandler> | null = null;
let authMonitor: AuthenticationMonitor | null = null;
let storageCleanup: ReturnType<typeof initializeStorageCleanup> | null = null;
let authStateManager: AuthStateManager | null = null;

// Track initialization state
let servicesInitialized = false;

// Track in-flight duplicate check requests to prevent race conditions
const pendingDuplicateChecks = new Map<string, Promise<void>>();
const tabDuplicateResults = new Map<number, DuplicateCheckResult | null>();
const tabDuplicateResultUrls = new Map<number, string>();
const tabMissingOriginators = new Map<number, MissingOriginatorInfo>();
const tabInFlightOperations = new Map<number, InFlightIconOperation>();
const tabScopedPresentationTabIds = new Set<number>();
let lastActiveTabId: number | null = null;
let userDataWriteEpoch = 0;
let logoutInProgress = false;
let currentSettings: Settings = { ...DEFAULT_SETTINGS };
let unsubscribeSettingsChanged: (() => void) | null = null;

// Service worker startup is logged once after initialization completes

const CONTENT_SCRIPT_FILE = 'content/index.js';
const MISSING_CONTENT_SCRIPT_MESSAGE = 'Receiving end does not exist';
const WEB_NAVIGATION_PLATFORM_FILTERS = Object.values(PLATFORM_DEFINITIONS)
  .flatMap(definition => definition.hostSuffixes)
  .map(hostSuffix => ({ hostSuffix }));
const PRELOADED_DUPLICATE_MAX_AGE_MS = 60_000;
const TWEET_EXTRACTION_RETRY_DELAYS_MS = [1_000, 2_500, 5_000] as const;
const AUTOMATIC_PREFLIGHT_TIMEOUT_MS = 8_000;
const AUTOMATIC_ORIGINATOR_PROBE_DELAY_MS = 300;
const ORIGINATOR_FALLBACK_TIMEOUT_MS = 3_000;
const AUTOMATIC_PREFLIGHT_KEEPALIVE_MS = AUTOMATIC_PREFLIGHT_TIMEOUT_MS + ORIGINATOR_FALLBACK_TIMEOUT_MS + 1_000;
const PREFLIGHT_OPERATION_STORAGE_KEY = 'automaticPreflightOperations';
const PREFLIGHT_TIMEOUT_ALARM_PREFIX = 'automatic-preflight-timeout:';

interface InFlightIconOperation {
  tabId: number;
  url: string;
  platform?: CapturePlatform;
  statusId: string;
  operationId: string;
  trigger: DiagnosticTrigger;
  startedAt: number;
  timeoutAt?: number;
  handle?: string;
  cacheWriteEpoch?: number;
}

const tweetExtractionRetryTimers = new Map<number, ReturnType<typeof setTimeout>>();
const automaticTweetExtractionRequests = new Map<string, Promise<void>>();
const automaticOriginatorProbeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function isTweetPageUrl(url?: string): boolean {
  return isSupportedPermalinkUrl(url);
}

function isSupportedPlatformUrl(url?: string): boolean {
  return isSupportedCapturePlatformUrl(url);
}

function markUserDataWipe(): void {
  userDataWriteEpoch += 1;
}

function canWriteUserIdentifyingCache(epoch: number | undefined): boolean {
  if (logoutInProgress) {
    return false;
  }

  if (epoch !== undefined && epoch !== userDataWriteEpoch) {
    return false;
  }

  return !authStateManager || authStateManager.isAuthenticated();
}

function isPrivateModeEnabled(): boolean {
  return currentSettings.privateMode;
}

function tweetStatusId(url?: string): string | null {
  return captureIdentityFromUrl(url)?.sourceId ?? null;
}

function automaticTweetOperationKey(tabId: number | undefined, url?: string): string | null {
  const identity = captureIdentityFromUrl(url);
  return tabId !== undefined && identity ? `${tabId}:${identity.platform}:${identity.sourceId}` : null;
}

function automaticPreflightCacheKey(tabId: number | undefined, url: string): string {
  return automaticTweetOperationKey(tabId, url) ?? url;
}

function isSameTweetPageUrl(expectedUrl?: string, currentUrl?: string): boolean {
  return isSameCaptureUrl(expectedUrl, currentUrl);
}

function isExtractedTweetDataForUrl(data: unknown, url?: string): boolean {
  const expected = captureIdentityFromUrl(url);
  const actual = captureIdentityFromData(data);

  return expected === null ||
    actual === null ||
    (expected.platform === actual.platform && expected.sourceId === actual.sourceId);
}

function createOperationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function preflightTimeoutAlarmName(operation: InFlightIconOperation): string {
  return `${PREFLIGHT_TIMEOUT_ALARM_PREFIX}${operation.tabId}:${operation.operationId}`;
}

function automaticOriginatorProbeKey(operation: InFlightIconOperation): string {
  return `${operation.tabId}:${operation.operationId}`;
}

function clearAutomaticOriginatorProbeTimer(operation: InFlightIconOperation): void {
  const key = automaticOriginatorProbeKey(operation);
  const timer = automaticOriginatorProbeTimers.get(key);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  automaticOriginatorProbeTimers.delete(key);
}

function hasAutomaticOriginatorProbeTimer(operation: InFlightIconOperation | null): boolean {
  return operation !== null && automaticOriginatorProbeTimers.has(automaticOriginatorProbeKey(operation));
}

function parsePreflightTimeoutAlarmName(name: string): { tabId: number; operationId: string } | null {
  if (!name.startsWith(PREFLIGHT_TIMEOUT_ALARM_PREFIX)) {
    return null;
  }

  const value = name.slice(PREFLIGHT_TIMEOUT_ALARM_PREFIX.length);
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  const tabId = Number(value.slice(0, separatorIndex));
  const operationId = value.slice(separatorIndex + 1);
  if (!Number.isInteger(tabId) || operationId === '') {
    return null;
  }

  return { tabId, operationId };
}

function getMatchingInFlightOperation(tabId: number, url?: string): InFlightIconOperation | null {
  const operation = tabInFlightOperations.get(tabId);
  if (!operation) {
    return null;
  }

  if (url && !isSameTweetPageUrl(operation.url, url)) {
    return null;
  }

  return operation;
}

function isCheckInFlightForTab(tabId: number, url?: string): boolean {
  return getMatchingInFlightOperation(tabId, url) !== null;
}

function serializableAutomaticPreflightOperations(): InFlightIconOperation[] {
  return [...tabInFlightOperations.values()].filter(
    operation => operation.trigger === 'automatic-preflight' && operation.timeoutAt !== undefined,
  );
}

async function persistAutomaticPreflightOperations(): Promise<void> {
  try {
    await chrome.storage.session.set({
      [PREFLIGHT_OPERATION_STORAGE_KEY]: serializableAutomaticPreflightOperations(),
    });
  } catch (error) {
    debugLog('Unable to persist automatic preflight operations:', error);
  }
}

function isValidPersistedInFlightOperation(value: unknown): value is InFlightIconOperation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const operation = value as Partial<InFlightIconOperation>;
  return (
    typeof operation.tabId === 'number' &&
    typeof operation.url === 'string' &&
    typeof operation.statusId === 'string' &&
    typeof operation.operationId === 'string' &&
    operation.trigger === 'automatic-preflight' &&
    typeof operation.startedAt === 'number' &&
    typeof operation.timeoutAt === 'number' &&
    tweetStatusId(operation.url) === operation.statusId
  );
}

async function readPersistedAutomaticPreflightOperations(): Promise<InFlightIconOperation[]> {
  try {
    const storage = await chrome.storage.session.get([PREFLIGHT_OPERATION_STORAGE_KEY]);
    const value = storage[PREFLIGHT_OPERATION_STORAGE_KEY];
    return Array.isArray(value) ? value.filter(isValidPersistedInFlightOperation) : [];
  } catch (error) {
    debugLog('Unable to read automatic preflight operations:', error);
    return [];
  }
}

async function clearInFlightOperation(
  tabId: number,
  options: {
    url?: string;
    operationId?: string;
    triggers?: DiagnosticTrigger[];
  } = {},
): Promise<boolean> {
  const operation = tabInFlightOperations.get(tabId);
  if (!operation) {
    return false;
  }

  if (options.url && !isSameTweetPageUrl(operation.url, options.url)) {
    return false;
  }

  if (options.operationId && operation.operationId !== options.operationId) {
    return false;
  }

  if (options.triggers && !options.triggers.includes(operation.trigger)) {
    return false;
  }

  tabInFlightOperations.delete(tabId);

  if (operation.trigger === 'automatic-preflight') {
    clearAutomaticOriginatorProbeTimer(operation);
    try {
      await chrome.alarms.clear(preflightTimeoutAlarmName(operation));
    } catch (error) {
      debugLog('Unable to clear automatic preflight timeout alarm:', error);
    }
    await persistAutomaticPreflightOperations();
  }

  return true;
}

async function startInFlightOperation(
  tabId: number,
  url: string | undefined,
  trigger: DiagnosticTrigger,
  handle?: string,
): Promise<InFlightIconOperation | null> {
  const statusId = tweetStatusId(url);
  if (!url || !statusId) {
    return null;
  }

  await clearInFlightOperation(tabId);

  const now = Date.now();
  const operation: InFlightIconOperation = {
    tabId,
    url,
    platform: captureIdentityFromUrl(url)?.platform,
    statusId,
    operationId: createOperationId(),
    trigger,
    startedAt: now,
    cacheWriteEpoch: userDataWriteEpoch,
    ...(trigger === 'automatic-preflight' ? { timeoutAt: now + AUTOMATIC_PREFLIGHT_TIMEOUT_MS } : {}),
    ...(handle ? { handle } : {}),
  };

  tabInFlightOperations.set(tabId, operation);

  if (operation.trigger === 'automatic-preflight' && operation.timeoutAt !== undefined) {
    recordDiagnosticTimingEvent({
      event: 'automatic_preflight_started',
      ...operationTimingFields(operation),
      durationMs: 0,
    });
    await persistAutomaticPreflightOperations();
    chrome.alarms.create(preflightTimeoutAlarmName(operation), { when: operation.timeoutAt });
    scheduleAutomaticOriginatorProbe(operation);
  }

  return operation;
}

async function isCurrentTweetOperation(
  operation: InFlightIconOperation | null,
): Promise<boolean> {
  if (!operation) {
    return false;
  }

  try {
    const tab = await chrome.tabs.get(operation.tabId);
    return isSameTweetPageUrl(operation.url, tab.url);
  } catch {
    return false;
  }
}

function clearTweetDataExtractionRetry(tabId: number): void {
  const timer = tweetExtractionRetryTimers.get(tabId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  tweetExtractionRetryTimers.delete(tabId);
}

function clearAutomaticTweetExtractionRequestsForTab(tabId: number): void {
  const keyPrefix = `${tabId}:`;
  for (const key of automaticTweetExtractionRequests.keys()) {
    if (key.startsWith(keyPrefix)) {
      automaticTweetExtractionRequests.delete(key);
    }
  }
}

function clearAutomaticTweetExtractionRequestIfCurrent(key: string, promise: Promise<void>): void {
  if (automaticTweetExtractionRequests.get(key) === promise) {
    automaticTweetExtractionRequests.delete(key);
  }
}

function waitForPromiseOrTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<'settled' | 'timeout'> {
  return new Promise(resolve => {
    let completed = false;

    const timeoutId = setTimeout(() => {
      if (completed) {
        return;
      }

      completed = true;
      resolve('timeout');
    }, timeoutMs);

    promise.then(
      () => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timeoutId);
        resolve('settled');
      },
      () => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timeoutId);
        resolve('settled');
      },
    );
  });
}

function clearPendingDuplicateCheckIfCurrent(cacheKey: string, promise: Promise<void>): void {
  if (pendingDuplicateChecks.get(cacheKey) === promise) {
    pendingDuplicateChecks.delete(cacheKey);
  }
}

function isMissingContentScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MISSING_CONTENT_SCRIPT_MESSAGE);
}

function resolveOriginatorCreateUrl(
  handle: string,
  platform: CapturePlatform = 'twitter',
  createUrl?: unknown,
): string {
  if (typeof createUrl === 'string' && createUrl) {
    return createUrl;
  }

  const baseUrl = getWebBaseUrl().replace(/\/+$/, '');
  return `${baseUrl}/originators/add/?suggested_handle=${encodeURIComponent(handle)}&platform=${encodeURIComponent(platform)}`;
}

function originatorSlugFromPreflight(originator: PreflightOriginatorResult | undefined): string | undefined {
  return originator?.originator?.slug ?? originator?.originator?.unique_id;
}

function operationTimingFields(operation: InFlightIconOperation): Pick<
  DiagnosticTimingEvent,
  'tabId' | 'sourceUrl' | 'statusId' | 'handle' | 'operationId' | 'trigger'
> {
  return {
    tabId: operation.tabId,
    sourceUrl: operation.url,
    statusId: operation.statusId,
    handle: operation.handle,
    operationId: operation.operationId,
    trigger: operation.trigger,
  };
}

function durationSince(startedAt: number | undefined): number | undefined {
  return typeof startedAt === 'number' ? Date.now() - startedAt : undefined;
}

function isAutomaticOriginatorProbeTimeoutResponse(response: unknown): boolean {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const error = (response as { error?: unknown }).error;
  return typeof error === 'string' && error === 'Automatic originator probe timed out';
}

function getMissingOriginatorForTab(tabId: number, url?: string): MissingOriginatorInfo | null {
  const info = tabMissingOriginators.get(tabId);
  if (!info) {
    return null;
  }

  if (url && !isSameTweetPageUrl(info.url, url)) {
    return null;
  }

  return { ...info };
}

function setTabDuplicateResult(tabId: number, result: DuplicateCheckResult | null, url?: string): void {
  tabDuplicateResults.set(tabId, result);
  if (url) {
    tabDuplicateResultUrls.set(tabId, url);
  } else {
    tabDuplicateResultUrls.delete(tabId);
  }
}

function clearTabDuplicateResult(tabId: number): void {
  tabDuplicateResults.delete(tabId);
  tabDuplicateResultUrls.delete(tabId);
}

function getCachedDuplicateResultForTab(
  tabId: number,
  url?: string,
): { hasResult: boolean; result: DuplicateCheckResult | null } {
  if (!tabDuplicateResults.has(tabId)) {
    return { hasResult: false, result: null };
  }

  const cachedUrl = tabDuplicateResultUrls.get(tabId);
  if (url && cachedUrl && !isSameTweetPageUrl(cachedUrl, url)) {
    clearTabDuplicateResult(tabId);
    return { hasResult: false, result: null };
  }

  return {
    hasResult: true,
    result: tabDuplicateResults.get(tabId) ?? null,
  };
}

// The diagnostics aggregators live in ./diagnostics but read worker-owned tab
// state; hand that state to them through a context rather than importing the
// worker back (which would cycle through the webpack entry point).
function runtimeDiagnosticsContext(): RuntimeDiagnosticsContext {
  return {
    getServices: () => ({
      initialized: servicesInitialized,
      apiHandler: apiHandler !== null,
      authMonitor: authMonitor !== null,
      storageCleanup: storageCleanup !== null,
      authStateManager: authStateManager !== null,
    }),
    getAuthStateData: () => authStateManager?.getStateData() ?? null,
    getCurrentAuthState,
    getLastActiveTabId: () => lastActiveTabId,
    getPendingDuplicateCheckUrls: () => [...pendingDuplicateChecks.keys()],
    isCheckInFlightForTab,
    getMissingOriginatorForTab,
    getCachedDuplicateResultForTab,
    hasTabScopedPresentation: (tabId: number) => tabScopedPresentationTabIds.has(tabId),
  };
}

function collectRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
  return getRuntimeDiagnostics(runtimeDiagnosticsContext());
}

(globalThis as typeof globalThis & {
  __quotewiseDiagnostics?: () => Promise<RuntimeDiagnostics>;
}).__quotewiseDiagnostics = collectRuntimeDiagnostics;

async function showOverlayInTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: MessageType.SHOW_OVERLAY });
  } catch (error) {
    if (!isMissingContentScriptError(error) || !isTweetPageUrl(tab.url)) {
      throw error;
    }

    debugLog('Content script missing on tweet tab; injecting before showing overlay');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [CONTENT_SCRIPT_FILE]
    });
    await chrome.tabs.sendMessage(tab.id, { type: MessageType.SHOW_OVERLAY });
  }
}

async function openFeedbackPage(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const version = typeof manifest.version === 'string' && manifest.version.trim()
    ? manifest.version
    : undefined;

  await chrome.tabs.create({
    url: buildFeedbackUrl({
      version,
      platform: 'twitter',
    }),
  });
}

function getCurrentAuthState(): AuthState {
  return authStateManager?.getState() ?? AuthState.UNKNOWN;
}

async function applyResolvedIconForTab(
  tabId: number,
  url?: string,
  duplicateResult?: DuplicateCheckResult | null,
  authState: AuthState = getCurrentAuthState(),
): Promise<void> {
  const resolvedDuplicateResult = await resolveDuplicateResultForTab(tabId, url, duplicateResult);
  const presentation = resolveIconPresentation(authState, resolvedDuplicateResult, {
    tabId,
    isSupportedPlatform: isSupportedPlatformUrl(url),
    isTweetPage: isTweetPageUrl(url),
    isCheckInFlight: isCheckInFlightForTab(tabId, url),
    isOriginatorMissing: getMissingOriginatorForTab(tabId, url) !== null,
  }, isPrivateModeEnabled());

  if (presentation.scope === 'tab') {
    tabScopedPresentationTabIds.add(tabId);
  }

  await applyIconPresentation(presentation, tabId, {
    forceTabScope: presentation.scope === 'global',
  });
}

interface AffectedTab {
  id: number;
  url?: string;
}

interface TweetExtractionResponse {
  success?: boolean;
  data?: unknown;
  error?: string;
}

async function getAffectedTabs(): Promise<AffectedTab[]> {
  const tabsById = new Map<number, AffectedTab>();

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && (isSupportedPlatformUrl(tab.url) || tabScopedPresentationTabIds.has(tab.id))) {
        tabsById.set(tab.id, { id: tab.id, url: tab.url });
      }
    }
  } catch (error) {
    debugLog('Error querying tabs for icon auth overwrite:', error);
  }

  for (const tabId of tabScopedPresentationTabIds) {
    if (tabsById.has(tabId)) continue;

    try {
      const tab = await chrome.tabs.get(tabId);
      tabsById.set(tabId, { id: tabId, url: tab?.url });
    } catch {
      tabsById.set(tabId, { id: tabId });
    }
  }

  return [...tabsById.values()];
}

async function clearAutomaticWorkForPrivateMode(): Promise<void> {
  for (const tabId of [...tweetExtractionRetryTimers.keys()]) {
    clearTweetDataExtractionRetry(tabId);
  }

  automaticTweetExtractionRequests.clear();

  for (const operation of [...tabInFlightOperations.values()]) {
    if (
      operation.trigger === 'automatic-preflight' ||
      operation.trigger === 'automatic-originator-probe' ||
      operation.trigger === 'automatic-originator-fallback'
    ) {
      await clearInFlightOperation(operation.tabId, {
        operationId: operation.operationId,
      });
    }
  }
}

async function applySettingsPresentation(next: Settings, prev: Settings): Promise<void> {
  currentSettings = next;

  if (next.privateMode && !prev.privateMode) {
    await clearAutomaticWorkForPrivateMode();
    await clearUserDataCaches();
  }

  for (const tab of await getAffectedTabs()) {
    try {
      await applyResolvedIconForTab(tab.id, tab.url);
    } catch (error) {
      debugLog('Error applying icon after settings change:', error);
    }
  }
}

async function applyAuthStatePresentation(authState: AuthState): Promise<void> {
  const presentation = resolveIconPresentation(authState, null, {
    tabId: 0,
    isSupportedPlatform: false,
    isTweetPage: false,
    isCheckInFlight: false,
  }, isPrivateModeEnabled());

  await applyIconPresentation(presentation, 0);

  for (const tab of await getAffectedTabs()) {
    try {
      if (authState === AuthState.AUTHENTICATED && isSupportedPlatformUrl(tab.url)) {
        await applyResolvedIconForTab(tab.id, tab.url, undefined, authState);
        continue;
      }

      if (
        authState === AuthState.UNAUTHENTICATED ||
        authState === AuthState.SESSION_EXPIRED ||
        authState === AuthState.INSUFFICIENT_PRIVILEGES
      ) {
        clearTweetDataExtractionRetry(tab.id);
        clearAutomaticTweetExtractionRequestsForTab(tab.id);
        await clearInFlightOperation(tab.id);
        tabMissingOriginators.delete(tab.id);
      }

      await applyIconPresentation(presentation, tab.id, { forceTabScope: true });
    } catch (error) {
      debugLog('Error overwriting tab-scoped icon after auth transition:', error);
    }
  }
}

setAuthPresentationUpdater(applyAuthStatePresentation);

function currentAutomaticPreflightOperation(operation: InFlightIconOperation): InFlightIconOperation | null {
  const currentOperation = getMatchingInFlightOperation(operation.tabId, operation.url);
  if (
    !currentOperation ||
    currentOperation.operationId !== operation.operationId ||
    currentOperation.trigger !== 'automatic-preflight'
  ) {
    return null;
  }

  return currentOperation;
}

async function shouldApplyAutomaticOriginatorProbeResult(
  operation: InFlightIconOperation,
): Promise<boolean> {
  if (!currentAutomaticPreflightOperation(operation)) {
    return false;
  }

  return isSenderTabStillOnSourceUrl(operation.tabId, operation.url);
}

function scheduleAutomaticOriginatorProbe(operation: InFlightIconOperation): void {
  if (operation.trigger !== 'automatic-preflight') {
    return;
  }

  if (isPrivateModeEnabled()) {
    recordDiagnosticTimingEvent({
      event: 'originator_probe_skipped',
      ...operationTimingFields(operation),
      reason: 'private_mode',
      durationMs: durationSince(operation.startedAt),
    });
    return;
  }

  if (!operation.handle) {
    recordDiagnosticTimingEvent({
      event: 'originator_probe_skipped',
      ...operationTimingFields(operation),
      reason: 'missing_handle',
      durationMs: durationSince(operation.startedAt),
    });
    return;
  }

  clearAutomaticOriginatorProbeTimer(operation);

  const key = automaticOriginatorProbeKey(operation);
  const timer = setTimeout(() => {
    automaticOriginatorProbeTimers.delete(key);
    void runAutomaticOriginatorProbe(operation).catch(error => {
      debugLog('Automatic originator probe failed:', error);
    });
  }, AUTOMATIC_ORIGINATOR_PROBE_DELAY_MS);

  automaticOriginatorProbeTimers.set(key, timer);
  recordDiagnosticTimingEvent({
    event: 'originator_probe_scheduled',
    ...operationTimingFields(operation),
    reason: 'after_automatic_preflight_start',
    durationMs: durationSince(operation.startedAt),
  });
}

async function handleAutomaticPreflightTimeout(operation: InFlightIconOperation): Promise<void> {
  if (!await isCurrentTweetOperation(operation)) {
    await clearInFlightOperation(operation.tabId, { operationId: operation.operationId });
    recordPreflightDiagnostic({
      status: 'skipped',
      trigger: 'automatic-preflight',
      tabId: operation.tabId,
      url: operation.url,
      handle: operation.handle,
      operationId: operation.operationId,
      durationMs: durationSince(operation.startedAt),
      reason: 'preflight_timeout_url_changed',
    });
    recordDiagnosticTimingEvent({
      event: 'automatic_preflight_timeout_skipped',
      ...operationTimingFields(operation),
      reason: 'preflight_timeout_url_changed',
      durationMs: durationSince(operation.startedAt),
    });
    return;
  }

  await clearInFlightOperation(operation.tabId, { operationId: operation.operationId });
  recordPreflightDiagnostic({
    status: 'failed',
    trigger: 'automatic-preflight',
    tabId: operation.tabId,
    url: operation.url,
    handle: operation.handle,
    operationId: operation.operationId,
    durationMs: durationSince(operation.startedAt),
    reason: 'preflight_timeout',
    classification: 'combined_preflight_timeout',
  });
  recordDiagnosticTimingEvent({
    event: 'automatic_preflight_timeout',
    ...operationTimingFields(operation),
    reason: 'preflight_timeout',
    classification: 'combined_preflight_timeout',
    durationMs: durationSince(operation.startedAt),
  });

  if (await runAutomaticOriginatorFallback(operation)) {
    return;
  }

  setTabDuplicateResult(operation.tabId, null, operation.url);
  tabMissingOriginators.delete(operation.tabId);
  await applyResolvedIconForTab(operation.tabId, operation.url, null);
}

async function handleAutomaticPreflightTimeoutAlarm(alarmName: string): Promise<void> {
  const parsed = parsePreflightTimeoutAlarmName(alarmName);
  if (!parsed) {
    return;
  }

  const operation = tabInFlightOperations.get(parsed.tabId);
  if (!operation || operation.operationId !== parsed.operationId) {
    await persistAutomaticPreflightOperations();
    return;
  }

  await handleAutomaticPreflightTimeout(operation);
}

async function reconcileAutomaticPreflightOperations(): Promise<void> {
  const persistedOperations = await readPersistedAutomaticPreflightOperations();
  if (persistedOperations.length === 0) {
    return;
  }

  const now = Date.now();

  for (const operation of persistedOperations) {
    if (tabInFlightOperations.has(operation.tabId)) {
      continue;
    }

    tabInFlightOperations.set(operation.tabId, operation);

    if (operation.timeoutAt !== undefined && operation.timeoutAt <= now) {
      await handleAutomaticPreflightTimeout(operation);
      continue;
    }

    if (!await isCurrentTweetOperation(operation)) {
      await clearInFlightOperation(operation.tabId, { operationId: operation.operationId });
      continue;
    }

    if (operation.timeoutAt !== undefined) {
      chrome.alarms.create(preflightTimeoutAlarmName(operation), { when: operation.timeoutAt });
    }

    try {
      await applyResolvedIconForTab(operation.tabId, operation.url, getCachedDuplicateResultForTab(operation.tabId, operation.url).result);
    } catch (error) {
      debugLog('Unable to restore automatic preflight loading icon:', error);
    }
  }

  await persistAutomaticPreflightOperations();
}

async function shouldApplyPreflightOperationResult(
  tabId: number | undefined,
  url: string,
  operation: InFlightIconOperation | null,
): Promise<boolean> {
  if (!tabId) {
    return true;
  }

  const currentOperation = tabInFlightOperations.get(tabId);
  if (
    currentOperation &&
    operation &&
    currentOperation.operationId !== operation.operationId &&
    !isSameTweetPageUrl(currentOperation.url, url)
  ) {
    return false;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    return isSameTweetPageUrl(url, tab.url);
  } catch {
    const matchingOperation = getMatchingInFlightOperation(tabId, url);
    return (
      matchingOperation !== null &&
      operation !== null &&
      matchingOperation.operationId === operation.operationId
    );
  }
}

async function isSenderTabStillOnSourceUrl(tabId: number, sourceUrl: string): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return isSameTweetPageUrl(sourceUrl, tab.url);
  } catch {
    const matchingOperation = getMatchingInFlightOperation(tabId, sourceUrl);
    return matchingOperation !== null;
  }
}

function presentationForCollectionBadge(badgeInfo: CollectionBadgeInfo): IconPresentation {
  switch (badgeInfo.state) {
    case 'already_collected':
      return ICON_STATES.InCollection;
    case 'exists_not_collected':
      return ICON_STATES.Exact;
    case 'new_quote':
      return ICON_STATES.New;
    case 'processing':
      return ICON_STATES.Loading;
    case 'ready':
    default:
      return ICON_STATES.Ready;
  }
}

function sourceUrlFromMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): string | undefined {
  const data = message.data as Record<string, unknown> | undefined;
  const sourceUrl = data?.source_url ?? data?.sourceUrl ?? sender.tab?.url;
  return typeof sourceUrl === 'string' ? sourceUrl : undefined;
}

function authRequiredResponseState(response: unknown): AuthState | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const value = response as {
    authRequired?: unknown;
    authFailureType?: unknown;
  };

  if (value.authRequired !== true) {
    return null;
  }

  return value.authFailureType === 'insufficient_privileges'
    ? AuthState.INSUFFICIENT_PRIVILEGES
    : AuthState.SESSION_EXPIRED;
}

async function applyAuthRequiredApiResponse(
  response: unknown,
  context: {
    tabId?: number;
    url?: string;
    trigger?: DiagnosticTrigger;
    handle?: string;
  },
): Promise<boolean> {
  const authState = authRequiredResponseState(response);
  if (!authState) {
    return false;
  }

  const error = response && typeof response === 'object'
    ? (response as { error?: unknown; message?: unknown }).error ?? (response as { message?: unknown }).message
    : undefined;
  const errorText = typeof error === 'string' ? error : undefined;

  if (authStateManager) {
    if (authState === AuthState.INSUFFICIENT_PRIVILEGES) {
      await authStateManager.onInsufficientPrivileges(errorText);
    } else {
      await authStateManager.onTokenRefreshFailed(errorText);
    }
  }

  const { tabId, url, trigger, handle } = context;
  if (tabId) {
    recordPreflightDiagnostic({
      status: 'failed',
      trigger: trigger ?? 'explicit-duplicate-check',
      tabId,
      url,
      handle,
      reason: 'authentication_required',
      authRequired: true,
      ...(errorText ? { error: errorText } : {}),
    });
    clearTweetDataExtractionRetry(tabId);
    clearAutomaticTweetExtractionRequestsForTab(tabId);
    clearTabDuplicateResult(tabId);
    tabMissingOriginators.delete(tabId);
    await clearInFlightOperation(tabId);
    tabScopedPresentationTabIds.add(tabId);
    await applyResolvedIconForTab(tabId, url, null, authState);
  }

  return true;
}

async function resolveDuplicateResultForTab(
  tabId: number,
  url: string | undefined,
  duplicateResult: DuplicateCheckResult | null | undefined,
): Promise<DuplicateCheckResult | null> {
  if (duplicateResult !== undefined) {
    return duplicateResult;
  }

  const cachedDuplicate = getCachedDuplicateResultForTab(tabId, url);
  if (cachedDuplicate.hasResult) {
    return cachedDuplicate.result;
  }

  if (!url) {
    return null;
  }

  try {
    const storage = await chrome.storage.local.get(['preloadedDuplicateCheck']);
    const preloaded = storage.preloadedDuplicateCheck as {
      url?: unknown;
      result?: unknown;
      timestamp?: unknown;
    } | undefined;

    if (
      typeof preloaded?.url === 'string' &&
      isSameTweetPageUrl(preloaded.url, url) &&
      typeof preloaded.timestamp === 'number' &&
      Date.now() - preloaded.timestamp < PRELOADED_DUPLICATE_MAX_AGE_MS
    ) {
      const storedDuplicateResult = duplicateResultFromResponse({
        success: true,
        result: preloaded.result,
      });
      setTabDuplicateResult(tabId, storedDuplicateResult, preloaded.url);
      return storedDuplicateResult;
    }
  } catch (error) {
    debugLog('Error reading preloaded duplicate cache for icon state:', error);
  }

  return null;
}

async function resolveTargetTabId(tabId?: number): Promise<number | undefined> {
  if (tabId) return tabId;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

/**
 * Ensure all services are initialized
 * Called before any message handling to recover from service worker termination
 */
async function ensureServicesInitialized(): Promise<void> {
  if (servicesInitialized && apiHandler && authMonitor && storageCleanup && authStateManager) {
    return;
  }

  // Initialize AuthStateManager FIRST - single source of truth for auth state
  // This must happen before other services that might check auth
  try {
    authStateManager = await initializeAuthStateManager();
  } catch (error) {
    console.error('Failed to initialize AuthStateManager:', error);
  }

  // Initialize services
  apiHandler = initializeApiHandler();
  authMonitor = new AuthenticationMonitor();
  storageCleanup = initializeStorageCleanup();
  currentSettings = await getSettings();
  if (!unsubscribeSettingsChanged) {
    unsubscribeSettingsChanged = onSettingsChanged((next, prev) => {
      void applySettingsPresentation(next, prev).catch(error => {
        debugLog('Error applying settings change:', error);
      });
    });
  }

  // Initialize OAuth token refresh (restores state from storage)
  try {
    await initializeTokenRefresh();
  } catch (error) {
    console.warn('Failed to initialize token refresh:', error);
  }

  // Start periodic cleanup (quiet mode - no startup logs). Schedules a
  // chrome.alarms alarm dispatched by the top-level onAlarm listener below.
  await storageCleanup.startPeriodicCleanup(true);

  await reconcileAutomaticPreflightOperations();

  servicesInitialized = true;
}

// Extension installation and startup
chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureServicesInitialized();

  if (details.reason === 'install') {
    debugLog('Extension installed');
    chrome.storage.local.set({
      settings: {
        environment: 'development',
        autoCapture: true,
        duplicateCheck: true
      }
    });
  }
});

// Initialize services on startup
chrome.runtime.onStartup.addListener(async () => {
  await ensureServicesInitialized();
});

// Handle alarms for token refresh — route results through AuthStateManager (FR-021)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith(PREFLIGHT_TIMEOUT_ALARM_PREFIX)) {
    debugLog('Automatic preflight timeout alarm triggered');
    await ensureServicesInitialized();
    await handleAutomaticPreflightTimeoutAlarm(alarm.name);
    return;
  }

  if (alarm.name === STORAGE_CLEANUP_ALARM) {
    await ensureServicesInitialized();
    await storageCleanup?.runCleanup();
    return;
  }

  if (alarm.name === 'token-refresh') {
    debugLog('Token refresh alarm triggered');
    await ensureServicesInitialized();
    const result = await handleTokenRefreshAlarm();

    if (!authStateManager) return;

    if (result.success) {
      await authStateManager.onTokenRefreshed();
    } else if (result.outcome === 'revoked' || result.outcome === 'expired') {
      await authStateManager.onTokenRefreshFailed();
    }
    // network_error: don't change state — alarm handler already scheduled retry
  }
});

// Toolbar icon click: show overlay bar in active tab
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await showOverlayInTab(tab);
  } catch (error) {
    console.error('Error handling action click:', error);
  }
});

// Handle messages from content scripts and popup
// NOTE: Service worker handles core messages, API handler handles API messages
// IMPORTANT: ensureServicesInitialized() is called first to recover from MV3 termination
chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  sender,
  sendResponse
) => {
  if (message.type === MessageType.GET_DIAGNOSTICS) {
    collectRuntimeDiagnostics().then(diagnostics => {
      sendResponse({ success: true, data: diagnostics });
    }).catch(error => {
      sendResponse({ success: false, error: errorMessage(error) });
    });

    return true;
  }

  if (message.type === MessageType.OPEN_FEEDBACK_PAGE) {
    openFeedbackPage().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: errorMessage(error) });
    });

    return true;
  }

  // Ensure services are initialized before processing any message
  // This handles MV3 service worker termination and recovery
  ensureServicesInitialized().then(() => {
    switch (message.type) {
      case MessageType.POST_DATA_EXTRACTED:
        handleTweetDataExtracted(message.data, sender.tab?.id, sendResponse, {
          keepAliveUntilIconApplied: true,
        });
        break;

      case MessageType.GET_POST_DATA:
        handleGetTweetData(sender.tab?.id, sendResponse);
        break;

      case MessageType.SPA_NAV: {
        // Safari's stand-in for webNavigation.onHistoryStateUpdated (spec 002 T007).
        const spaUrl = (message.data as { url?: string } | undefined)?.url;
        const spaTabId = sender.tab?.id;
        if (spaUrl && spaTabId !== undefined) {
          void handleSpaNavigation({ tabId: spaTabId, url: spaUrl, frameId: 0 });
        }
        sendResponse({ success: true });
        break;
      }

      // CHECK_AUTH_STATUS is now handled by AuthStateManager's message listener
      // (via AUTH_STATE_GET which returns the same info in a cleaner format)
      // The AuthStateManager listener responds synchronously before we get here,
      // but for backwards compatibility we also handle it here
      case MessageType.CHECK_AUTH_STATUS:
        // AuthStateManager handles this message, but if it somehow gets here,
        // delegate to ensure we return a response
        if (authStateManager) {
          const stateData = authStateManager.getStateData();
          sendResponse({
            isAuthenticated: authStateManager.isAuthenticated(),
            scopes: stateData.scopes,
            username: stateData.username,
          });
        } else {
          // Fallback if AuthStateManager not ready
          sendResponse({ isAuthenticated: false });
        }
        break;

      // Delegate API messages to API handler
      case MessageType.SEARCH_ORIGINATORS:
      case MessageType.SUBMIT_QUOTE:
      case MessageType.ADD_QUOTE_TO_COLLECTION:
      case MessageType.LIST_COLLECTIONS:
        // Delegate to API handler (guaranteed initialized by ensureServicesInitialized)
        apiHandler!.handleMessage(message, sender, (response) => {
          applyAuthRequiredApiResponse(response, {
            tabId: sender.tab?.id,
            url: sourceUrlFromMessage(message, sender),
          })
            .catch(error => {
              debugLog('Error applying API auth-required icon state:', error);
            })
            .finally(() => {
              sendResponse(response);
            });
        }).catch(error => {
          console.error('API handler error:', error);
          sendResponse({
            success: false,
            error: error.message || 'API request failed'
          });
        });
        break;

      case MessageType.LOOKUP_ORIGINATOR_BY_HANDLE:
        handleLookupOriginatorByHandle(message, sender, sendResponse).catch(error => {
          console.error('Originator lookup handler error:', error);
          sendResponse({
            success: false,
            error: error.message || 'API request failed'
          });
        });
        break;

      case MessageType.ORIGINATOR_LOOKUP_STATUS:
        handleOriginatorLookupStatus(message, sender, sendResponse).catch(error => {
          console.error('Originator lookup status handler error:', error);
          sendResponse({
            success: false,
            error: error.message || 'Unable to apply originator lookup status'
          });
        });
        break;

      case MessageType.CHECK_DUPLICATE:
        handleCheckDuplicate(message, sender, sendResponse).catch(error => {
          console.error('Duplicate check handler error:', error);
          sendResponse({
            success: false,
            error: error.message || 'Duplicate check failed'
          });
        });
        break;

      case MessageType.CHECK_NOW:
        handleCheckNow(message, sender, sendResponse).catch(error => {
          console.error('Check now handler error:', error);
          sendResponse({
            success: false,
            error: error.message || 'Check now failed'
          });
        });
        break;

      case MessageType.CLEANUP_STORAGE:
        // Manual storage cleanup for debugging (guaranteed initialized)
        storageCleanup!.runCleanup().then(() => {
          sendResponse({ success: true, message: 'Storage cleanup completed' });
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        break;

      case MessageType.UPDATE_COLLECTION_BADGE:
        handleUpdateCollectionBadge(message.data, sendResponse);
        break;

      case MessageType.GET_STORAGE_STATS:
        // Get storage statistics for debugging (guaranteed initialized)
        storageCleanup!.getStorageStats().then(stats => {
          sendResponse({ success: true, stats });
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        break;

      case MessageType.OPEN_POPUP:
        chrome.action.openPopup().then(() => {
          sendResponse({ success: true });
        }).catch(error => {
          console.error('Error opening popup:', error);
          sendResponse({ success: false, error: error?.message || 'Failed to open popup' });
        });
        break;

      case MessageType.OPEN_OPTIONS_PAGE:
        Promise.resolve(chrome.runtime.openOptionsPage()).then(() => {
          sendResponse({ success: true, ok: true });
        }).catch((error: Error) => {
          console.error('Error opening options page:', error);
          sendResponse({ success: false, error: error?.message || 'Failed to open options page' });
        });
        break;

      case MessageType.OAUTH_LOGIN:
        // Initiate OAuth login flow
        // Notify AuthStateManager that we're starting authentication
        authStateManager?.startAuthenticating();
        initiateOAuthFlow().then(async tokens => {
          debugLog('OAuth login successful');
          // Notify AuthStateManager of successful auth (handles badge)
          await authStateManager?.onAuthSuccess(undefined, tokens.scopes);
          sendResponse({ success: true, scopes: tokens.scopes });

          // Re-check collection status for current tweet now that we're authenticated
          // Without this, the badge stays green/empty after login instead of ★/✓/+
          const stored = await chrome.storage.local.get(['currentPost', 'currentTweet']);
          const storedCapture = stored.currentPost?.data ?? stored.currentTweet?.data;
          if (storedCapture) {
            const tabId = sender.tab?.id;
            checkQuoteCollectionStatus(storedCapture as CapturedPostData, tabId).catch(error => {
              console.error('Error re-checking collection status after login:', error);
            });
          }
        }).catch(async error => {
          console.error('OAuth login failed:', error);
          // Notify AuthStateManager of failed auth
          await authStateManager?.onAuthFailure(error.message);
          sendResponse({
            success: false,
            error: error.message || 'Login failed',
            recoverable: error.recoverable ?? true
          });
        });
        break;

      case MessageType.OAUTH_LOGOUT:
        // Logout, clear tokens, and wipe user-identifying caches.
        logoutInProgress = true;
        markUserDataWipe();
        logoutAndClearUserData().then(() => {
          debugLog('OAuth logout successful');
          logoutInProgress = false;
          sendResponse({ success: true });
          // Notify AuthStateManager of logout after the UI response so menu state is not blocked by broadcasts.
          authStateManager?.onLogout().catch(error => {
            console.error('Auth state logout notification failed:', error);
          });
        }).catch(error => {
          logoutInProgress = false;
          console.error('OAuth logout failed:', error);
          sendResponse({ success: false, error: error.message });
        });
        break;

      case MessageType.CLEAR_USER_DATA:
        markUserDataWipe();
        clearUserDataCaches().then(() => {
          sendResponse({ success: true, ok: true });
        }).catch(error => {
          console.error('Clear user data failed:', error);
          sendResponse({ success: false, error: error.message });
        });
        break;

      case MessageType.AUTH_STATE_GET:
      case MessageType.AUTH_STATE_SUBSCRIBE:
        // Return current auth state from AuthStateManager
        if (authStateManager) {
          sendResponse({
            success: true,
            data: authStateManager.getStateData()
          });
        } else {
          sendResponse({
            success: false,
            error: 'Auth state manager not initialized'
          });
        }
        break;

      default:
        console.warn('Unknown message type:', message.type);
        sendResponse({ error: 'Unknown message type' });
    }
  }).catch(error => {
    console.error('Failed to initialize services:', error);
    sendResponse({ success: false, error: 'Service initialization failed' });
  });

  return true; // Keep message port open for async response
});

async function sendExtractTweetDataMessage(tabId: number, url?: string): Promise<TweetExtractionResponse | undefined> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: MessageType.EXTRACT_POST_DATA });
  } catch (error) {
    if (!isMissingContentScriptError(error) || !isTweetPageUrl(url)) {
      throw error;
    }

    debugLog('Content script missing on tweet tab; injecting before extracting data');
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE]
    });

    return await chrome.tabs.sendMessage(tabId, { type: MessageType.EXTRACT_POST_DATA });
  }
}

function scheduleTweetDataExtractionRetry(tabId: number, url: string | undefined, attempt: number): void {
  const retryAfterMs = TWEET_EXTRACTION_RETRY_DELAYS_MS[attempt];
  if (!isTweetPageUrl(url) || retryAfterMs === undefined) {
    return;
  }

  clearTweetDataExtractionRetry(tabId);

  const timer = setTimeout(() => {
    const nextAttempt = attempt + 2;
    tweetExtractionRetryTimers.delete(tabId);
    void (async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!isSameTweetPageUrl(url, tab.url)) {
          recordExtractionDiagnostic({
            status: 'skipped',
            tabId,
            url: tab.url,
            reason: 'retry_url_changed',
            attempt: nextAttempt,
          });
          recordDiagnosticTimingEvent({
            event: 'extraction_retry_skipped',
            tabId,
            sourceUrl: tab.url,
            trigger: 'automatic-preflight',
            reason: 'retry_url_changed',
            attempt: nextAttempt,
          });
          return;
        }

        await requestTweetDataExtraction(tabId, url, attempt + 1);
      } catch (error) {
        recordExtractionDiagnostic({
          status: 'failed',
          tabId,
          url,
          reason: 'retry_tab_unavailable',
          error: errorMessage(error),
          attempt: nextAttempt,
        });
        recordDiagnosticTimingEvent({
          event: 'extraction_retry_failed',
          tabId,
          sourceUrl: url,
          trigger: 'automatic-preflight',
          reason: 'retry_tab_unavailable',
          error: errorMessage(error),
          attempt: nextAttempt,
        });
        debugLog('Unable to retry tweet extraction for icon preflight:', error);
      }
    })();
  }, retryAfterMs);

  tweetExtractionRetryTimers.set(tabId, timer);
}

async function requestTweetDataExtraction(tabId: number, url?: string, attempt = 0): Promise<void> {
  if (isPrivateModeEnabled()) {
    clearTweetDataExtractionRetry(tabId);
    recordExtractionDiagnostic({
      status: 'skipped',
      tabId,
      url,
      reason: 'private_mode',
      attempt: attempt + 1,
    });
    recordDiagnosticTimingEvent({
      event: 'extraction_skipped',
      tabId,
      sourceUrl: url,
      trigger: 'automatic-preflight',
      reason: 'private_mode',
      attempt: attempt + 1,
    });
    await applyResolvedIconForTab(tabId, url);
    return;
  }

  const extractionKey = attempt === 0 ? automaticTweetOperationKey(tabId, url) : null;
  if (extractionKey) {
    const pendingExtraction = automaticTweetExtractionRequests.get(extractionKey);
    if (pendingExtraction) {
      recordDiagnosticTimingEvent({
        event: 'extraction_request_deduped',
        tabId,
        sourceUrl: url,
        trigger: 'automatic-preflight',
        reason: 'same_tweet_extraction_in_flight',
        attempt: attempt + 1,
      });
      await pendingExtraction;
      return;
    }
  }

  const extractionPromise = performTweetDataExtraction(tabId, url, attempt);
  if (!extractionKey) {
    await extractionPromise;
    return;
  }

  automaticTweetExtractionRequests.set(extractionKey, extractionPromise);
  try {
    await extractionPromise;
  } finally {
    clearAutomaticTweetExtractionRequestIfCurrent(extractionKey, extractionPromise);
  }
}

async function performTweetDataExtraction(tabId: number, url?: string, attempt = 0): Promise<void> {
  if (!isTweetPageUrl(url)) {
    clearTweetDataExtractionRetry(tabId);
    recordExtractionDiagnostic({
      status: 'skipped',
      tabId,
      url,
      reason: 'not_tweet_page',
    });
    recordDiagnosticTimingEvent({
      event: 'extraction_skipped',
      tabId,
      sourceUrl: url,
      trigger: 'automatic-preflight',
      reason: 'not_tweet_page',
      attempt: attempt + 1,
    });
    return;
  }

  if (attempt === 0) {
    clearTweetDataExtractionRetry(tabId);
  }

  recordExtractionDiagnostic({
    status: 'requested',
    tabId,
    url,
    attempt: attempt + 1,
  });
  recordDiagnosticTimingEvent({
    event: 'extraction_requested',
    tabId,
    sourceUrl: url,
    trigger: 'automatic-preflight',
    attempt: attempt + 1,
  });

  try {
    const response = await sendExtractTweetDataMessage(tabId, url);
    if (response?.success && response.data) {
      if (!isExtractedTweetDataForUrl(response.data, url)) {
        const retryAfterMs = TWEET_EXTRACTION_RETRY_DELAYS_MS[attempt];
        recordExtractionDiagnostic({
          status: 'no_data',
          tabId,
          url,
          reason: 'stale_tweet_data',
          classification: 'extraction_retry_before_preflight',
          attempt: attempt + 1,
          retryAfterMs,
        });
        recordDiagnosticTimingEvent({
          event: 'extraction_retry_scheduled',
          tabId,
          sourceUrl: url,
          trigger: 'automatic-preflight',
          reason: 'stale_tweet_data',
          classification: 'extraction_retry_before_preflight',
          attempt: attempt + 1,
          retryAfterMs,
        });
        debugLog('Tweet extraction returned stale data for a different status ID');
        scheduleTweetDataExtractionRetry(tabId, url, attempt);
        return;
      }

      clearTweetDataExtractionRetry(tabId);
      recordExtractionDiagnostic({
        status: 'succeeded',
        tabId,
        url,
        attempt: attempt + 1,
      });
      await handleTweetDataExtracted(response.data, tabId, () => undefined);
    } else if (response?.error) {
      const retryAfterMs = TWEET_EXTRACTION_RETRY_DELAYS_MS[attempt];
      recordExtractionDiagnostic({
        status: 'no_data',
        tabId,
        url,
        error: response.error,
        classification: 'extraction_retry_before_preflight',
        attempt: attempt + 1,
        retryAfterMs,
      });
      recordDiagnosticTimingEvent({
        event: 'extraction_retry_scheduled',
        tabId,
        sourceUrl: url,
        trigger: 'automatic-preflight',
        reason: 'no_tweet_data',
        classification: 'extraction_retry_before_preflight',
        attempt: attempt + 1,
        retryAfterMs,
      });
      debugLog('Tweet extraction request returned no data:', response.error);
      scheduleTweetDataExtractionRetry(tabId, url, attempt);
    } else {
      const retryAfterMs = TWEET_EXTRACTION_RETRY_DELAYS_MS[attempt];
      recordExtractionDiagnostic({
        status: 'no_data',
        tabId,
        url,
        reason: 'empty_response',
        classification: 'extraction_retry_before_preflight',
        attempt: attempt + 1,
        retryAfterMs,
      });
      recordDiagnosticTimingEvent({
        event: 'extraction_retry_scheduled',
        tabId,
        sourceUrl: url,
        trigger: 'automatic-preflight',
        reason: 'empty_response',
        classification: 'extraction_retry_before_preflight',
        attempt: attempt + 1,
        retryAfterMs,
      });
      scheduleTweetDataExtractionRetry(tabId, url, attempt);
    }
  } catch (error) {
    const retryAfterMs = TWEET_EXTRACTION_RETRY_DELAYS_MS[attempt];
    recordExtractionDiagnostic({
      status: 'failed',
      tabId,
      url,
      error: errorMessage(error),
      ...(retryAfterMs !== undefined ? { classification: 'extraction_retry_before_preflight' as const } : {}),
      attempt: attempt + 1,
      retryAfterMs,
    });
    recordDiagnosticTimingEvent({
      event: retryAfterMs !== undefined ? 'extraction_retry_scheduled' : 'extraction_failed',
      tabId,
      sourceUrl: url,
      trigger: 'automatic-preflight',
      reason: 'request_failed',
      ...(retryAfterMs !== undefined ? { classification: 'extraction_retry_before_preflight' as const } : {}),
      error: errorMessage(error),
      attempt: attempt + 1,
      retryAfterMs,
    });
    debugLog('Unable to request tweet extraction for icon preflight:', error);
    scheduleTweetDataExtractionRetry(tabId, url, attempt);
  }
}

/**
 * Clear tweet-specific icon updates
 */
async function clearTweetPageIcon(tabId: number, url?: string): Promise<void> {
  try {
    clearTweetDataExtractionRetry(tabId);
    clearTabDuplicateResult(tabId);
    tabMissingOriginators.delete(tabId);
    await clearInFlightOperation(tabId);
    await applyResolvedIconForTab(tabId, url, null);
  } catch (error) {
    console.error('Error clearing tweet page icon:', error);
  }
}

// Handle tab updates to detect tweet pages (full page loads)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isTweetPage = isTweetPageUrl(tab.url);

    await ensureServicesInitialized();

    if (isTweetPage) {
      recordDiagnosticTimingEvent({
        event: 'tweet_navigation_detected',
        tabId,
        sourceUrl: tab.url,
        trigger: 'automatic-preflight',
        reason: 'tabs_on_updated_complete',
      });
      await applyResolvedIconForTab(tabId, tab.url);
      await requestTweetDataExtraction(tabId, tab.url);
    } else {
      await clearTweetPageIcon(tabId, tab.url);
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await ensureServicesInitialized();

  if (lastActiveTabId !== null && lastActiveTabId !== tabId) {
    try {
      const previousTab = await chrome.tabs.get(lastActiveTabId);
      if (!isTweetPageUrl(previousTab.url)) {
        await clearTweetPageIcon(lastActiveTabId, previousTab.url);
      }
    } catch {
      clearTweetDataExtractionRetry(lastActiveTabId);
      clearAutomaticTweetExtractionRequestsForTab(lastActiveTabId);
      clearTabDuplicateResult(lastActiveTabId);
      tabMissingOriginators.delete(lastActiveTabId);
      await clearInFlightOperation(lastActiveTabId);
      tabScopedPresentationTabIds.delete(lastActiveTabId);
    }
  }

  lastActiveTabId = tabId;

  try {
    const tab = await chrome.tabs.get(tabId);
    await applyResolvedIconForTab(tabId, tab.url);
  } catch (error) {
    debugLog('Error resolving icon after tab activation:', error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTweetDataExtractionRetry(tabId);
  clearAutomaticTweetExtractionRequestsForTab(tabId);
  clearTabDuplicateResult(tabId);
  tabMissingOriginators.delete(tabId);
  void clearInFlightOperation(tabId);
  tabScopedPresentationTabIds.delete(tabId);
  if (lastActiveTabId === tabId) {
    lastActiveTabId = null;
  }
});

// Handle SPA navigations (Twitter uses History API for client-side routing).
// This catches feed→tweet navigations that don't trigger tabs.onUpdated. Two sources feed it:
//   - chrome.webNavigation.onHistoryStateUpdated (Chrome/Firefox), and
//   - a SPA_NAV message from the content script (Safari, which lacks that API — spec 002).
async function handleSpaNavigation(details: { tabId: number; url: string; frameId?: number }): Promise<void> {
  // Only process main frame navigations
  if (details.frameId !== undefined && details.frameId !== 0) return;

  const isTweetPage = isTweetPageUrl(details.url);

  if (isTweetPage) {
    debugLog('SPA navigation detected to tweet page:', details.url);

    await ensureServicesInitialized();
    recordDiagnosticTimingEvent({
      event: 'tweet_navigation_detected',
      tabId: details.tabId,
      sourceUrl: details.url,
      trigger: 'automatic-preflight',
      reason: 'history_state_updated',
    });
    await applyResolvedIconForTab(details.tabId, details.url);
    await requestTweetDataExtraction(details.tabId, details.url);
  } else {
    await ensureServicesInitialized();
    await clearTweetPageIcon(details.tabId, details.url);
  }
}

// Feature-guard the registration: Safari does not support webNavigation.onHistoryStateUpdated, and
// a bare top-level reference to it throws at background load ("background failed to load", SC-004).
// The content-script SPA_NAV message covers the same navigations where this API is absent.
if (typeof chrome.webNavigation?.onHistoryStateUpdated?.addListener === 'function') {
  chrome.webNavigation.onHistoryStateUpdated.addListener(
    (details) => { void handleSpaNavigation(details); },
    { url: WEB_NAVIGATION_PLATFORM_FILTERS },
  );
}

/**
 * Handle tweet data extracted from content script
 * Validates incoming data before storage for security
 */
async function runAutomaticPreflightForExtractedTweet(
  validatedData: CapturedPostData,
  tabId: number | undefined,
): Promise<void> {
  const sourceUrl = captureSourceUrl(validatedData);
  const handle = captureAuthorHandle(validatedData);

  if (isPrivateModeEnabled()) {
    recordPreflightDiagnostic({
      status: 'skipped',
      trigger: 'automatic-preflight',
      tabId,
      url: sourceUrl,
      handle,
      reason: 'private_mode',
    });
    if (tabId) {
      await applyResolvedIconForTab(tabId, sourceUrl);
    }
    return;
  }

  const cacheWriteEpoch = userDataWriteEpoch;
  if (!canWriteUserIdentifyingCache(cacheWriteEpoch)) {
    recordPreflightDiagnostic({
      status: 'skipped',
      trigger: 'automatic-preflight',
      tabId,
      url: sourceUrl,
      handle,
      reason: 'user_data_writes_blocked',
    });
    return;
  }

  // Store the extracted data for popup access
  await chrome.storage.local.set({
    currentPost: {
      data: validatedData,
      timestamp: Date.now(),
      url: sourceUrl
    },
    currentTweet: {
      data: validatedData,
      timestamp: Date.now(),
      url: sourceUrl
    }
  });

  debugLog('Post data stored:', validatedData.text.substring(0, 50) + '...');

  // Clear stale preloaded caches to prevent race conditions.
  // Do this only when starting a new preflight; forced extraction can race with
  // the content script's own auto-send for the same tweet.
  await chrome.storage.local.remove(['preloadedOriginator', 'preloadedDuplicateCheck']);

  let preflightOperation: InFlightIconOperation | null = null;
  if (tabId) {
    preflightOperation = await startInFlightOperation(
      tabId,
      sourceUrl,
      'automatic-preflight',
      handle,
    );
    tabScopedPresentationTabIds.add(tabId);
    await applyResolvedIconForTab(tabId, sourceUrl);
  }

  await checkQuoteCollectionStatus(validatedData, tabId, preflightOperation, cacheWriteEpoch);
}

async function handleTweetDataExtracted(
  tweetData: unknown,
  tabId: number | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void,
  options: {
    keepAliveUntilIconApplied?: boolean;
  } = {},
) {
  try {
    // Validate incoming data before processing (security hardening)
    try {
      validateCapturedPostData(tweetData);
    } catch (validationError) {
      if (validationError instanceof ValidationError) {
        console.error('Post data validation failed:', validationError.message, validationError.field);
        recordExtractionDiagnostic({
          status: 'failed',
          tabId,
          error: `Invalid post data: ${validationError.message}`,
        });
        sendResponse({
          success: false,
          error: `Invalid post data: ${validationError.message}`
        });
        return;
      }
      throw validationError;
    }

    // Type assertion safe after validation
    const validatedData = tweetData as CapturedPostData;
    const sourceUrl = captureSourceUrl(validatedData);
    const sourceId = captureSourceId(validatedData);
    const handle = captureAuthorHandle(validatedData);
    recordExtractionDiagnostic({
      status: 'succeeded',
      tabId,
      url: sourceUrl,
      reason: 'post_data_received',
    });
    recordDiagnosticTimingEvent({
      event: 'valid_tweet_data_accepted',
      tabId,
      sourceUrl,
      statusId: sourceId ?? undefined,
      handle,
      trigger: 'automatic-preflight',
      reason: 'tweet_data_received',
    });
    if (tabId) {
      clearTweetDataExtractionRetry(tabId);
      tabMissingOriginators.delete(tabId);
    }

    const cacheKey = automaticPreflightCacheKey(tabId, sourceUrl);

    // Check if there's already a pending request for this URL (prevent race conditions)
    const pending = pendingDuplicateChecks.get(cacheKey);
    if (pending) {
      debugLog('Duplicate check already in progress for:', cacheKey);
      recordDiagnosticTimingEvent({
        event: 'automatic_preflight_deduped',
        tabId,
        sourceUrl,
        statusId: sourceId ?? undefined,
        handle,
        trigger: 'automatic-preflight',
        reason: 'same_tweet_preflight_in_flight',
      });
      if (options.keepAliveUntilIconApplied) {
        const waitResult = await waitForPromiseOrTimeout(pending, AUTOMATIC_PREFLIGHT_KEEPALIVE_MS);
        if (waitResult === 'timeout') {
          clearPendingDuplicateCheckIfCurrent(cacheKey, pending);
        }
      }
      sendResponse({ success: true });
      return;
    }

    // Keep the message port alive long enough for the automatic icon write. Without this,
    // MV3 may suspend the worker after the content-script response while the tray is closed.
    const checkPromise = runAutomaticPreflightForExtractedTweet(validatedData, tabId);
    pendingDuplicateChecks.set(cacheKey, checkPromise);

    void checkPromise
      .catch(error => {
        console.error('Error checking quote collection status:', error);
      })
      .finally(() => {
        clearPendingDuplicateCheckIfCurrent(cacheKey, checkPromise);
      });

    if (options.keepAliveUntilIconApplied) {
      const waitResult = await waitForPromiseOrTimeout(checkPromise, AUTOMATIC_PREFLIGHT_KEEPALIVE_MS);
      if (waitResult === 'timeout') {
        clearPendingDuplicateCheckIfCurrent(cacheKey, checkPromise);
      }
    }
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error storing tweet data:', error);
    recordExtractionDiagnostic({
      status: 'failed',
      tabId,
      error: errorMessage(error),
    });
    sendResponse({ error: 'Failed to store tweet data' });
  }
}

async function updateIconAfterDuplicateCheckResponse(
  response: unknown,
  tabId: number | undefined,
  sourceUrl: string | undefined,
): Promise<void> {
  if (!tabId) {
    return;
  }

  if (await applyAuthRequiredApiResponse(response, {
    tabId,
    url: sourceUrl,
    trigger: 'explicit-duplicate-check',
  })) {
    return;
  }

  if (sourceUrl && !await isSenderTabStillOnSourceUrl(tabId, sourceUrl)) {
    await clearInFlightOperation(tabId, {
      url: sourceUrl,
      triggers: ['explicit-duplicate-check'],
    });
    recordPreflightDiagnostic({
      status: 'skipped',
      trigger: 'explicit-duplicate-check',
      tabId,
      url: sourceUrl,
      reason: 'stale_duplicate_check_response',
    });
    return;
  }

  const duplicateResult = duplicateResultFromResponse(response);
  setTabDuplicateResult(tabId, duplicateResult, sourceUrl);
  clearTweetDataExtractionRetry(tabId);
  tabMissingOriginators.delete(tabId);
  await clearInFlightOperation(tabId, {
    url: sourceUrl,
    triggers: ['explicit-duplicate-check'],
  });
  recordPreflightDiagnostic({
    status: 'succeeded',
    trigger: 'explicit-duplicate-check',
    tabId,
    url: sourceUrl,
    reason: 'duplicate_check_response',
    duplicate: summarizeDuplicateResult(duplicateResult),
  });

  if (duplicateResult) {
    tabScopedPresentationTabIds.add(tabId);
    if (sourceUrl) {
      await chrome.storage.local.set({
        preloadedDuplicateCheck: {
          url: sourceUrl,
          result: duplicateResult,
          timestamp: Date.now(),
        },
      });
    }
  }

  await applyResolvedIconForTab(tabId, sourceUrl, duplicateResult);
}

async function applyOriginatorLookupLoading(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id;
  const sourceUrl = sourceUrlFromMessage(message, sender);
  if (!tabId || !sourceUrl || !isTweetPageUrl(sourceUrl)) {
    return;
  }

  const handle = typeof message.data?.handle === 'string' ? message.data.handle : undefined;
  await clearInFlightOperation(tabId, {
    url: sourceUrl,
    triggers: ['automatic-preflight'],
  });

  recordPreflightDiagnostic({
    status: 'loading',
    trigger: 'originator-lookup',
    tabId,
    url: sourceUrl,
    handle,
  });
  await startInFlightOperation(tabId, sourceUrl, 'originator-lookup', handle);
  tabScopedPresentationTabIds.add(tabId);
  await applyResolvedIconForTab(tabId, sourceUrl, getCachedDuplicateResultForTab(tabId, sourceUrl).result);
}

interface OriginatorLookupApplicationContext {
  tabId: number;
  sourceUrl: string;
  trigger: DiagnosticTrigger;
  handle?: string;
  operation?: InFlightIconOperation | null;
  staleReason?: string;
}

async function clearOriginatorLookupOperation(context: OriginatorLookupApplicationContext): Promise<void> {
  if (context.operation) {
    await clearInFlightOperation(context.tabId, {
      url: context.sourceUrl,
      operationId: context.operation.operationId,
    });
    return;
  }

  await clearInFlightOperation(context.tabId, {
    url: context.sourceUrl,
    triggers: ['automatic-preflight', 'automatic-originator-fallback', 'originator-lookup'],
  });
}

async function shouldApplyOriginatorLookupResult(
  context: OriginatorLookupApplicationContext,
): Promise<boolean> {
  if (context.operation) {
    const currentOperation = getMatchingInFlightOperation(context.tabId, context.sourceUrl);
    if (!currentOperation || currentOperation.operationId !== context.operation.operationId) {
      return false;
    }
  }

  return isSenderTabStillOnSourceUrl(context.tabId, context.sourceUrl);
}

async function applyOriginatorLookupResponse(
  response: unknown,
  context: OriginatorLookupApplicationContext,
): Promise<void> {
  const { tabId, sourceUrl, trigger } = context;

  if (await applyAuthRequiredApiResponse(response, {
    tabId,
    url: sourceUrl,
    trigger,
    handle: context.handle,
  })) {
    return;
  }

  if (!await shouldApplyOriginatorLookupResult(context)) {
    await clearOriginatorLookupOperation(context);
    recordPreflightDiagnostic({
      status: 'skipped',
      trigger,
      tabId,
      url: sourceUrl,
      handle: context.handle,
      reason: context.staleReason ?? 'stale_originator_lookup_response',
    });
    return;
  }

  const lookup = response as {
    success?: unknown;
    found?: unknown;
    handle?: unknown;
    platform?: unknown;
    create_url?: unknown;
    originator?: unknown;
    error?: unknown;
  };

  if (lookup.success !== true) {
    await clearOriginatorLookupOperation(context);
    recordPreflightDiagnostic({
      status: 'failed',
      trigger,
      tabId,
      url: sourceUrl,
      handle: context.handle,
      reason: 'originator_lookup_unsuccessful',
      error: typeof lookup.error === 'string' ? lookup.error : undefined,
    });
    await applyResolvedIconForTab(tabId, sourceUrl, getCachedDuplicateResultForTab(tabId, sourceUrl).result);
    return;
  }

  const handle = typeof lookup.handle === 'string'
    ? lookup.handle
    : context.handle;
  if (!handle) {
    await clearOriginatorLookupOperation(context);
    await applyResolvedIconForTab(tabId, sourceUrl, getCachedDuplicateResultForTab(tabId, sourceUrl).result);
    return;
  }

  await clearOriginatorLookupOperation(context);

  if (lookup.found === false) {
    const lookupPlatform = typeof lookup.platform === 'string' && lookup.platform in PLATFORM_DEFINITIONS
      ? lookup.platform as CapturePlatform
      : captureIdentityFromUrl(sourceUrl)?.platform ?? 'twitter';
    const createUrl = resolveOriginatorCreateUrl(handle, lookupPlatform, lookup.create_url);
    const normalizedHandle = handle.toLowerCase();
    const existingDuplicate = getCachedDuplicateResultForTab(tabId, sourceUrl);

    if (!canWriteUserIdentifyingCache(context.operation?.cacheWriteEpoch)) {
      recordPreflightDiagnostic({
        status: 'skipped',
        trigger,
        tabId,
        url: sourceUrl,
        handle: normalizedHandle,
        reason: 'user_data_writes_blocked',
      });
      return;
    }

    tabMissingOriginators.set(tabId, {
      handle: normalizedHandle,
      url: sourceUrl,
      createUrl,
      timestamp: Date.now(),
    });
    await chrome.storage.local.set({
      preloadedOriginator: {
        handle: normalizedHandle,
        originator: null,
        ...(createUrl ? { create_url: createUrl } : {}),
        timestamp: Date.now(),
      },
    });

    if (!existingDuplicate.hasResult) {
      setTabDuplicateResult(tabId, null, sourceUrl);
    }
    tabScopedPresentationTabIds.add(tabId);
    await applyResolvedIconForTab(tabId, sourceUrl, existingDuplicate.result);
    return;
  }

  if (lookup.found === true) {
    tabMissingOriginators.delete(tabId);
    await applyResolvedIconForTab(tabId, sourceUrl, getCachedDuplicateResultForTab(tabId, sourceUrl).result);
  }
}

async function updateIconAfterOriginatorLookupResponse(
  response: unknown,
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id;
  const sourceUrl = sourceUrlFromMessage(message, sender);
  if (!tabId || !sourceUrl || !isTweetPageUrl(sourceUrl)) {
    return;
  }

  const data = message.data as Record<string, unknown> | undefined;
  const handle = typeof data?.handle === 'string' ? data.handle : undefined;
  await applyOriginatorLookupResponse(response, {
    tabId,
    sourceUrl,
    trigger: 'originator-lookup',
    handle,
  });
}

async function cacheFoundOriginatorFromLookup(
  handle: string,
  lookup: { originator?: unknown; confidence?: unknown },
  cacheWriteEpoch?: number,
): Promise<void> {
  if (!canWriteUserIdentifyingCache(cacheWriteEpoch)) {
    return;
  }

  const originator = lookup.originator;
  if (!originator || typeof originator !== 'object') {
    return;
  }

  const value = originator as {
    id?: unknown;
    unique_id?: unknown;
    slug?: unknown;
    full_name?: unknown;
    sort_name_display?: unknown;
    confidence?: unknown;
  };
  const uniqueId = typeof value.unique_id === 'string'
    ? value.unique_id
    : typeof value.slug === 'string'
      ? value.slug
      : undefined;
  if (typeof value.id !== 'number' || typeof value.full_name !== 'string' || !uniqueId) {
    return;
  }

  const confidence = typeof value.confidence === 'number'
    ? value.confidence
    : typeof lookup.confidence === 'number'
      ? lookup.confidence
      : 1.0;

  await chrome.storage.local.set({
    preloadedOriginator: {
      handle: handle.toLowerCase(),
      originator: {
        id: value.id,
        full_name: value.full_name,
        unique_id: uniqueId,
        sort_name_display: typeof value.sort_name_display === 'string'
          ? value.sort_name_display
          : value.full_name,
        confidence,
      },
      timestamp: Date.now(),
    },
  });
}

async function requestOriginatorLookupForOperation(
  operation: InFlightIconOperation,
  messages: {
    unavailable: string;
    timedOut: string;
  },
): Promise<unknown> {
  if (!apiHandler || !operation.handle) {
    return {
      success: false,
      error: messages.unavailable,
    };
  }

  return new Promise<unknown>((resolve) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        success: false,
        error: messages.timedOut,
      });
    }, ORIGINATOR_FALLBACK_TIMEOUT_MS);

    const settle = (response: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(response);
    };

    Promise.resolve(apiHandler!.handleMessage(
      {
        type: MessageType.LOOKUP_ORIGINATOR_BY_HANDLE,
        data: {
          handle: operation.handle,
          platform: operation.platform ?? captureIdentityFromUrl(operation.url)?.platform ?? 'twitter',
          source_url: operation.url,
        },
      },
      {
        tab: {
          id: operation.tabId,
          url: operation.url,
        },
      } as chrome.runtime.MessageSender,
      settle,
    )).catch(error => {
      settle({
        success: false,
        error: errorMessage(error),
      });
    });
  });
}

async function requestOriginatorFallback(
  operation: InFlightIconOperation,
): Promise<unknown> {
  return requestOriginatorLookupForOperation(operation, {
    unavailable: 'Originator fallback unavailable',
    timedOut: 'Originator fallback timed out',
  });
}

async function requestAutomaticOriginatorProbe(
  operation: InFlightIconOperation,
): Promise<unknown> {
  const requestedAt = Date.now();
  recordDiagnosticTimingEvent({
    event: 'originator_probe_request_sent',
    ...operationTimingFields(operation),
    durationMs: durationSince(operation.startedAt),
  });

  const response = await requestOriginatorLookupForOperation(operation, {
    unavailable: 'Automatic originator probe unavailable',
    timedOut: 'Automatic originator probe timed out',
  });
  const isTimeout = isAutomaticOriginatorProbeTimeoutResponse(response);
  recordDiagnosticTimingEvent({
    event: 'originator_probe_response_received',
    ...operationTimingFields(operation),
    reason: isTimeout ? 'originator_probe_lookup_timeout' : undefined,
    ...(isTimeout ? { classification: 'probe_lookup_timeout' as const } : {}),
    durationMs: Date.now() - requestedAt,
  });

  return response;
}

async function applyAutomaticOriginatorProbeResponse(
  response: unknown,
  operation: InFlightIconOperation,
): Promise<void> {
  if (!await shouldApplyAutomaticOriginatorProbeResult(operation)) {
    recordPreflightDiagnostic({
      status: 'skipped',
      trigger: 'automatic-originator-probe',
      tabId: operation.tabId,
      url: operation.url,
      handle: operation.handle,
      operationId: operation.operationId,
      durationMs: durationSince(operation.startedAt),
      reason: 'stale_originator_probe_response',
      classification: 'probe_stale_after_navigation',
    });
    recordDiagnosticTimingEvent({
      event: 'originator_probe_skipped',
      ...operationTimingFields(operation),
      reason: 'stale_originator_probe_response',
      classification: 'probe_stale_after_navigation',
      durationMs: durationSince(operation.startedAt),
    });
    return;
  }

  if (await applyAuthRequiredApiResponse(response, {
    tabId: operation.tabId,
    url: operation.url,
    trigger: 'automatic-originator-probe',
    handle: operation.handle,
  })) {
    return;
  }

  const lookup = response as {
    success?: unknown;
    found?: unknown;
    handle?: unknown;
    platform?: unknown;
    match_platform?: unknown;
    confidence?: unknown;
    create_url?: unknown;
    originator?: unknown;
    error?: unknown;
  };

  if (lookup.success !== true || typeof lookup.found !== 'boolean') {
    const isTimeout = isAutomaticOriginatorProbeTimeoutResponse(response);
    recordPreflightDiagnostic({
      status: 'failed',
      trigger: 'automatic-originator-probe',
      tabId: operation.tabId,
      url: operation.url,
      handle: operation.handle,
      operationId: operation.operationId,
      durationMs: durationSince(operation.startedAt),
      reason: 'originator_probe_unsuccessful',
      ...(isTimeout ? { classification: 'probe_lookup_timeout' as const } : {}),
      error: typeof lookup.error === 'string' ? lookup.error : undefined,
    });
    recordDiagnosticTimingEvent({
      event: 'originator_probe_failed',
      ...operationTimingFields(operation),
      reason: isTimeout ? 'originator_probe_lookup_timeout' : 'originator_probe_unsuccessful',
      ...(isTimeout ? { classification: 'probe_lookup_timeout' as const } : {}),
      durationMs: durationSince(operation.startedAt),
      error: typeof lookup.error === 'string' ? lookup.error : undefined,
    });
    return;
  }

  const handle = typeof lookup.handle === 'string'
    ? lookup.handle
    : operation.handle;
  if (!handle) {
    recordPreflightDiagnostic({
      status: 'failed',
      trigger: 'automatic-originator-probe',
      tabId: operation.tabId,
      url: operation.url,
      operationId: operation.operationId,
      durationMs: durationSince(operation.startedAt),
      reason: 'originator_probe_missing_handle',
      originator: summarizeHandleLookupResult(lookup, operation.handle),
    });
    recordDiagnosticTimingEvent({
      event: 'originator_probe_failed',
      ...operationTimingFields(operation),
      reason: 'originator_probe_missing_handle',
      durationMs: durationSince(operation.startedAt),
    });
    return;
  }

  const normalizedHandle = handle.toLowerCase();

  if (lookup.found === false) {
    if (!canWriteUserIdentifyingCache(operation.cacheWriteEpoch)) {
      recordPreflightDiagnostic({
        status: 'skipped',
        trigger: 'automatic-originator-probe',
        tabId: operation.tabId,
        url: operation.url,
        handle: normalizedHandle,
        operationId: operation.operationId,
        durationMs: durationSince(operation.startedAt),
        reason: 'user_data_writes_blocked',
      });
      return;
    }

    const createUrl = resolveOriginatorCreateUrl(handle, operation.platform ?? 'twitter', lookup.create_url);

    tabMissingOriginators.set(operation.tabId, {
      handle: normalizedHandle,
      url: operation.url,
      createUrl,
      timestamp: Date.now(),
    });
    await chrome.storage.local.set({
      preloadedOriginator: {
        handle: normalizedHandle,
        originator: null,
        ...(createUrl ? { create_url: createUrl } : {}),
        timestamp: Date.now(),
      },
    });

    setTabDuplicateResult(operation.tabId, null, operation.url);

    await clearInFlightOperation(operation.tabId, {
      url: operation.url,
      operationId: operation.operationId,
      triggers: ['automatic-preflight'],
    });
    tabScopedPresentationTabIds.add(operation.tabId);
    recordPreflightDiagnostic({
      status: 'succeeded',
      trigger: 'automatic-originator-probe',
      tabId: operation.tabId,
      url: operation.url,
      handle: normalizedHandle,
      operationId: operation.operationId,
      durationMs: durationSince(operation.startedAt),
      reason: 'originator_probe_not_found',
      originator: summarizeHandleLookupResult(lookup, normalizedHandle),
    });
    recordDiagnosticTimingEvent({
      event: 'originator_probe_applied',
      ...operationTimingFields(operation),
      handle: normalizedHandle,
      reason: 'originator_probe_not_found',
      durationMs: durationSince(operation.startedAt),
    });
    await applyResolvedIconForTab(operation.tabId, operation.url, null);
    return;
  }

  tabMissingOriginators.delete(operation.tabId);
  await cacheFoundOriginatorFromLookup(normalizedHandle, lookup, operation.cacheWriteEpoch);
  recordPreflightDiagnostic({
    status: 'succeeded',
    trigger: 'automatic-originator-probe',
    tabId: operation.tabId,
    url: operation.url,
    handle: normalizedHandle,
    operationId: operation.operationId,
    durationMs: durationSince(operation.startedAt),
    reason: 'originator_probe_found',
    originator: summarizeHandleLookupResult(lookup, normalizedHandle),
  });
  recordDiagnosticTimingEvent({
    event: 'originator_probe_applied',
    ...operationTimingFields(operation),
    handle: normalizedHandle,
    reason: 'originator_probe_found',
    durationMs: durationSince(operation.startedAt),
  });
}

async function runAutomaticOriginatorProbe(operation: InFlightIconOperation): Promise<void> {
  if (!operation.handle || !apiHandler) {
    recordDiagnosticTimingEvent({
      event: 'originator_probe_skipped',
      ...operationTimingFields(operation),
      reason: !operation.handle ? 'missing_handle' : 'api_handler_unavailable',
      durationMs: durationSince(operation.startedAt),
    });
    return;
  }

  if (!await shouldApplyAutomaticOriginatorProbeResult(operation)) {
    recordDiagnosticTimingEvent({
      event: 'originator_probe_skipped',
      ...operationTimingFields(operation),
      reason: 'stale_before_probe_request',
      classification: 'probe_stale_after_navigation',
      durationMs: durationSince(operation.startedAt),
    });
    return;
  }

  const response = await requestAutomaticOriginatorProbe(operation);
  await applyAutomaticOriginatorProbeResponse(response, operation);
}

async function runAutomaticOriginatorFallback(
  timedOutOperation: InFlightIconOperation,
): Promise<boolean> {
  if (!timedOutOperation.handle || !apiHandler) {
    recordDiagnosticTimingEvent({
      event: 'automatic_preflight_timeout_fallback_skipped',
      ...operationTimingFields(timedOutOperation),
      reason: !timedOutOperation.handle ? 'missing_handle' : 'api_handler_unavailable',
      classification: 'combined_preflight_timeout',
      durationMs: durationSince(timedOutOperation.startedAt),
    });
    return false;
  }

  recordDiagnosticTimingEvent({
    event: 'automatic_preflight_timeout_fallback_started',
    ...operationTimingFields(timedOutOperation),
    reason: 'preflight_timeout_fallback',
    classification: 'combined_preflight_timeout',
    durationMs: durationSince(timedOutOperation.startedAt),
  });

  const fallbackOperation = await startInFlightOperation(
    timedOutOperation.tabId,
    timedOutOperation.url,
    'automatic-originator-fallback',
    timedOutOperation.handle,
  );
  if (!fallbackOperation) {
    recordDiagnosticTimingEvent({
      event: 'automatic_preflight_timeout_fallback_skipped',
      ...operationTimingFields(timedOutOperation),
      reason: 'fallback_operation_unavailable',
      classification: 'combined_preflight_timeout',
      durationMs: durationSince(timedOutOperation.startedAt),
    });
    return false;
  }

  recordPreflightDiagnostic({
    status: 'loading',
    trigger: 'automatic-originator-fallback',
    tabId: timedOutOperation.tabId,
    url: timedOutOperation.url,
    handle: timedOutOperation.handle,
    operationId: fallbackOperation.operationId,
    durationMs: durationSince(timedOutOperation.startedAt),
    reason: 'preflight_timeout_fallback',
    classification: 'combined_preflight_timeout',
  });
  tabScopedPresentationTabIds.add(timedOutOperation.tabId);
  await applyResolvedIconForTab(
    timedOutOperation.tabId,
    timedOutOperation.url,
    getCachedDuplicateResultForTab(timedOutOperation.tabId, timedOutOperation.url).result,
  );

  const response = await requestOriginatorFallback(fallbackOperation);
  await applyOriginatorLookupResponse(response, {
    tabId: fallbackOperation.tabId,
    sourceUrl: fallbackOperation.url,
    trigger: 'automatic-originator-fallback',
    handle: fallbackOperation.handle,
    operation: fallbackOperation,
    staleReason: 'stale_originator_fallback_response',
  });
  recordDiagnosticTimingEvent({
    event: 'automatic_preflight_timeout_fallback_applied',
    ...operationTimingFields(fallbackOperation),
    reason: 'preflight_timeout_fallback',
    classification: 'combined_preflight_timeout',
    durationMs: durationSince(timedOutOperation.startedAt),
  });
  return true;
}

async function handleOriginatorLookupStatus(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void,
): Promise<void> {
  await updateIconAfterOriginatorLookupResponse(
    {
      success: true,
      ...(message.data ?? {}),
    },
    message,
    sender,
  );
  sendResponse({ success: true });
}

async function handleLookupOriginatorByHandle(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void,
): Promise<void> {
  await applyOriginatorLookupLoading(message, sender);
  await apiHandler!.handleMessage(message, sender, (response) => {
    updateIconAfterOriginatorLookupResponse(response, message, sender)
      .catch(error => {
        debugLog('Error applying originator lookup icon state:', error);
      })
      .finally(() => {
        sendResponse(response);
      });
  });
}

async function handleCheckDuplicate(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void
): Promise<void> {
  const tabId = sender.tab?.id;
  const sourceUrl = sourceUrlFromMessage(message, sender);

  if (tabId && isTweetPageUrl(sourceUrl)) {
    recordPreflightDiagnostic({
      status: 'loading',
      trigger: 'explicit-duplicate-check',
      tabId,
      url: sourceUrl,
    });
    await startInFlightOperation(tabId, sourceUrl, 'explicit-duplicate-check');
    tabScopedPresentationTabIds.add(tabId);
    try {
      await applyResolvedIconForTab(tabId, sourceUrl, null);
    } catch (error) {
      debugLog('Error applying duplicate-check loading icon:', error);
    }
  }

  try {
    await apiHandler!.handleMessage(message, sender, (response) => {
      updateIconAfterDuplicateCheckResponse(response, tabId, sourceUrl)
        .catch(error => {
          debugLog('Error applying duplicate-check result icon:', error);
        })
        .finally(() => {
          sendResponse(response);
        });
    });
  } catch (error) {
    if (tabId) {
      setTabDuplicateResult(tabId, null, sourceUrl);
      await clearInFlightOperation(tabId, {
        url: sourceUrl,
        triggers: ['explicit-duplicate-check'],
      });
      recordPreflightDiagnostic({
        status: 'failed',
        trigger: 'explicit-duplicate-check',
        tabId,
        url: sourceUrl,
        error: errorMessage(error),
      });
      try {
        await applyResolvedIconForTab(tabId, sourceUrl, null);
      } catch (iconError) {
        debugLog('Error clearing duplicate-check loading icon:', iconError);
      }
    }
    throw error;
  }
}

async function handleCheckNow(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void,
): Promise<void> {
  const tabId = sender.tab?.id;
  const data = message.data as Record<string, unknown> | undefined;
  const sourceUrl = typeof data?.sourceUrl === 'string'
    ? data.sourceUrl
    : typeof data?.source_url === 'string'
      ? data.source_url
      : sender.tab?.url;
  const handle = typeof data?.handle === 'string' ? data.handle : undefined;
  const text = typeof data?.text === 'string' ? data.text : undefined;
  const platform = typeof data?.platform === 'string' && data.platform in PLATFORM_DEFINITIONS
    ? data.platform as CapturePlatform
    : captureIdentityFromUrl(sourceUrl)?.platform ?? 'twitter';

  if (!sourceUrl || !isTweetPageUrl(sourceUrl)) {
    sendResponse({ success: false, skipped: true, error: 'No current post' });
    return;
  }

  if (tabId && !await isSenderTabStillOnSourceUrl(tabId, sourceUrl)) {
    sendResponse({ success: false, skipped: true, error: 'Post changed before check completed' });
    return;
  }

  if (!handle || !text) {
    sendResponse({ success: false, error: 'Handle and quote text are required' });
    return;
  }

  recordPreflightDiagnostic({
    status: 'loading',
    trigger: 'explicit-duplicate-check',
    tabId,
    url: sourceUrl,
    handle,
  });

  await apiHandler!.handleMessage(
    {
      type: MessageType.PREFLIGHT_CHECK,
      data: {
        handle,
        platform,
        text,
        source_url: sourceUrl,
      },
    },
    sender,
    (response) => {
      void (async () => {
        if (await applyAuthRequiredApiResponse(response, {
          tabId,
          url: sourceUrl,
          trigger: 'explicit-duplicate-check',
          handle,
        })) {
          sendResponse(response);
          return;
        }

        const duplicateResult = duplicateResultFromResponse({
          success: response?.success,
          result: response?.duplicate_check,
        });

        if (tabId && duplicateResult) {
          setTabDuplicateResult(tabId, duplicateResult, sourceUrl);
          tabScopedPresentationTabIds.add(tabId);
          await applyResolvedIconForTab(tabId, sourceUrl, duplicateResult);
        }

        recordPreflightDiagnostic({
          status: response?.success ? 'succeeded' : 'failed',
          trigger: 'explicit-duplicate-check',
          tabId,
          url: sourceUrl,
          handle,
          reason: 'check_now_response',
          duplicate: summarizeDuplicateResult(duplicateResult),
          originator: summarizeOriginatorResult(response?.originator),
          error: typeof response?.error === 'string' ? response.error : undefined,
        });

        sendResponse(response);
      })().catch(error => {
        sendResponse({ success: false, error: errorMessage(error) });
      });
    },
  );
}

/**
 * Check if a quote exists in Quotewise and update badge accordingly
 * Uses single preflight API call for both originator lookup and duplicate check
 * (Reduces round-trips from 2 API calls to 1)
 */
async function checkQuoteCollectionStatus(
  postData: CapturedPostData,
  tabId?: number,
  operation: InFlightIconOperation | null = null,
  cacheWriteEpoch: number | undefined = operation?.cacheWriteEpoch,
): Promise<void> {
  const targetTabId = await resolveTargetTabId(tabId);
  const sourceUrl = captureSourceUrl(postData);
  const handle = captureAuthorHandle(postData);
  const platform = capturePlatform(postData);
  let preflightOperation = operation;
  let shouldApplyFinalIcon = true;

  if (isPrivateModeEnabled()) {
    recordPreflightDiagnostic({
      status: 'skipped',
      trigger: 'automatic-preflight',
      tabId: targetTabId,
      url: sourceUrl,
      handle,
      operationId: preflightOperation?.operationId,
      reason: 'private_mode',
    });
    if (targetTabId) {
      await clearInFlightOperation(targetTabId, {
        url: sourceUrl,
        triggers: ['automatic-preflight'],
      });
      await applyResolvedIconForTab(targetTabId, sourceUrl);
    }
    return;
  }

  if (targetTabId && !preflightOperation) {
    preflightOperation = await startInFlightOperation(
      targetTabId,
      sourceUrl,
      'automatic-preflight',
      handle,
    );
    if (preflightOperation) {
      tabScopedPresentationTabIds.add(targetTabId);
      await applyResolvedIconForTab(targetTabId, sourceUrl);
    }
  }

  recordPreflightDiagnostic({
    status: 'loading',
    trigger: 'automatic-preflight',
    tabId: targetTabId,
    url: sourceUrl,
    handle,
    operationId: preflightOperation?.operationId,
    durationMs: durationSince(preflightOperation?.startedAt),
  });

  try {
    // Ensure API handler is initialized
    await ensureServicesInitialized();

    if (!apiHandler) {
      recordPreflightDiagnostic({
        status: 'skipped',
        trigger: 'automatic-preflight',
        tabId: targetTabId,
        url: sourceUrl,
        handle,
        operationId: preflightOperation?.operationId,
        durationMs: durationSince(preflightOperation?.startedAt),
        reason: 'api_handler_unavailable',
      });
      debugLog('API handler not available for collection check');
      if (targetTabId) {
        tabMissingOriginators.delete(targetTabId);
      }
      return;
    }

    if (authStateManager && !authStateManager.isAuthenticated()) {
      recordPreflightDiagnostic({
        status: 'skipped',
        trigger: 'automatic-preflight',
        tabId: targetTabId,
        url: sourceUrl,
        handle,
        operationId: preflightOperation?.operationId,
        durationMs: durationSince(preflightOperation?.startedAt),
        reason: 'not_authenticated',
      });
      debugLog('User not authenticated, skipping collection check');
      if (targetTabId) {
        setTabDuplicateResult(targetTabId, null, sourceUrl);
        tabMissingOriginators.delete(targetTabId);
      }
      return;
    }

    if (!handle) {
      recordPreflightDiagnostic({
        status: 'skipped',
        trigger: 'automatic-preflight',
        tabId: targetTabId,
        url: sourceUrl,
        operationId: preflightOperation?.operationId,
        durationMs: durationSince(preflightOperation?.startedAt),
        reason: 'missing_handle',
      });
      debugLog('No handle available for preflight check');
      if (targetTabId) {
        setTabDuplicateResult(targetTabId, null, sourceUrl);
        tabMissingOriginators.delete(targetTabId);
      }
      return;
    }

    // Single preflight call combines originator lookup + duplicate check
    debugLog('Running preflight check for handle:', handle);
    const preflightRequestStartedAt = Date.now();
    const preflightResponse = await new Promise<{
      success: boolean;
      authRequired?: boolean;  // True when 401/authentication error occurred
      originator?: PreflightOriginatorResult;
      duplicate_check?: {
        [key: string]: unknown;
      } & DuplicateCheckResult;
    }>((resolve) => {
      apiHandler!.handleMessage(
        {
          type: MessageType.PREFLIGHT_CHECK,
          data: {
            handle,
            platform,
            source_url: sourceUrl
          }
        },
        {} as chrome.runtime.MessageSender,
        resolve
      );
    });
    recordDiagnosticTimingEvent({
      event: 'automatic_preflight_response_received',
      ...(preflightOperation
        ? operationTimingFields(preflightOperation)
        : {
          ...(targetTabId ? { tabId: targetTabId } : {}),
          sourceUrl,
          handle,
          trigger: 'automatic-preflight' as const,
        }),
      reason: preflightResponse.success ? 'preflight_success' : 'preflight_unsuccessful',
      durationMs: Date.now() - preflightRequestStartedAt,
    });

    if (!await shouldApplyPreflightOperationResult(targetTabId, sourceUrl, preflightOperation)) {
      shouldApplyFinalIcon = false;
      recordPreflightDiagnostic({
        status: 'skipped',
        trigger: 'automatic-preflight',
        tabId: targetTabId,
        url: sourceUrl,
        handle,
        operationId: preflightOperation?.operationId,
        durationMs: durationSince(preflightOperation?.startedAt),
        reason: 'stale_preflight_result',
      });
      return;
    }

    if (preflightOperation && hasAutomaticOriginatorProbeTimer(preflightOperation)) {
      recordDiagnosticTimingEvent({
        event: 'originator_probe_skipped',
        ...operationTimingFields(preflightOperation),
        reason: 'preflight_completed_before_probe',
        classification: 'preflight_won_before_probe',
        durationMs: durationSince(preflightOperation.startedAt),
      });
    }

    if (!preflightResponse.success) {
      // Check if this is an authentication error
      if (preflightResponse.authRequired) {
        recordPreflightDiagnostic({
          status: 'failed',
          trigger: 'automatic-preflight',
          tabId: targetTabId,
          url: sourceUrl,
          handle,
          operationId: preflightOperation?.operationId,
          durationMs: durationSince(preflightOperation?.startedAt),
          reason: 'authentication_required',
          authRequired: true,
        });
        debugLog('Preflight failed: authentication required');
        await applyAuthRequiredApiResponse(preflightResponse, {
          tabId: targetTabId,
          url: sourceUrl,
          trigger: 'automatic-preflight',
          handle,
        });
        return;
      }

      recordPreflightDiagnostic({
        status: 'failed',
        trigger: 'automatic-preflight',
        tabId: targetTabId,
        url: sourceUrl,
        handle,
        operationId: preflightOperation?.operationId,
        durationMs: durationSince(preflightOperation?.startedAt),
        reason: 'preflight_unsuccessful',
      });
      debugLog('Preflight check failed, falling back to ambient icon state');
      if (targetTabId) {
        setTabDuplicateResult(targetTabId, null, sourceUrl);
        tabMissingOriginators.delete(targetTabId);
      }
      return;
    }

    debugLog('Preflight response:', preflightResponse);

    if (!canWriteUserIdentifyingCache(cacheWriteEpoch)) {
      shouldApplyFinalIcon = false;
      recordPreflightDiagnostic({
        status: 'skipped',
        trigger: 'automatic-preflight',
        tabId: targetTabId,
        url: sourceUrl,
        handle,
        operationId: preflightOperation?.operationId,
        durationMs: durationSince(preflightOperation?.startedAt),
        reason: 'user_data_writes_blocked',
      });
      return;
    }

    // Cache originator result for overlay to use
    const originatorResult = preflightResponse.originator;
    const duplicateResult = preflightResponse.duplicate_check;
    const originatorSlug = originatorSlugFromPreflight(originatorResult);
    const isUnusableFoundOriginator = originatorResult?.found === true &&
      !!originatorResult.originator &&
      !originatorSlug;
    const isMissingOriginator = (
      originatorResult?.found === false ||
      isUnusableFoundOriginator
    ) && duplicateResult?.search_metadata?.error !== true;

    if (originatorResult) {
      if (originatorResult.found && originatorResult.originator) {
        if (targetTabId) {
          if (isMissingOriginator) {
            tabMissingOriginators.set(targetTabId, {
              handle: handle.toLowerCase(),
              url: sourceUrl,
              createUrl: resolveOriginatorCreateUrl(handle, platform, originatorResult.create_url),
              timestamp: Date.now(),
            });
          } else {
            tabMissingOriginators.delete(targetTabId);
          }
        }
        if (originatorSlug) {
          // Transform to match expected overlay format.
          await chrome.storage.local.set({
            preloadedOriginator: {
              handle: handle.toLowerCase(),
              ...(platform !== 'twitter' ? { platform } : {}),
              originator: {
                id: originatorResult.originator.id,
                full_name: originatorResult.originator.full_name,
                unique_id: originatorSlug,
                sort_name_display: originatorResult.originator.full_name,
                confidence: originatorResult.confidence ?? 1.0
              },
              timestamp: Date.now()
            }
          });
          debugLog('Originator found:', originatorResult.originator.full_name);
        } else {
          const createUrl = resolveOriginatorCreateUrl(handle, platform, originatorResult.create_url);
          debugLog('Preflight originator found without slug:', originatorResult.originator.full_name);
          await chrome.storage.local.set({
            preloadedOriginator: {
              handle: handle.toLowerCase(),
              ...(platform !== 'twitter' ? { platform } : {}),
              originator: null,
              create_url: createUrl,
              timestamp: Date.now()
            }
          });
        }
      } else {
        const createUrl = resolveOriginatorCreateUrl(handle, platform, originatorResult.create_url);
        const preloadedOriginator = {
          handle: handle.toLowerCase(),
          ...(platform !== 'twitter' ? { platform } : {}),
          originator: null,
          create_url: createUrl,
          timestamp: Date.now()
        };
        await chrome.storage.local.set({
          preloadedOriginator
        });
        if (targetTabId && isMissingOriginator) {
          tabMissingOriginators.set(targetTabId, {
            handle: handle.toLowerCase(),
            url: sourceUrl,
            createUrl,
            timestamp: Date.now(),
          });
        } else if (targetTabId) {
          tabMissingOriginators.delete(targetTabId);
        }
        debugLog('Originator not found for handle:', handle);
      }
    } else if (targetTabId) {
      tabMissingOriginators.delete(targetTabId);
    }

    // Cache duplicate check result for overlay to use
    if (targetTabId) {
      setTabDuplicateResult(targetTabId, duplicateResult ?? null, sourceUrl);
    }

    if (duplicateResult) {
      await chrome.storage.local.set({
        preloadedDuplicateCheck: {
          url: sourceUrl,
          result: duplicateResult,
          timestamp: Date.now()
        }
      });
    }

    recordPreflightDiagnostic({
      status: 'succeeded',
      trigger: 'automatic-preflight',
      tabId: targetTabId,
      url: sourceUrl,
      handle,
      operationId: preflightOperation?.operationId,
      durationMs: durationSince(preflightOperation?.startedAt),
      duplicate: summarizeDuplicateResult(duplicateResult ?? null),
      originator: summarizeOriginatorResult(originatorResult),
    });
  } catch (error) {
    console.error('Error checking quote collection status:', error);
    recordPreflightDiagnostic({
      status: 'failed',
      trigger: 'automatic-preflight',
      tabId: targetTabId,
      url: sourceUrl,
      handle,
      operationId: preflightOperation?.operationId,
      durationMs: durationSince(preflightOperation?.startedAt),
      error: errorMessage(error),
    });
    if (targetTabId) {
      setTabDuplicateResult(targetTabId, null, sourceUrl);
      tabMissingOriginators.delete(targetTabId);
    }
  } finally {
    if (targetTabId) {
      const clearedOriginalOperation = await clearInFlightOperation(targetTabId, {
        url: sourceUrl,
        ...(preflightOperation ? { operationId: preflightOperation.operationId } : {}),
      });
      if (!clearedOriginalOperation && shouldApplyFinalIcon) {
        await clearInFlightOperation(targetTabId, {
          url: sourceUrl,
          triggers: ['automatic-originator-fallback'],
        });
      }
      if (shouldApplyFinalIcon) {
        await applyResolvedIconForTab(
          targetTabId,
          sourceUrl,
          getCachedDuplicateResultForTab(targetTabId, sourceUrl).result,
        );
      }
    }
  }
}

/**
 * Handle request for current tweet data from popup
 */
async function handleGetTweetData(
  tabId: number | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void
) {
  try {
    // Get stored post data, with a legacy currentTweet fallback.
    const result = await chrome.storage.local.get(['currentPost', 'currentTweet']);
    const currentPost = result.currentPost ?? result.currentTweet;
    
    // If no tabId (popup request), get the active tab
    let activeTabId = tabId;
    if (!activeTabId) {
      // Try multiple times to get active tab (popup opening can be racy)
      for (let attempt = 0; attempt < 3; attempt++) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
          activeTabId = tabs[0].id;
          break;
        }
        // Wait a bit before retrying
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
    
    if (currentPost && activeTabId) {
      // Verify the data is from the current tab
      const tab = await chrome.tabs.get(activeTabId);
      
      if (tab.url && currentPost.url && isSameCaptureUrl(currentPost.url, tab.url)) {
        sendResponse({ 
          success: true, 
          data: currentPost.data 
        });
        return;
      }
    }
    
    // If no stored data or URL mismatch, request from content script
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { 
        type: MessageType.EXTRACT_POST_DATA 
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ 
            error: 'No post data available. Make sure you are on a supported permalink page.' 
          });
        } else {
          sendResponse(response);
        }
      });
    } else {
      // If we have stored post data but no active tab, try to send the stored data
      if (currentPost && currentPost.data) {
        sendResponse({ 
          success: true, 
          data: currentPost.data 
        });
      } else {
        sendResponse({ error: 'No active tab found' });
      }
    }
  } catch (error) {
    console.error('Error getting post data:', error);
    sendResponse({ error: 'Failed to get post data' });
  }
}

/**
 * Handle collection badge update from popup
 */
async function handleUpdateCollectionBadge(
  badgeInfo: CollectionBadgeInfo,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void
) {
  try {
    const tabId = await resolveTargetTabId();
    if (!tabId) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    const presentation = presentationForCollectionBadge(badgeInfo);
    if (presentation.scope === 'tab') {
      tabScopedPresentationTabIds.add(tabId);
    }

    await applyIconPresentation(presentation, tabId, {
      forceTabScope: presentation.scope === 'global',
    });

    sendResponse({ success: true });
  } catch (error) {
    console.error('Error updating collection badge:', error);
    sendResponse({ success: false, error: 'Failed to update badge' });
  }
}
