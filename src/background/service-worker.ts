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
import { startSafariSignIn, completeSafariSignIn } from '../auth/safari-signin';
import { isSafariExtension } from '../auth/native-bridge';
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
  duplicateResultFromResponse,
  errorMessage,
  getRuntimeDiagnostics,
  type DiagnosticTrigger,
  type MissingOriginatorInfo,
  type RuntimeDiagnostics,
  type RuntimeDiagnosticsContext,
} from './diagnostics';
import {
  tabInFlightOperations,
  PREFLIGHT_TIMEOUT_ALARM_PREFIX,
  createOperationId,
  preflightTimeoutAlarmName,
  parsePreflightTimeoutAlarmName,
  getMatchingInFlightOperation,
  isCheckInFlightForTab,
  persistAutomaticPreflightOperations,
  readPersistedAutomaticPreflightOperations,
  operationTimingFields,
  durationSince,
  type InFlightIconOperation,
  type OriginatorLookupApplicationContext,
} from './preflight-operations';
import {
  createOriginatorProbe,
  ORIGINATOR_FALLBACK_TIMEOUT_MS,
} from './originator-probe';

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
const POST_EXTRACTION_RETRY_DELAYS_MS = [1_000, 2_500, 5_000] as const;
const AUTOMATIC_PREFLIGHT_TIMEOUT_MS = 8_000;
// ORIGINATOR_FALLBACK_TIMEOUT_MS is owned by the originator-probe module; the
// keepalive window has to cover a preflight plus its timeout fallback probe.
const AUTOMATIC_PREFLIGHT_KEEPALIVE_MS = AUTOMATIC_PREFLIGHT_TIMEOUT_MS + ORIGINATOR_FALLBACK_TIMEOUT_MS + 1_000;

const postExtractionRetryTimers = new Map<number, ReturnType<typeof setTimeout>>();
const automaticPostExtractionRequests = new Map<string, Promise<void>>();

function isPostPageUrl(url?: string): boolean {
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

function postStatusId(url?: string): string | null {
  return captureIdentityFromUrl(url)?.sourceId ?? null;
}

function automaticPostOperationKey(tabId: number | undefined, url?: string): string | null {
  const identity = captureIdentityFromUrl(url);
  return tabId !== undefined && identity ? `${tabId}:${identity.platform}:${identity.sourceId}` : null;
}

function automaticPreflightCacheKey(tabId: number | undefined, url: string): string {
  return automaticPostOperationKey(tabId, url) ?? url;
}

function isSamePostPageUrl(expectedUrl?: string, currentUrl?: string): boolean {
  return isSameCaptureUrl(expectedUrl, currentUrl);
}

function isExtractedPostDataForUrl(data: unknown, url?: string): boolean {
  const expected = captureIdentityFromUrl(url);
  const actual = captureIdentityFromData(data);

  return expected === null ||
    actual === null ||
    (expected.platform === actual.platform && expected.sourceId === actual.sourceId);
}

// The automatic-originator-probe subsystem lives in ./originator-probe. It is
// mutually recursive with the operation lifecycle below (start/clear schedule
// and clear the probe; the probe calls back into these operations), so the
// worker owns the state and injects it here. This runs once at module-eval
// time, before any event fires, so the operation lifecycle functions defined
// below can reference the assembled `probe` closure. The injected callbacks are
// hoisted function declarations, so referencing them here is safe despite their
// definitions appearing later in the file.
const probe = createOriginatorProbe({
  getApiHandler: () => apiHandler,
  isPrivateModeEnabled,
  canWriteUserIdentifyingCache,
  isSenderTabStillOnSourceUrl,
  resolveOriginatorCreateUrl,
  applyResolvedIconForTab,
  applyAuthRequiredApiResponse,
  applyOriginatorLookupResponse,
  cacheFoundOriginatorFromLookup,
  startInFlightOperation,
  clearInFlightOperation,
  getCachedDuplicateResultForTab,
  setTabDuplicateResult,
  setMissingOriginator: (tabId, info) => { tabMissingOriginators.set(tabId, info); },
  deleteMissingOriginator: (tabId) => { tabMissingOriginators.delete(tabId); },
  markTabScopedPresentation: (tabId) => { tabScopedPresentationTabIds.add(tabId); },
});

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

  if (options.url && !isSamePostPageUrl(operation.url, options.url)) {
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
    probe.clearAutomaticOriginatorProbeTimer(operation);
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
  const statusId = postStatusId(url);
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
    probe.scheduleAutomaticOriginatorProbe(operation);
  }

  return operation;
}

