/**
 * Chrome extension service worker
 * Handles extension lifecycle, messaging, and background tasks
 *
 * MV3 Resilience: Service workers can be terminated at any time.
 * All services are lazily initialized on demand via ensureServicesInitialized().
 */

import { MessageType, ExtensionMessage, TwitterData } from '../types/index';
import { initializeApiHandler } from './api-handler';
import { AuthenticationMonitor } from './auth-monitor';
import { initializeStorageCleanup } from './storage-cleanup';
import { validateTwitterData, ValidationError } from '../utils/validators';
import { debugLog } from '../config/environment';
import { initializeTokenRefresh, handleTokenRefreshAlarm } from '../auth/token-refresh';
import { initiateOAuthFlow, logout } from '../auth/auth-flow';
import {
  initializeAuthStateManager,
  AuthStateManager,
  setAuthPresentationUpdater,
} from '../auth/auth-state-manager';
import { AuthState } from '../auth/auth-state-machine';
import { ICON_STATES } from '../config/icon-states';
import { applyIconPresentation } from './icon-applicator';
import { resolveIconPresentation, type IconPresentation } from './icon-state-resolver';
import type { DuplicateCheckResult } from '../types/api';
import type { CollectionBadgeInfo } from '../types/chrome';

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
const tabCheckInFlight = new Set<number>();
const tabScopedPresentationTabIds = new Set<number>();
let lastActiveTabId: number | null = null;

// Service worker startup is logged once after initialization completes

const CONTENT_SCRIPT_FILE = 'content/index.js';
const MISSING_CONTENT_SCRIPT_MESSAGE = 'Receiving end does not exist';
const TWEET_PAGE_REGEX = /^https:\/\/(twitter\.com|x\.com)\/.*\/status\/\d+/;
const PRELOADED_DUPLICATE_MAX_AGE_MS = 60_000;

function isTweetPageUrl(url?: string): boolean {
  return !!url && TWEET_PAGE_REGEX.test(url);
}

function isMissingContentScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MISSING_CONTENT_SCRIPT_MESSAGE);
}

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
    isTweetPage: isTweetPageUrl(url),
    isCheckInFlight: tabCheckInFlight.has(tabId),
  });

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

