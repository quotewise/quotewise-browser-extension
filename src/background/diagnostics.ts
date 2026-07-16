/**
 * Runtime diagnostics subsystem for the background service worker.
 *
 * Owns the diagnostic event buffer and the last-known extraction/preflight
 * snapshots, exposes the `record*` mutators used throughout the worker, and
 * aggregates a `RuntimeDiagnostics` report for the options/debug surface.
 *
 * This module is a leaf: it depends only on the capture layer, the icon
 * applicator, and type-only imports. The aggregators read a lot of worker-owned
 * tab state, so rather than importing the worker back (which would create a
 * cycle through the webpack entry point) they receive that state through a
 * `RuntimeDiagnosticsContext` the worker assembles at the single call site.
 */

import type { CapturedPostData } from '../types/index';
import type { DuplicateCheckResult, PreflightOriginatorResult } from '../types/api';
import { AuthState, type AuthStateData } from '../auth/auth-state-machine';
import { DEBUG_MODE, isProduction } from '../config/environment';
import { getIconApplicatorDiagnostics } from './icon-applicator';
import {
  captureAuthorHandle,
  captureIdentityFromUrl,
  capturePlatformData,
  captureSourceId,
  isSupportedPermalinkUrl,
  isSupportedPlatformUrl as isSupportedCapturePlatformUrl,
} from '../platforms/capture';

const DIAGNOSTIC_EVENT_TRAIL_LIMIT = 20;
const DIAGNOSTIC_EVENT_TRAIL_ENABLED = DEBUG_MODE && !isProduction();

/** Timestamp captured when this module (and thus the worker) first loads. */
export const serviceWorkerLoadedAt = Date.now();

export interface DuplicateResultDiagnostic {
  recommendation: DuplicateCheckResult['recommendation'];
  confidence: number;
  inQuotewise: boolean;
  matchCount: number;
  sourceUrlChecked?: boolean;
  socialHandleMatched?: boolean;
  queryTimeMs?: number;
}

export interface OriginatorDiagnostic {
  found: boolean;
  handle?: string;
  platform?: string;
  matchPlatform?: string;
  confidence?: number;
  fullName?: string;
  slug?: string;
  createUrl?: string;
}

export interface MissingOriginatorInfo {
  handle: string;
  url: string;
  createUrl?: string;
  timestamp: number;
}

export type PreflightDiagnosticStatus = 'idle' | 'loading' | 'skipped' | 'succeeded' | 'failed';
export type ExtractionDiagnosticStatus = 'idle' | 'requested' | 'skipped' | 'succeeded' | 'no_data' | 'failed';
export type DiagnosticClassification =
  | 'extraction_retry_before_preflight'
  | 'probe_lookup_timeout'
  | 'probe_stale_after_navigation'
  | 'combined_preflight_timeout'
  | 'preflight_won_before_probe';
export type DiagnosticTrigger =
  | 'automatic-preflight'
  | 'automatic-originator-probe'
  | 'automatic-originator-fallback'
  | 'explicit-duplicate-check'
  | 'originator-lookup';

export interface PreflightDiagnostic {
  timestamp: number;
  status: PreflightDiagnosticStatus;
  trigger: DiagnosticTrigger;
  tabId?: number;
  url?: string;
  handle?: string;
  operationId?: string;
  durationMs?: number;
  reason?: string;
  classification?: DiagnosticClassification;
  error?: string;
  authRequired?: boolean;
  duplicate?: DuplicateResultDiagnostic | null;
  originator?: OriginatorDiagnostic | null;
}

export interface ExtractionDiagnostic {
  timestamp: number;
  status: ExtractionDiagnosticStatus;
  tabId?: number;
  url?: string;
  reason?: string;
  classification?: DiagnosticClassification;
  error?: string;
  attempt?: number;
  retryAfterMs?: number;
}

