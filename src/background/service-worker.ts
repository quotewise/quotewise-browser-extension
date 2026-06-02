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
import { initializeAuthStateManager, AuthStateManager } from '../auth/auth-state-manager';
import { AuthState } from '../auth/auth-state-machine';
import {
  classifyDuplicateSighting,
  getMatchForDuplicateSightingState
} from '../utils/duplicate-status';
import type { DuplicateSightingState } from '../utils/duplicate-status';

// Service instances - lazily initialized to handle MV3 service worker termination
let apiHandler: ReturnType<typeof initializeApiHandler> | null = null;
let authMonitor: AuthenticationMonitor | null = null;
let storageCleanup: ReturnType<typeof initializeStorageCleanup> | null = null;
let authStateManager: AuthStateManager | null = null;

// Track initialization state
let servicesInitialized = false;

// Track in-flight duplicate check requests to prevent race conditions
const pendingDuplicateChecks = new Map<string, Promise<void>>();

// Service worker startup is logged once after initialization completes

const CONTENT_SCRIPT_FILE = 'content/index.js';
const MISSING_CONTENT_SCRIPT_MESSAGE = 'Receiving end does not exist';
const TWEET_PAGE_REGEX = /^https:\/\/(twitter\.com|x\.com)\/[^/]+\/status\/\d+/;

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

function getExistingQuoteConfigTitle(sightingState: DuplicateSightingState, quote: string): string {
  switch (sightingState) {
    case 'exact_sighting':
      return `Exact sighting already in Quotewise: ${quote}`;
    case 'same_platform_sighting':
      return `Quote already has a Twitter sighting: ${quote}`;
    case 'other_platform_sighting':
      return `Quote exists; add this Twitter sighting: ${quote}`;
    case 'unknown':
    default:
      return `In Quotewise (not collected): ${quote}`;
  }
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
      case MessageType.CHECK_DUPLICATE:
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
 * Update extension icon and title for tweet pages
 * Badge system (auth-aware priority):
 * 1. Auth errors (SESSION_EXPIRED) → Red "!" (don't override)
 * 2. Insufficient privileges → Orange "?" (don't override)
 * 3. Not authenticated → Grey (prompt in title, not alarming)
 * 4. Authenticated + tweet processing → Show ★/✓/+/○
 *
 * Key insight: "Not logged in" is not an error - only use red for actual errors.
 */
async function updateExtensionIconForTweetPage(tweetData?: TwitterData): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;

    const tabId = tabs[0].id;
    if (!tabId) return;

    // Check auth state first - auth badges take priority
    if (authStateManager) {
      const authState = authStateManager.getState();

      // For SESSION_EXPIRED (actual error), don't override with processing badge
      if (authState === AuthState.SESSION_EXPIRED) {
        return;
      }

      // For INSUFFICIENT_PRIVILEGES, don't override
      if (authState === AuthState.INSUFFICIENT_PRIVILEGES) {
        return;
      }

      // For UNAUTHENTICATED, set grey badge with helpful tweet-page-specific title
      if (authState === AuthState.UNAUTHENTICATED) {
        chrome.action.setBadgeText({ tabId, text: '' });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#9AA0A6' });
        chrome.action.setTitle({
          tabId,
          title: 'Quotewise - Log in to capture this quote'
        });
        return;
      }
    }

    // When authenticated: don't set a processing badge here.
    // The content script's TWEET_DATA_EXTRACTED handler sets the processing badge
    // and then the final collection badge (★/✓/+). Setting ○ here races with that
    // flow and can overwrite the final badge back to ○ on concurrent SW wakeup.
    // Auth-state badges (grey, red !) are handled above; collection badges are
    // handled by updateCollectionBadgeForTweet() in handleTweetDataExtracted().
    if (tweetData) {
      chrome.action.setBadgeText({
        tabId: tabId,
        text: '✓'
      });
      chrome.action.setBadgeBackgroundColor({
        tabId: tabId,
        color: '#4CAF50'
      });
      chrome.action.setTitle({
        tabId: tabId,
        title: `Tweet processed: "${tweetData.text.substring(0, 50)}..."`
      });
    }
  } catch (error) {
    console.error('Error updating extension icon:', error);
  }
}

/**
 * Clear tweet-specific icon updates
 */
async function clearTweetPageIcon(tabId: number): Promise<void> {
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: '' });
    chrome.action.setTitle({ tabId: tabId, title: 'Quotewise Extension' });
  } catch (error) {
    console.error('Error clearing tweet page icon:', error);
  }
}