async function getAffectedTabs(): Promise<AffectedTab[]> {
  const tabsById = new Map<number, AffectedTab>();

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && (isTweetPageUrl(tab.url) || tabScopedPresentationTabIds.has(tab.id))) {
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

async function applyAuthStatePresentation(authState: AuthState): Promise<void> {
  const presentation = resolveIconPresentation(authState, null, {
    tabId: 0,
    isTweetPage: false,
    isCheckInFlight: false,
  });

  await applyIconPresentation(presentation, 0);

  for (const tab of await getAffectedTabs()) {
    try {
      if (authState === AuthState.AUTHENTICATED && isTweetPageUrl(tab.url)) {
        await applyResolvedIconForTab(tab.id, tab.url, undefined, authState);
        continue;
      }

      if (
        authState === AuthState.UNAUTHENTICATED ||
        authState === AuthState.SESSION_EXPIRED ||
        authState === AuthState.INSUFFICIENT_PRIVILEGES
      ) {
        tabCheckInFlight.delete(tab.id);
      }

      await applyIconPresentation(presentation, tab.id, { forceTabScope: true });
    } catch (error) {
      debugLog('Error overwriting tab-scoped icon after auth transition:', error);
    }
  }
}

setAuthPresentationUpdater(applyAuthStatePresentation);

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

function duplicateResultFromResponse(response: unknown): DuplicateCheckResult | null {
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

async function resolveDuplicateResultForTab(
  tabId: number,
  url: string | undefined,
  duplicateResult: DuplicateCheckResult | null | undefined,
): Promise<DuplicateCheckResult | null> {
  if (duplicateResult !== undefined) {
    return duplicateResult;
  }

  if (tabDuplicateResults.has(tabId)) {
    return tabDuplicateResults.get(tabId) ?? null;
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
      preloaded?.url === url &&
      typeof preloaded.timestamp === 'number' &&
      Date.now() - preloaded.timestamp < PRELOADED_DUPLICATE_MAX_AGE_MS
    ) {
      const storedDuplicateResult = duplicateResultFromResponse({
        success: true,
        result: preloaded.result,
      });
      tabDuplicateResults.set(tabId, storedDuplicateResult);
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

  // Initialize OAuth token refresh (restores state from storage)
  try {
    await initializeTokenRefresh();
  } catch (error) {
    console.warn('Failed to initialize token refresh:', error);
  }

  // Start periodic cleanup (quiet mode - no startup logs)
  storageCleanup.startPeriodicCleanup(true);

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
  // Ensure services are initialized before processing any message
  // This handles MV3 service worker termination and recovery
  ensureServicesInitialized().then(() => {
    switch (message.type) {
      case MessageType.TWEET_DATA_EXTRACTED:
        handleTweetDataExtracted(message.data, sender.tab?.id, sendResponse);
        break;

      case MessageType.GET_TWEET_DATA:
        handleGetTweetData(sender.tab?.id, sendResponse);
        break;

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
      case MessageType.LOOKUP_ORIGINATOR_BY_HANDLE:
        // Delegate to API handler (guaranteed initialized by ensureServicesInitialized)
        apiHandler!.handleMessage(message, sender, sendResponse).catch(error => {
          console.error('API handler error:', error);
          sendResponse({
            success: false,
            error: error.message || 'API request failed'
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
          const stored = await chrome.storage.local.get('currentTweet');
          if (stored.currentTweet?.data) {
            const tabId = sender.tab?.id;
            checkQuoteCollectionStatus(stored.currentTweet.data as TwitterData, tabId).catch(error => {
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
        // Logout and clear tokens
        logout().then(async () => {
          debugLog('OAuth logout successful');
          // Notify AuthStateManager of logout (handles badge)
          await authStateManager?.onLogout();
          sendResponse({ success: true });
        }).catch(error => {
          console.error('OAuth logout failed:', error);
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

/**
 * Clear tweet-specific icon updates
 */
async function clearTweetPageIcon(tabId: number, url?: string): Promise<void> {
  try {
    tabDuplicateResults.delete(tabId);
    tabCheckInFlight.delete(tabId);
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
      await applyResolvedIconForTab(tabId, tab.url);
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
      tabDuplicateResults.delete(lastActiveTabId);
      tabCheckInFlight.delete(lastActiveTabId);
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
  tabDuplicateResults.delete(tabId);
  tabCheckInFlight.delete(tabId);
  tabScopedPresentationTabIds.delete(tabId);
  if (lastActiveTabId === tabId) {
    lastActiveTabId = null;
  }
});

// Handle SPA navigations (Twitter uses History API for client-side routing)
// This catches navigations from feed to tweet that don't trigger tabs.onUpdated
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  // Only process main frame navigations
  if (details.frameId !== 0) return;

  const isTweetPage = isTweetPageUrl(details.url);

  if (isTweetPage) {
    debugLog('SPA navigation detected to tweet page:', details.url);

    await ensureServicesInitialized();
    await applyResolvedIconForTab(details.tabId, details.url);

    // Programmatically inject content script (may already be running)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: [CONTENT_SCRIPT_FILE]
      });
      debugLog('Content script injected for SPA navigation');
    } catch (error) {
      // Script may already be injected or tab may not be accessible - that's OK
      debugLog('Content script injection skipped (likely already running):', error);
    }
  } else {
    await ensureServicesInitialized();
    await clearTweetPageIcon(details.tabId, details.url);
  }
}, { url: [{ hostSuffix: 'twitter.com' }, { hostSuffix: 'x.com' }] });

/**
 * Handle tweet data extracted from content script
 * Validates incoming data before storage for security
 */
async function handleTweetDataExtracted(
  tweetData: unknown,
  tabId: number | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void
) {
  try {
    // Validate incoming data before processing (security hardening)
    try {
      validateTwitterData(tweetData);
    } catch (validationError) {
      if (validationError instanceof ValidationError) {
        console.error('Tweet data validation failed:', validationError.message, validationError.field);
        sendResponse({
          success: false,
          error: `Invalid tweet data: ${validationError.message}`
        });
        return;
      }
      throw validationError;
    }

    // Type assertion safe after validation
    const validatedData = tweetData as TwitterData;

    // Store the extracted data for popup access
    await chrome.storage.local.set({
      currentTweet: {
        data: validatedData,
        timestamp: Date.now(),
        url: validatedData.url
      }
    });

    debugLog('Tweet data stored:', validatedData.text.substring(0, 50) + '...');

    // Clear stale preloaded caches to prevent race conditions
    // This ensures overlay won't read outdated originator/duplicate data
    // while new preflight is in progress
    await chrome.storage.local.remove(['preloadedOriginator', 'preloadedDuplicateCheck']);

    const cacheKey = validatedData.url;

    // Check if there's already a pending request for this URL (prevent race conditions)
    const pending = pendingDuplicateChecks.get(cacheKey);
    if (pending) {
      debugLog('Duplicate check already in progress for:', cacheKey);
      sendResponse({ success: true });
      return;
    }

    if (tabId) {
      tabCheckInFlight.add(tabId);
      tabScopedPresentationTabIds.add(tabId);
      await applyResolvedIconForTab(tabId, validatedData.url, null);
    }

    // Check if quote already exists in Quotewise (async, don't block response)
    const checkPromise = checkQuoteCollectionStatus(validatedData, tabId).finally(() => {
      pendingDuplicateChecks.delete(cacheKey);
    });
    pendingDuplicateChecks.set(cacheKey, checkPromise);

    checkPromise.catch(error => {
      console.error('Error checking quote collection status:', error);
    });

    sendResponse({ success: true });
  } catch (error) {
    console.error('Error storing tweet data:', error);
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

  const duplicateResult = duplicateResultFromResponse(response);
  tabDuplicateResults.set(tabId, duplicateResult);
  tabCheckInFlight.delete(tabId);

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

async function handleCheckDuplicate(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void
): Promise<void> {
  const tabId = sender.tab?.id;
  const sourceUrl = sourceUrlFromMessage(message, sender);

  if (tabId && isTweetPageUrl(sourceUrl)) {
    tabCheckInFlight.add(tabId);
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
      tabDuplicateResults.set(tabId, null);
      tabCheckInFlight.delete(tabId);
      try {
        await applyResolvedIconForTab(tabId, sourceUrl, null);
      } catch (iconError) {
        debugLog('Error clearing duplicate-check loading icon:', iconError);
      }
    }
    throw error;
  }
}

/**
 * Check if a quote exists in Quotewise and update badge accordingly
 * Uses single preflight API call for both originator lookup and duplicate check
 * (Reduces round-trips from 2 API calls to 1)
 */
async function checkQuoteCollectionStatus(tweetData: TwitterData, tabId?: number): Promise<void> {
  const targetTabId = await resolveTargetTabId(tabId);

  try {
    // Ensure API handler is initialized
    await ensureServicesInitialized();

    if (!apiHandler) {
      debugLog('API handler not available for collection check');
      return;
    }

    if (authStateManager && !authStateManager.isAuthenticated()) {
      debugLog('User not authenticated, skipping collection check');
      if (targetTabId) {
        tabDuplicateResults.set(targetTabId, null);
      }
      return;
    }

    const handle = tweetData.author?.username;

    if (!handle) {
      debugLog('No handle available for preflight check');
      if (targetTabId) {
        tabDuplicateResults.set(targetTabId, null);
      }
      return;
    }

    // Single preflight call combines originator lookup + duplicate check
    debugLog('Running preflight check for handle:', handle);
    const preflightResponse = await new Promise<{
      success: boolean;
      authRequired?: boolean;  // True when 401/authentication error occurred
      originator?: {
        found: boolean;
        originator?: { id: number; full_name: string; slug: string; social_handles?: Record<string, string> };
        handle?: string;
        platform?: string;
        match_platform?: string;
        confidence?: number;
        create_url?: string;
      };
      duplicate_check?: {
        [key: string]: unknown;
      } & DuplicateCheckResult;
    }>((resolve) => {
      apiHandler!.handleMessage(
        {
          type: MessageType.PREFLIGHT_CHECK,
          data: {
            handle,
            platform: 'twitter',
            text: tweetData.text,
            source_url: tweetData.url
          }
        },
        {} as chrome.runtime.MessageSender,
        resolve
      );
    });

    if (!preflightResponse.success) {
      // Check if this is an authentication error
      if (preflightResponse.authRequired) {
        debugLog('Preflight failed: authentication required');
        // Notify AuthStateManager - it will set the "!" badge (per spec FR-005)
        if (authStateManager) {
          await authStateManager.onAuthFailure('Authentication required');
        }
        return;
      }

      debugLog('Preflight check failed, falling back to ambient icon state');
      if (targetTabId) {
        tabDuplicateResults.set(targetTabId, null);
      }
      return;
    }

    debugLog('Preflight response:', preflightResponse);

    // Cache originator result for overlay to use
    const originatorResult = preflightResponse.originator;
    if (originatorResult) {
      if (originatorResult.found && originatorResult.originator) {
        // Transform to match expected overlay format
        await chrome.storage.local.set({
          preloadedOriginator: {
            handle: handle.toLowerCase(),
            originator: {
              id: originatorResult.originator.id,
              full_name: originatorResult.originator.full_name,
              unique_id: originatorResult.originator.slug,
              sort_name_display: originatorResult.originator.full_name,
              confidence: originatorResult.confidence ?? 1.0
            },
            timestamp: Date.now()
          }
        });
        debugLog('Originator found:', originatorResult.originator.full_name);
      } else {
        // Don't cache not-found results - we want fresh lookups each time
        // in case the user creates the originator between visits
        debugLog('Originator not found for handle:', handle);
      }
    }

    // Cache duplicate check result for overlay to use
    const duplicateResult = preflightResponse.duplicate_check;
    if (targetTabId) {
      tabDuplicateResults.set(targetTabId, duplicateResult ?? null);
    }

    if (duplicateResult) {
      await chrome.storage.local.set({
        preloadedDuplicateCheck: {
          url: tweetData.url,
          result: duplicateResult,
          timestamp: Date.now()
        }
      });
    }
  } catch (error) {
    console.error('Error checking quote collection status:', error);
    if (targetTabId) {
      tabDuplicateResults.set(targetTabId, null);
    }
  } finally {
    if (targetTabId) {
      tabCheckInFlight.delete(targetTabId);
      await applyResolvedIconForTab(targetTabId, tweetData.url, tabDuplicateResults.get(targetTabId) ?? null);
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
    // Get stored tweet data
    const result = await chrome.storage.local.get(['currentTweet']);
    const currentTweet = result.currentTweet;
    
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
    
    if (currentTweet && activeTabId) {
      // Verify the data is from the current tab
      const tab = await chrome.tabs.get(activeTabId);
      
      if (tab.url && currentTweet.url && 
          tab.url.includes(currentTweet.url.split('?')[0])) {
        sendResponse({ 
          success: true, 
          data: currentTweet.data 
        });
        return;
      }
    }
    
    // If no stored data or URL mismatch, request from content script
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { 
        type: MessageType.EXTRACT_TWEET_DATA 
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ 
            error: 'No tweet data available. Make sure you are on a tweet page.' 
          });
        } else {
          sendResponse(response);
        }
      });
    } else {
      // If we have stored tweet data but no active tab, try to send the stored data
      if (currentTweet && currentTweet.data) {
        sendResponse({ 
          success: true, 
          data: currentTweet.data 
        });
      } else {
        sendResponse({ error: 'No active tab found' });
      }
    }
  } catch (error) {
    console.error('Error getting tweet data:', error);
    sendResponse({ error: 'Failed to get tweet data' });
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