export interface DiagnosticTimingEvent {
  timestamp: number;
  event: string;
  tabId?: number;
  sourceUrl?: string;
  source_url?: string;
  statusId?: string;
  handle?: string;
  operationId?: string;
  trigger?: DiagnosticTrigger;
  reason?: string;
  classification?: DiagnosticClassification;
  error?: string;
  durationMs?: number;
  attempt?: number;
  retryAfterMs?: number;
}

export interface RuntimeDiagnostics {
  generatedAt: number;
  serviceWorkerLoadedAt: number;
  manifest: {
    name?: string;
    version?: string;
  };
  services: {
    initialized: boolean;
    apiHandler: boolean;
    authMonitor: boolean;
    storageCleanup: boolean;
    authStateManager: boolean;
  };
  auth: {
    initialized: boolean;
    state: AuthState;
    username?: string;
    scopes?: string[];
    expiresAt?: number;
    lastCheckedAt?: number;
    error?: string;
  };
  activeTab: {
    id?: number;
    url?: string;
    isSupportedPlatform: boolean;
    isPostPage: boolean;
    queryError?: string;
  } | null;
  activeTabState: {
    tabId: number;
    isSupportedPlatform: boolean;
    isPostPage: boolean;
    isCheckInFlight: boolean;
    isOriginatorMissing: boolean;
    hasDuplicateResult: boolean;
    hasTabScopedPresentation: boolean;
    duplicate: DuplicateResultDiagnostic | null;
    missingOriginator: MissingOriginatorInfo | null;
  } | null;
  lastActiveTabId: number | null;
  pendingDuplicateChecks: {
    count: number;
    urls: string[];
  };
  storage: {
    currentTweet: {
      url?: string;
      timestamp?: number;
      authorUsername?: string;
      tweetId?: string | null;
      metrics?: {
        replies?: number;
        retweets?: number;
        likes?: number;
        views?: number;
        bookmarks?: number;
      };
    } | null;
    preloadedDuplicateCheck: {
      url?: string;
      timestamp?: number;
      duplicate: DuplicateResultDiagnostic | null;
    } | null;
    preloadedOriginator: {
      handle?: string;
      timestamp?: number;
      found?: boolean;
      fullName?: string;
      uniqueId?: string;
      createUrl?: string;
    } | null;
    error?: string;
  };
  extraction: ExtractionDiagnostic;
  preflight: PreflightDiagnostic;
  events: DiagnosticTimingEvent[];
  icon: ReturnType<typeof getIconApplicatorDiagnostics>;
}

/** Result of a cached duplicate lookup for a tab; mirrors the worker accessor. */
export interface CachedDuplicateResult {
  hasResult: boolean;
  result: DuplicateCheckResult | null;
}

/**
 * Worker-owned state the aggregators read. Passed in rather than imported so
 * this module stays a cycle-free leaf relative to the service-worker entry.
 */
export interface RuntimeDiagnosticsContext {
  getServices(): RuntimeDiagnostics['services'];
  getAuthStateData(): AuthStateData | null;
  getCurrentAuthState(): AuthState;
  getLastActiveTabId(): number | null;
  getPendingDuplicateCheckUrls(): string[];
  isCheckInFlightForTab(tabId: number, url?: string): boolean;
  getMissingOriginatorForTab(tabId: number, url?: string): MissingOriginatorInfo | null;
  getCachedDuplicateResultForTab(tabId: number, url?: string): CachedDuplicateResult;
  hasTabScopedPresentation(tabId: number): boolean;
}

let lastExtractionDiagnostic: ExtractionDiagnostic = {
  timestamp: serviceWorkerLoadedAt,
  status: 'idle',
};

let lastPreflightDiagnostic: PreflightDiagnostic = {
  timestamp: serviceWorkerLoadedAt,
  status: 'idle',
  trigger: 'automatic-preflight',
};

const diagnosticTimingEvents: DiagnosticTimingEvent[] = [];