// Handle tab updates to detect tweet pages (full page loads)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isTweetPage = isTweetPageUrl(tab.url);

    if (isTweetPage) {
      // Ensure services are initialized before checking auth state
      await ensureServicesInitialized();
      // Show analyzing state (or grey badge if unauthenticated)
      await updateExtensionIconForTweetPage();
    } else {
      // Clear tweet-specific icons on non-tweet pages
      await clearTweetPageIcon(tabId);
    }
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

    // Ensure services are initialized before checking auth state
    await ensureServicesInitialized();
    // Show analyzing state (or grey badge if unauthenticated)
    await updateExtensionIconForTweetPage();

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

    // Show processing state while we check for duplicates
    await updateCollectionBadgeForTweet('processing', validatedData.text, tabId);

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

/**
 * Check if a quote exists in Quotewise and update badge accordingly
 * Uses single preflight API call for both originator lookup and duplicate check
 * (Reduces round-trips from 2 API calls to 1)
 */
async function checkQuoteCollectionStatus(tweetData: TwitterData, tabId?: number): Promise<void> {
  try {
    // Ensure API handler is initialized
    await ensureServicesInitialized();

    if (!apiHandler) {
      debugLog('API handler not available for collection check');
      return;
    }

    // Check auth state FIRST - only show collection badges when authenticated
    // Being unauthenticated is NOT an error - just skip collection checking
    // The badge update functions already handle showing grey badge for unauthenticated
    if (authStateManager && !authStateManager.isAuthenticated()) {
      debugLog('User not authenticated, skipping collection check (grey badge shown)');
      return;
    }

    const handle = tweetData.author?.username;

    if (!handle) {
      debugLog('No handle available for preflight check');
      await updateCollectionBadgeForTweet('new_quote', tweetData.text, tabId);
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
        in_quotewise?: boolean;
        existing_sightings_for_url?: Array<{ id: number; in_user_collections?: boolean }>;
        matches?: Array<{
          similarity: number;
          in_user_collections?: boolean;
          sighting_status?: 'exact_url' | 'has_platform_sighting' | 'no_platform_sighting' | 'unknown';
        }>;
        recommendation?: string;
      };
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
        // DON'T call updateCollectionBadgeForTweet - let auth badge take precedence
        return;
      }

      // Non-auth failure - show as new quote
      debugLog('Preflight check failed, showing as new quote');
      await updateCollectionBadgeForTweet('new_quote', tweetData.text, tabId);
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
    if (duplicateResult) {
      await chrome.storage.local.set({
        preloadedDuplicateCheck: {
          url: tweetData.url,
          result: duplicateResult,
          timestamp: Date.now()
        }
      });
    }

    // Determine badge status from duplicate check result
    let status: 'already_collected' | 'exists_not_collected' | 'new_quote' = 'new_quote';
    let sightingState: DuplicateSightingState = 'unknown';

    if (duplicateResult) {
      sightingState = classifyDuplicateSighting(duplicateResult);

      if (sightingState === 'exact_sighting') {
        const existingSightings = duplicateResult.existing_sightings_for_url || [];
        const exactMatch = getMatchForDuplicateSightingState(duplicateResult, sightingState);
        const inUserCollections = existingSightings.some(s => s.in_user_collections);
        status = inUserCollections || !!exactMatch?.in_user_collections
          ? 'already_collected'
          : 'exists_not_collected';
      } else if (sightingState === 'same_platform_sighting' || sightingState === 'other_platform_sighting') {
        const match = getMatchForDuplicateSightingState(duplicateResult, sightingState);
        status = match?.in_user_collections ? 'already_collected' : 'exists_not_collected';
      } else {
        // No exact URL match - check text similarity matches (must be high similarity)
        const matches = duplicateResult.matches || [];
        const highSimilarityMatch = matches.find(m => m.similarity >= 85);

        if (highSimilarityMatch?.in_user_collections) {
          status = 'already_collected';
        } else if (highSimilarityMatch) {
          // High similarity match exists but not in user's collection
          status = 'exists_not_collected';
        }
        // Otherwise stays as 'new_quote' - in_quotewise alone doesn't mean THIS quote exists
      }
    }

    debugLog('Badge status determined:', status);
    await updateCollectionBadgeForTweet(status, tweetData.text, tabId, sightingState);
  } catch (error) {
    console.error('Error checking quote collection status:', error);
    // On error, show as new quote (safe default)
    await updateCollectionBadgeForTweet('new_quote', tweetData.text, tabId);
  }
}

/**
 * Update badge for tweet collection status
 * Only shows collection badges when authenticated - auth badges take priority
 */