async function isCurrentPostOperation(
  operation: InFlightIconOperation | null,
): Promise<boolean> {
  if (!operation) {
    return false;
  }

  try {
    const tab = await chrome.tabs.get(operation.tabId);
    return isSamePostPageUrl(operation.url, tab.url);
  } catch {
    return false;
  }
}

function clearPostDataExtractionRetry(tabId: number): void {
  const timer = postExtractionRetryTimers.get(tabId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  postExtractionRetryTimers.delete(tabId);
}

function clearAutomaticPostExtractionRequestsForTab(tabId: number): void {
  const keyPrefix = `${tabId}:`;
  for (const key of automaticPostExtractionRequests.keys()) {
    if (key.startsWith(keyPrefix)) {
      automaticPostExtractionRequests.delete(key);
    }
  }
}

function clearAutomaticPostExtractionRequestIfCurrent(key: string, promise: Promise<void>): void {
  if (automaticPostExtractionRequests.get(key) === promise) {
    automaticPostExtractionRequests.delete(key);
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

function getMissingOriginatorForTab(tabId: number, url?: string): MissingOriginatorInfo | null {
  const info = tabMissingOriginators.get(tabId);
  if (!info) {
    return null;
  }

  if (url && !isSamePostPageUrl(info.url, url)) {
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
  if (url && cachedUrl && !isSamePostPageUrl(cachedUrl, url)) {
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
    if (!isMissingContentScriptError(error) || !isPostPageUrl(tab.url)) {
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
    isPostPage: isPostPageUrl(url),
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

interface PostExtractionResponse {
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
  for (const tabId of [...postExtractionRetryTimers.keys()]) {
    clearPostDataExtractionRetry(tabId);
  }

  automaticPostExtractionRequests.clear();

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
    isPostPage: false,
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
        clearPostDataExtractionRetry(tab.id);
        clearAutomaticPostExtractionRequestsForTab(tab.id);
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

async function handleAutomaticPreflightTimeout(operation: InFlightIconOperation): Promise<void> {
  if (!await isCurrentPostOperation(operation)) {
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

  if (await probe.runAutomaticOriginatorFallback(operation)) {
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

    if (!await isCurrentPostOperation(operation)) {
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
    !isSamePostPageUrl(currentOperation.url, url)
  ) {
    return false;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    return isSamePostPageUrl(url, tab.url);
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
    return isSamePostPageUrl(sourceUrl, tab.url);
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
    clearPostDataExtractionRetry(tabId);
    clearAutomaticPostExtractionRequestsForTab(tabId);
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
      isSamePostPageUrl(preloaded.url, url) &&
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
        handlePostDataExtracted(message.data, sender.tab?.id, sendResponse, {
          keepAliveUntilIconApplied: true,
        });
        break;

      case MessageType.GET_POST_DATA:
        handleGetPostData(sender.tab?.id, sendResponse);
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
        if (isSafariExtension()) {
          // Safari: open the sign-in tab and return. The tray popup closes when the auth tab opens,
          // which removes the message port keeping this background alive — so we CANNOT await the
          // result here. Completion arrives asynchronously via OAUTH_CALLBACK (a content script on
          // the callback page), which wakes whatever background instance is alive (bead em9).
          startSafariSignIn().then(() => {
            sendResponse({ success: true, pending: true });
          }).catch(async error => {
            console.error('Safari sign-in could not start:', error);
            await authStateManager?.onAuthFailure(error?.message ?? 'Sign-in could not start.');
            sendResponse({
              success: false,
              error: error?.message ?? 'Sign-in could not start.',
              recoverable: true,
            });
          });
          break;
        }
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

      case MessageType.OAUTH_CALLBACK: {
        // Sent by the content script on the extension-callback page (bead em9). Completing HERE — on
        // whatever background instance is alive when the callback arrives — is what makes in-Safari
        // sign-in survive the background being torn down mid-flow. Flow state (PKCE verifier + CSRF
        // state) is read from chrome.storage.session, which outlives the background. The tray learns
        // the result via the AuthStateManager broadcast, since its popup is long gone by now.
        const callback = (message.data ?? {}) as import('../auth/safari-signin').SafariCallbackParams;
        const callbackTabId = sender.tab?.id;
        completeSafariSignIn(callback).then(async scopes => {
          debugLog('In-Safari sign-in completed via callback');
          await authStateManager?.onAuthSuccess(undefined, scopes);
          if (callbackTabId !== undefined) {
            chrome.tabs.remove(callbackTabId).catch(() => { /* tab may already be closed */ });
          }
          sendResponse({ success: true });
        }).catch(async error => {
          console.error('In-Safari sign-in callback failed:', error);
          await authStateManager?.onAuthFailure(error?.message ?? 'Sign-in could not be completed.');
          sendResponse({ success: false, error: error?.message ?? 'Sign-in could not be completed.' });
        });
        break;
      }

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

async function sendExtractPostDataMessage(tabId: number, url?: string): Promise<PostExtractionResponse | undefined> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: MessageType.EXTRACT_POST_DATA });
  } catch (error) {
    if (!isMissingContentScriptError(error) || !isPostPageUrl(url)) {
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

function schedulePostDataExtractionRetry(tabId: number, url: string | undefined, attempt: number): void {
  const retryAfterMs = POST_EXTRACTION_RETRY_DELAYS_MS[attempt];
  if (!isPostPageUrl(url) || retryAfterMs === undefined) {
    return;
  }

  clearPostDataExtractionRetry(tabId);

  const timer = setTimeout(() => {
    const nextAttempt = attempt + 2;
    postExtractionRetryTimers.delete(tabId);
    void (async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!isSamePostPageUrl(url, tab.url)) {
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

        await requestPostDataExtraction(tabId, url, attempt + 1);
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

  postExtractionRetryTimers.set(tabId, timer);
}

async function requestPostDataExtraction(tabId: number, url?: string, attempt = 0): Promise<void> {
  if (isPrivateModeEnabled()) {
    clearPostDataExtractionRetry(tabId);
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

  const extractionKey = attempt === 0 ? automaticPostOperationKey(tabId, url) : null;
  if (extractionKey) {
    const pendingExtraction = automaticPostExtractionRequests.get(extractionKey);
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

  const extractionPromise = performPostDataExtraction(tabId, url, attempt);
  if (!extractionKey) {
    await extractionPromise;
    return;
  }

  automaticPostExtractionRequests.set(extractionKey, extractionPromise);
  try {
    await extractionPromise;
  } finally {
    clearAutomaticPostExtractionRequestIfCurrent(extractionKey, extractionPromise);
  }
}

async function performPostDataExtraction(tabId: number, url?: string, attempt = 0): Promise<void> {
  if (!isPostPageUrl(url)) {
    clearPostDataExtractionRetry(tabId);
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
    clearPostDataExtractionRetry(tabId);
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
    const response = await sendExtractPostDataMessage(tabId, url);
    if (response?.success && response.data) {
      if (!isExtractedPostDataForUrl(response.data, url)) {
        const retryAfterMs = POST_EXTRACTION_RETRY_DELAYS_MS[attempt];
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
        schedulePostDataExtractionRetry(tabId, url, attempt);
        return;
      }

      clearPostDataExtractionRetry(tabId);
      recordExtractionDiagnostic({
        status: 'succeeded',
        tabId,
        url,
        attempt: attempt + 1,
      });
      await handlePostDataExtracted(response.data, tabId, () => undefined);
    } else if (response?.error) {
      const retryAfterMs = POST_EXTRACTION_RETRY_DELAYS_MS[attempt];
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
      schedulePostDataExtractionRetry(tabId, url, attempt);
    } else {
      const retryAfterMs = POST_EXTRACTION_RETRY_DELAYS_MS[attempt];
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
      schedulePostDataExtractionRetry(tabId, url, attempt);
    }
  } catch (error) {
    const retryAfterMs = POST_EXTRACTION_RETRY_DELAYS_MS[attempt];
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
    schedulePostDataExtractionRetry(tabId, url, attempt);
  }
}

/**
 * Clear tweet-specific icon updates
 */
async function clearPostPageIcon(tabId: number, url?: string): Promise<void> {
  try {
    clearPostDataExtractionRetry(tabId);
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
    const isPostPage = isPostPageUrl(tab.url);

    await ensureServicesInitialized();

    if (isPostPage) {
      recordDiagnosticTimingEvent({
        event: 'tweet_navigation_detected',
        tabId,
        sourceUrl: tab.url,
        trigger: 'automatic-preflight',
        reason: 'tabs_on_updated_complete',
      });
      await applyResolvedIconForTab(tabId, tab.url);
      await requestPostDataExtraction(tabId, tab.url);
    } else {
      await clearPostPageIcon(tabId, tab.url);
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await ensureServicesInitialized();

  if (lastActiveTabId !== null && lastActiveTabId !== tabId) {
    try {
      const previousTab = await chrome.tabs.get(lastActiveTabId);
      if (!isPostPageUrl(previousTab.url)) {
        await clearPostPageIcon(lastActiveTabId, previousTab.url);
      }
    } catch {
      clearPostDataExtractionRetry(lastActiveTabId);
      clearAutomaticPostExtractionRequestsForTab(lastActiveTabId);
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
  clearPostDataExtractionRetry(tabId);
  clearAutomaticPostExtractionRequestsForTab(tabId);
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

  const isPostPage = isPostPageUrl(details.url);

  if (isPostPage) {
    debugLog('SPA navigation detected to post page:', details.url);

    await ensureServicesInitialized();
    recordDiagnosticTimingEvent({
      event: 'tweet_navigation_detected',
      tabId: details.tabId,
      sourceUrl: details.url,
      trigger: 'automatic-preflight',
      reason: 'history_state_updated',
    });
    await applyResolvedIconForTab(details.tabId, details.url);
    await requestPostDataExtraction(details.tabId, details.url);
  } else {
    await ensureServicesInitialized();
    await clearPostPageIcon(details.tabId, details.url);
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
async function runAutomaticPreflightForExtractedPost(
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

async function handlePostDataExtracted(
  postData: unknown,
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
      validateCapturedPostData(postData);
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
    const validatedData = postData as CapturedPostData;
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
      clearPostDataExtractionRetry(tabId);
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
    const checkPromise = runAutomaticPreflightForExtractedPost(validatedData, tabId);
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
  clearPostDataExtractionRetry(tabId);
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
  if (!tabId || !sourceUrl || !isPostPageUrl(sourceUrl)) {
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
  if (!tabId || !sourceUrl || !isPostPageUrl(sourceUrl)) {
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

  if (tabId && isPostPageUrl(sourceUrl)) {
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

  if (!sourceUrl || !isPostPageUrl(sourceUrl)) {
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

    if (preflightOperation && probe.hasAutomaticOriginatorProbeTimer(preflightOperation)) {
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
async function handleGetPostData(
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