/** Normalize an unknown error into a display string. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Narrow an API response envelope down to a `DuplicateCheckResult`, or null.
 * Shared with the worker's icon/duplicate flows, homed here because the storage
 * diagnostics reader needs it and this module must not import the worker.
 */
export function duplicateResultFromResponse(response: unknown): DuplicateCheckResult | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const value = response as {
    success?: unknown;
    result?: unknown;
    recommendation?: unknown;
  };

  const candidate = value.result ?? response;
  if (
    value.success !== true ||
    !candidate ||
    typeof candidate !== 'object' ||
    typeof (candidate as { recommendation?: unknown }).recommendation !== 'string'
  ) {
    return null;
  }

  return candidate as DuplicateCheckResult;
}

export function summarizeDuplicateResult(result: DuplicateCheckResult | null | undefined): DuplicateResultDiagnostic | null {
  if (!result) {
    return null;
  }

  return {
    recommendation: result.recommendation,
    confidence: result.confidence,
    inQuotewise: result.in_quotewise,
    matchCount: Array.isArray(result.matches) ? result.matches.length : 0,
    sourceUrlChecked: result.search_metadata?.source_url_checked,
    socialHandleMatched: result.search_metadata?.social_handle_matched,
    queryTimeMs: result.search_metadata?.query_time_ms,
  };
}

export function summarizeOriginatorResult(originator: PreflightOriginatorResult | undefined): OriginatorDiagnostic | null {
  if (!originator) {
    return null;
  }

  return {
    found: originator.found,
    handle: originator.handle,
    platform: originator.platform,
    matchPlatform: originator.match_platform,
    confidence: originator.confidence,
    fullName: originator.originator?.full_name,
    slug: originator.originator?.slug ?? originator.originator?.unique_id,
    createUrl: originator.create_url,
  };
}

function originatorNameFromLookup(lookup: { originator?: unknown }): string | undefined {
  const originator = lookup.originator;
  if (!originator || typeof originator !== 'object') {
    return undefined;
  }

  const value = originator as { full_name?: unknown };
  return typeof value.full_name === 'string' ? value.full_name : undefined;
}

function originatorSlugFromLookup(lookup: { originator?: unknown }): string | undefined {
  const originator = lookup.originator;
  if (!originator || typeof originator !== 'object') {
    return undefined;
  }

  const value = originator as { unique_id?: unknown; slug?: unknown };
  if (typeof value.unique_id === 'string') {
    return value.unique_id;
  }

  return typeof value.slug === 'string' ? value.slug : undefined;
}

export function summarizeHandleLookupResult(
  lookup: { found?: unknown; handle?: unknown; platform?: unknown; match_platform?: unknown; confidence?: unknown; create_url?: unknown; originator?: unknown },
  fallbackHandle?: string,
): OriginatorDiagnostic | null {
  if (typeof lookup.found !== 'boolean') {
    return null;
  }

  return {
    found: lookup.found,
    handle: typeof lookup.handle === 'string' ? lookup.handle : fallbackHandle,
    platform: typeof lookup.platform === 'string' ? lookup.platform : 'twitter',
    matchPlatform: typeof lookup.match_platform === 'string' ? lookup.match_platform : undefined,
    confidence: typeof lookup.confidence === 'number' ? lookup.confidence : undefined,
    fullName: originatorNameFromLookup(lookup),
    slug: originatorSlugFromLookup(lookup),
    createUrl: typeof lookup.create_url === 'string' ? lookup.create_url : undefined,
  };
}