async function updateCollectionBadgeForTweet(
  state: 'processing' | 'already_collected' | 'exists_not_collected' | 'new_quote',
  quoteText: string,
  tabId?: number,
  sightingState: DuplicateSightingState = 'unknown'
): Promise<void> {
  try {
    // Use provided tabId, or fall back to active tab
    let targetTabId = tabId;
    if (!targetTabId) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) return;
      targetTabId = tabs[0].id;
    }
    if (!targetTabId) return;

    // Check auth state first - auth badges take priority over collection badges
    if (authStateManager) {
      const authState = authStateManager.getState();

      // For SESSION_EXPIRED (actual error), don't override with collection badge
      if (authState === AuthState.SESSION_EXPIRED) {
        return;
      }

      // For INSUFFICIENT_PRIVILEGES, don't override
      if (authState === AuthState.INSUFFICIENT_PRIVILEGES) {
        return;
      }

      // For UNAUTHENTICATED, set grey badge (not collection badges)
      if (authState === AuthState.UNAUTHENTICATED) {
        chrome.action.setBadgeText({ tabId: targetTabId, text: '' });
        chrome.action.setBadgeBackgroundColor({ tabId: targetTabId, color: '#9AA0A6' });
        chrome.action.setTitle({
          tabId: targetTabId,
          title: 'Quotewise - Log in to capture this quote'
        });
        return;
      }
    }

    // Only show collection badges when authenticated
    const preview = quoteText.substring(0, 50);
    let badge: { text: string; color: string; title: string };

    switch (state) {
      case 'processing':
        badge = {
          text: '○',
          color: '#2196F3', // Blue
          title: 'Checking quote status...'
        };
        break;
      case 'already_collected':
        badge = {
          text: '✓',
          color: '#4CAF50', // Green
          title: `Already in your collection: "${preview}..."`
        };
        break;
      case 'exists_not_collected':
        badge = {
          text: '+',
          color: '#FF9800', // Orange - exists but not in your collection
          title: getExistingQuoteBadgeTitle(sightingState, preview)
        };
        break;
      case 'new_quote':
        badge = {
          text: '★',
          color: '#4CAF50', // Green - new quote to add
          title: `New quote: "${preview}..."`
        };
        break;
    }

    chrome.action.setBadgeText({ tabId: targetTabId, text: badge.text });
    chrome.action.setBadgeBackgroundColor({ tabId: targetTabId, color: badge.color });
    chrome.action.setTitle({ tabId: targetTabId, title: badge.title });

    debugLog(`Badge updated for tab ${targetTabId}: ${state}`, badge);
  } catch (error) {
    console.error('Error updating collection badge:', error);
  }
}

function getExistingQuoteBadgeTitle(sightingState: DuplicateSightingState, preview: string): string {
  switch (sightingState) {
    case 'exact_sighting':
      return `Exact sighting already in Quotewise: "${preview}..."`;
    case 'same_platform_sighting':
      return `Quote already has a Twitter sighting: "${preview}..."`;
    case 'other_platform_sighting':
      return `Quote exists; add this Twitter sighting: "${preview}..."`;
    case 'unknown':
    default:
      return `In Quotewise (not in your collection): "${preview}..."`;
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
  badgeInfo: import('../types/chrome').CollectionBadgeInfo,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void
) {
  try {
    await updateCollectionBadge(badgeInfo);
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error updating collection badge:', error);
    sendResponse({ success: false, error: 'Failed to update badge' });
  }
}

/**
 * Update extension badge based on collection status
 */
async function updateCollectionBadge(badgeInfo: import('../types/chrome').CollectionBadgeInfo): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    
    const tabId = tabs[0].id;
    if (!tabId) return;
    
    const badgeConfig = getCollectionBadgeConfig(badgeInfo);
    
    chrome.action.setBadgeText({ 
      tabId: tabId, 
      text: badgeConfig.text 
    });
    chrome.action.setBadgeBackgroundColor({ 
      tabId: tabId, 
      color: badgeConfig.color 
    });
    chrome.action.setTitle({
      tabId: tabId,
      title: badgeConfig.title
    });
  } catch (error) {
    console.error('Error updating collection badge:', error);
  }
}

/**
 * Get badge configuration for collection status
 */
function getCollectionBadgeConfig(badgeInfo: import('../types/chrome').CollectionBadgeInfo): { 
  text: string; 
  color: string; 
  title: string 
} {
  const quote = badgeInfo.quoteText ? `"${badgeInfo.quoteText}..."` : 'quote';
  
  switch (badgeInfo.state) {
    case 'already_collected':
      return {
        text: '✓',
        color: '#4CAF50', // Green check
        title: `Already collected: ${quote}`
      };
    
    case 'exists_not_collected':
      return {
        text: '+',
        color: '#FF9800', // Orange - exists but not in your collection
        title: getExistingQuoteConfigTitle(badgeInfo.duplicateSightingState || 'unknown', quote)
      };
    
    case 'new_quote':
      return {
        text: '★',
        color: '#4CAF50', // Green star - new quote to add
        title: `New quote: ${quote}`
      };
    
    case 'processing':
      return {
        text: '○',
        color: '#2196F3', // Blue circle - processing
        title: 'Analyzing quote...'
      };
    
    case 'ready':
    default:
      return {
        text: '',
        color: '#1a73e8', // Regular blue - authenticated and ready
        title: 'Quotewise Extension - Ready to analyze'
      };
  }
}
