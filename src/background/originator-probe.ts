/**
 * Automatic-originator-probe subsystem for the background service worker.
 *
 * When an automatic preflight starts, the worker also fires a short-delayed
 * "probe" that resolves the post author's originator ahead of the preflight,
 * plus a fallback probe that runs if the preflight times out. This module owns
 * that probe lifecycle and its single timer map.
 *
 * The probe is mutually recursive with the worker's icon/tab-state core and the
 * preflight lifecycle: it calls ~16 worker-owned operations (icon application,
 * cache writes, in-flight bookkeeping), and some of those worker operations call
 * back into the probe (`startInFlightOperation` schedules a probe;
 * `clearInFlightOperation` clears its timer). To break that cycle without a
 * circular import through the webpack entry point, the worker owns the state and
 * passes it in: `createOriginatorProbe(deps)` returns the probe functions as an
 * object, the worker assembles it once at module-eval time, and the worker-owned
 * callbacks reference that already-assembled `probe` closure. This module imports
 * nothing from `service-worker.ts`.
 */

import { MessageType, type CapturePlatform } from '../types/index';
import type { DuplicateCheckResult } from '../types/api';
import type { AuthState } from '../auth/auth-state-machine';
import type { ApiHandler } from './api-handler';
import { captureIdentityFromUrl } from '../platforms/capture';
import { debugLog } from '../config/environment';
import {
  recordPreflightDiagnostic,
  recordDiagnosticTimingEvent,
  summarizeHandleLookupResult,
  errorMessage,
  type DiagnosticTrigger,
  type MissingOriginatorInfo,
  type CachedDuplicateResult,
} from './diagnostics';
import {
  getMatchingInFlightOperation,
  operationTimingFields,
  durationSince,
  type InFlightIconOperation,
  type OriginatorLookupApplicationContext,
} from './preflight-operations';

const AUTOMATIC_ORIGINATOR_PROBE_DELAY_MS = 300;
export const ORIGINATOR_FALLBACK_TIMEOUT_MS = 3_000;

/**
 * Worker-owned capabilities the probe depends on. Passed in rather than imported
 * so this module stays a cycle-free leaf relative to the service-worker entry.
 * `getApiHandler` is a getter because the worker's handler is lazily initialized
 * and may be null when a probe is scheduled.
 */
export interface OriginatorProbeDeps {
  getApiHandler(): ApiHandler | null;
  isPrivateModeEnabled(): boolean;
  canWriteUserIdentifyingCache(epoch: number | undefined): boolean;
  isSenderTabStillOnSourceUrl(tabId: number, sourceUrl: string): Promise<boolean>;
  resolveOriginatorCreateUrl(handle: string, platform?: CapturePlatform, createUrl?: unknown): string;
  applyResolvedIconForTab(
    tabId: number,
    url?: string,
    duplicateResult?: DuplicateCheckResult | null,
    authState?: AuthState,
  ): Promise<void>;
  applyAuthRequiredApiResponse(
    response: unknown,
    context: { tabId?: number; url?: string; trigger?: DiagnosticTrigger; handle?: string },
  ): Promise<boolean>;
  applyOriginatorLookupResponse(response: unknown, context: OriginatorLookupApplicationContext): Promise<void>;
  cacheFoundOriginatorFromLookup(
    handle: string,
    lookup: { originator?: unknown; confidence?: unknown },
    cacheWriteEpoch?: number,
  ): Promise<void>;
  startInFlightOperation(
    tabId: number,
    url: string | undefined,
    trigger: DiagnosticTrigger,
    handle?: string,
  ): Promise<InFlightIconOperation | null>;
  clearInFlightOperation(
    tabId: number,
    options?: { url?: string; operationId?: string; triggers?: DiagnosticTrigger[] },
  ): Promise<boolean>;
  getCachedDuplicateResultForTab(tabId: number, url?: string): CachedDuplicateResult;
  setTabDuplicateResult(tabId: number, result: DuplicateCheckResult | null, url?: string): void;
  setMissingOriginator(tabId: number, info: MissingOriginatorInfo): void;
  deleteMissingOriginator(tabId: number): void;
  markTabScopedPresentation(tabId: number): void;
}

/** Probe entry points the worker drives from its preflight/icon lifecycle. */
export interface OriginatorProbe {
  scheduleAutomaticOriginatorProbe(operation: InFlightIconOperation): void;
  clearAutomaticOriginatorProbeTimer(operation: InFlightIconOperation): void;
  hasAutomaticOriginatorProbeTimer(operation: InFlightIconOperation | null): boolean;
  runAutomaticOriginatorFallback(timedOutOperation: InFlightIconOperation): Promise<boolean>;
}

export function createOriginatorProbe(deps: OriginatorProbeDeps): OriginatorProbe {
  const {
    getApiHandler,
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
    setMissingOriginator,
    deleteMissingOriginator,
    markTabScopedPresentation,
  } = deps;

  // Single source of truth for pending probe timers (createOriginatorProbe runs once).
  const automaticOriginatorProbeTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

  function isAutomaticOriginatorProbeTimeoutResponse(response: unknown): boolean {
    if (!response || typeof response !== 'object') {
      return false;
    }

    const error = (response as { error?: unknown }).error;
    return typeof error === 'string' && error === 'Automatic originator probe timed out';
  }

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

  async function requestOriginatorLookupForOperation(
    operation: InFlightIconOperation,
    messages: {
      unavailable: string;
      timedOut: string;
    },
  ): Promise<unknown> {
    const apiHandler = getApiHandler();
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

      Promise.resolve(apiHandler.handleMessage(
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

      setMissingOriginator(operation.tabId, {
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
      markTabScopedPresentation(operation.tabId);
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

    deleteMissingOriginator(operation.tabId);
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
    if (!operation.handle || !getApiHandler()) {
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
    if (!timedOutOperation.handle || !getApiHandler()) {
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
    markTabScopedPresentation(timedOutOperation.tabId);
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

  return {
    scheduleAutomaticOriginatorProbe,
    clearAutomaticOriginatorProbeTimer,
    hasAutomaticOriginatorProbeTimer,
    runAutomaticOriginatorFallback,
  };
}