export function recordDiagnosticTimingEvent(update: Omit<DiagnosticTimingEvent, 'timestamp'>): void {
  if (!DIAGNOSTIC_EVENT_TRAIL_ENABLED) {
    return;
  }

  const event: DiagnosticTimingEvent = {
    timestamp: Date.now(),
    ...update,
  };

  if (!event.statusId && event.sourceUrl) {
    const statusId = captureIdentityFromUrl(event.sourceUrl)?.sourceId ?? null;
    if (statusId) {
      event.statusId = statusId;
    }
  }

  if (event.sourceUrl && !event.source_url) {
    event.source_url = event.sourceUrl;
  }

  diagnosticTimingEvents.push(event);
  if (diagnosticTimingEvents.length > DIAGNOSTIC_EVENT_TRAIL_LIMIT) {
    diagnosticTimingEvents.splice(0, diagnosticTimingEvents.length - DIAGNOSTIC_EVENT_TRAIL_LIMIT);
  }
}

export function recordExtractionDiagnostic(update: Omit<ExtractionDiagnostic, 'timestamp'>): void {
  lastExtractionDiagnostic = {
    timestamp: Date.now(),
    ...update,
  };
}

export function recordPreflightDiagnostic(update: Omit<PreflightDiagnostic, 'timestamp'>): void {
  lastPreflightDiagnostic = {
    timestamp: Date.now(),
    ...update,
  };
}

function sanitizeAuthState(
  stateData: AuthStateData | null,
  fallbackState: AuthState,
): RuntimeDiagnostics['auth'] {
  if (!stateData) {
    return {
      initialized: false,
      state: fallbackState,
    };
  }

  return {
    initialized: true,
    state: stateData.state,
    username: stateData.username,
    scopes: stateData.scopes ? [...stateData.scopes] : undefined,
    expiresAt: stateData.expiresAt,
    lastCheckedAt: stateData.lastCheckedAt,
    error: stateData.error,
  };
}

async function getActiveTabDiagnostics(): Promise<RuntimeDiagnostics['activeTab']> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab) {
      return null;
    }

    return {
      id: tab.id,
      url: tab.url,
      isSupportedPlatform: isSupportedCapturePlatformUrl(tab.url),
      isPostPage: isSupportedPermalinkUrl(tab.url),
    };
  } catch (error) {
    return {
      isSupportedPlatform: false,
      isPostPage: false,
      queryError: errorMessage(error),
    };
  }
}

function getTabStateDiagnostics(
  tabId: number | undefined,
  url: string | undefined,
  ctx: RuntimeDiagnosticsContext,
): RuntimeDiagnostics['activeTabState'] {
  if (!tabId) {
    return null;
  }

  const cachedDuplicate = ctx.getCachedDuplicateResultForTab(tabId, url);
  const missingOriginator = ctx.getMissingOriginatorForTab(tabId, url);

  return {
    tabId,
    isSupportedPlatform: isSupportedCapturePlatformUrl(url),
    isPostPage: isSupportedPermalinkUrl(url),
    isCheckInFlight: ctx.isCheckInFlightForTab(tabId, url),
    isOriginatorMissing: missingOriginator !== null,
    hasDuplicateResult: cachedDuplicate.hasResult,
    hasTabScopedPresentation: ctx.hasTabScopedPresentation(tabId),
    duplicate: summarizeDuplicateResult(cachedDuplicate.result),
    missingOriginator,
  };
}

