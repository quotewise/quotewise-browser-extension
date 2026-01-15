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

// Service instances - lazily initialized to handle MV3 service worker termination
let apiHandler: ReturnType<typeof initializeApiHandler> | null = null;
let authMonitor: AuthenticationMonitor | null = null;
let storageCleanup: ReturnType<typeof initializeStorageCleanup> | null = null;

// Track initialization state
let servicesInitialized = false;

// Track in-flight duplicate check requests to prevent race conditions
const pendingDuplicateChecks = new Map<string, Promise<void>>();

// Service worker startup is logged once after initialization completes

/**
 * Ensure all services are initialized
 * Called before any message handling to recover from service worker termination
 */
async function ensureServicesInitialized(): Promise<void> {
  if (servicesInitialized && apiHandler && authMonitor && storageCleanup) {
    return;
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

// Handle alarms for token refresh
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'token-refresh') {
    debugLog('Token refresh alarm triggered');
    await handleTokenRefreshAlarm();
  }
});

// Toolbar icon click: show overlay bar in active tab
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: MessageType.SHOW_OVERLAY });
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

      // Delegate API messages to API handler
      case MessageType.CHECK_AUTH_STATUS:
        // Start auth monitoring when user first requests auth status
        if (authMonitor && !authMonitor.getCurrentAuthStatus()) {
          authMonitor.startMonitoring();
        }
        // Fall through to delegate to API handler
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
        initiateOAuthFlow().then(tokens => {
          debugLog('OAuth login successful');
          // Clear any auth required state
          chrome.storage.local.remove(['authRequired', 'authMessage']);
          // Update badge to show authenticated
          chrome.action.setBadgeText({ text: '' });
          chrome.action.setTitle({ title: 'Quotewise - Authenticated' });
          sendResponse({ success: true, scopes: tokens.scopes });
        }).catch(error => {
          console.error('OAuth login failed:', error);
          sendResponse({
            success: false,
            error: error.message || 'Login failed',
            recoverable: error.recoverable ?? true
          });
        });
        break;

      case MessageType.OAUTH_LOGOUT:
        // Logout and clear tokens
        logout().then(() => {
          debugLog('OAuth logout successful');
          // Update badge to show unauthenticated
          chrome.action.setBadgeText({ text: '!' });
          chrome.action.setBadgeBackgroundColor({ color: '#9E9E9E' });
          chrome.action.setTitle({ title: 'Quotewise - Login required' });
          sendResponse({ success: true });
        }).catch(error => {
          console.error('OAuth logout failed:', error);
          sendResponse({ success: false, error: error.message });
        });
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
 * Badge system:
 * - Green ✓: Tweet successfully processed and ready to capture
 * - Blue ○: Analyzing tweet data
 * - Regular icon: Authenticated (set by AuthenticationMonitor)
 * - Grey icon: Not authenticated (set by AuthenticationMonitor) 
 * - Orange ?: Insufficient privileges
 */
async function updateExtensionIconForTweetPage(tweetData?: TwitterData): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    
    const tabId = tabs[0].id;
    if (!tabId) return;
    
    if (tweetData) {
      // Tweet data extracted - show green check for successful processing
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
    } else {
      // Tweet page detected but no data yet - show analyzing state
      chrome.action.setBadgeText({ 
        tabId: tabId, 
        text: '○' 
      });
      chrome.action.setBadgeBackgroundColor({ 
        tabId: tabId, 
        color: '#2196F3' 
      });
      chrome.action.setTitle({
        tabId: tabId,
        title: 'Analyzing tweet...'
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

// Handle tab updates to detect tweet pages
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isTweetPage = /https:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(tab.url);
    
    if (isTweetPage) {
      // Show analyzing state initially
      await updateExtensionIconForTweetPage();
    } else {
      // Clear tweet-specific icons on non-tweet pages
      await clearTweetPageIcon(tabId);
    }
  }
});

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

    // Check if quote already exists in Quotosaurus (async, don't block response)
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
 * Check if a quote exists in Quotosaurus and update badge accordingly
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
        in_quotosaurus?: boolean;
        existing_sightings_for_url?: Array<{ id: number; in_user_collections?: boolean }>;
        matches?: Array<{ similarity: number; in_user_collections?: boolean }>;
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
        // Cache not-found result with create_url
        await chrome.storage.local.set({
          preloadedOriginator: {
            handle: handle.toLowerCase(),
            originator: null,
            create_url: originatorResult.create_url,
            timestamp: Date.now()
          }
        });
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

    if (duplicateResult) {
      // Check for exact URL matches first (sighting already exists for this URL)
      const existingSightings = duplicateResult.existing_sightings_for_url || [];
      if (existingSightings.length > 0) {
        // URL already captured - check if in user's collections
        const inUserCollections = existingSightings.some(s => s.in_user_collections);
        status = inUserCollections ? 'already_collected' : 'exists_not_collected';
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
        // Otherwise stays as 'new_quote' - in_quotosaurus alone doesn't mean THIS quote exists
      }
    }

    debugLog('Badge status determined:', status);
    await updateCollectionBadgeForTweet(status, tweetData.text, tabId);
  } catch (error) {
    console.error('Error checking quote collection status:', error);
    // On error, show as new quote (safe default)
    await updateCollectionBadgeForTweet('new_quote', tweetData.text, tabId);
  }
}

/**
 * Update badge for tweet collection status
 */
async function updateCollectionBadgeForTweet(
  state: 'processing' | 'already_collected' | 'exists_not_collected' | 'new_quote',
  quoteText: string,
  tabId?: number
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
          title: `In Quotosaurus (not in your collection): "${preview}..."`
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
        title: `In Quotosaurus (not collected): ${quote}`
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