async function getStorageDiagnostics(): Promise<RuntimeDiagnostics['storage']> {
  try {
    const storage = await chrome.storage.local.get([
      'currentPost',
      'currentTweet',
      'preloadedDuplicateCheck',
      'preloadedOriginator',
    ]);
    const currentTweet = (storage.currentPost ?? storage.currentTweet) as {
      data?: Partial<CapturedPostData>;
      timestamp?: unknown;
      url?: unknown;
    } | undefined;
    const preloadedDuplicateCheck = storage.preloadedDuplicateCheck as {
      url?: unknown;
      result?: unknown;
      timestamp?: unknown;
    } | undefined;
    const preloadedOriginator = storage.preloadedOriginator as {
      handle?: unknown;
      timestamp?: unknown;
      create_url?: unknown;
      originator?: {
        full_name?: unknown;
        unique_id?: unknown;
      } | null;
    } | undefined;

    return {
      currentTweet: currentTweet
        ? {
          url: typeof currentTweet.url === 'string' ? currentTweet.url : undefined,
          timestamp: typeof currentTweet.timestamp === 'number' ? currentTweet.timestamp : undefined,
          authorUsername: currentTweet.data ? captureAuthorHandle(currentTweet.data as CapturedPostData) : undefined,
          tweetId: currentTweet.data ? captureSourceId(currentTweet.data as CapturedPostData) : undefined,
          metrics: {
            replies: Number(capturePlatformData(currentTweet.data as CapturedPostData).reply_count) || undefined,
            retweets: Number(capturePlatformData(currentTweet.data as CapturedPostData).retweet_count) || undefined,
            likes: typeof currentTweet.data?.likes === 'number'
              ? currentTweet.data.likes
              : typeof currentTweet.data?.likesCount === 'number'
                ? currentTweet.data.likesCount
                : undefined,
            views: Number(capturePlatformData(currentTweet.data as CapturedPostData).view_count) || undefined,
            bookmarks: Number(capturePlatformData(currentTweet.data as CapturedPostData).bookmark_count) || undefined,
          },
        }
        : null,
      preloadedDuplicateCheck: preloadedDuplicateCheck
        ? {
          url: typeof preloadedDuplicateCheck.url === 'string' ? preloadedDuplicateCheck.url : undefined,
          timestamp: typeof preloadedDuplicateCheck.timestamp === 'number'
            ? preloadedDuplicateCheck.timestamp
            : undefined,
          duplicate: summarizeDuplicateResult(
            duplicateResultFromResponse({
              success: true,
              result: preloadedDuplicateCheck.result,
            }),
          ),
        }
        : null,
      preloadedOriginator: preloadedOriginator
        ? {
          handle: typeof preloadedOriginator.handle === 'string' ? preloadedOriginator.handle : undefined,
          timestamp: typeof preloadedOriginator.timestamp === 'number'
            ? preloadedOriginator.timestamp
            : undefined,
          found: !!preloadedOriginator.originator,
          fullName: typeof preloadedOriginator.originator?.full_name === 'string'
            ? preloadedOriginator.originator.full_name
            : undefined,
          uniqueId: typeof preloadedOriginator.originator?.unique_id === 'string'
            ? preloadedOriginator.originator.unique_id
            : undefined,
          createUrl: typeof preloadedOriginator.create_url === 'string'
            ? preloadedOriginator.create_url
            : undefined,
        }
        : null,
    };
  } catch (error) {
    return {
      currentTweet: null,
      preloadedDuplicateCheck: null,
      preloadedOriginator: null,
      error: errorMessage(error),
    };
  }
}

export async function getRuntimeDiagnostics(ctx: RuntimeDiagnosticsContext): Promise<RuntimeDiagnostics> {
  const manifest = chrome.runtime.getManifest();
  const activeTab = await getActiveTabDiagnostics();
  const pendingUrls = ctx.getPendingDuplicateCheckUrls();

  return {
    generatedAt: Date.now(),
    serviceWorkerLoadedAt,
    manifest: {
      name: manifest.name,
      version: manifest.version,
    },
    services: ctx.getServices(),
    auth: sanitizeAuthState(ctx.getAuthStateData(), ctx.getCurrentAuthState()),
    activeTab,
    activeTabState: getTabStateDiagnostics(activeTab?.id, activeTab?.url, ctx),
    lastActiveTabId: ctx.getLastActiveTabId(),
    pendingDuplicateChecks: {
      count: pendingUrls.length,
      urls: pendingUrls,
    },
    storage: await getStorageDiagnostics(),
    extraction: { ...lastExtractionDiagnostic },
    preflight: { ...lastPreflightDiagnostic },
    events: diagnosticTimingEvents.map(event => ({ ...event })),
    icon: getIconApplicatorDiagnostics(),
  };
}
