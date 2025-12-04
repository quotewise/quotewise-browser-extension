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

// Service instances - lazily initialized to handle MV3 service worker termination
let apiHandler: ReturnType<typeof initializeApiHandler> | null = null;
let authMonitor: AuthenticationMonitor | null = null;
let storageCleanup: ReturnType<typeof initializeStorageCleanup> | null = null;

// Track initialization state
let servicesInitialized = false;

debugLog('Service worker starting...');

/**
 * Ensure all services are initialized
 * Called before any message handling to recover from service worker termination
 */
async function ensureServicesInitialized(): Promise<void> {
  if (servicesInitialized && apiHandler && authMonitor && storageCleanup) {
    return;
  }

  debugLog('Initializing services (lazy/recovery)...');

  // Initialize services
  apiHandler = initializeApiHandler();
  authMonitor = new AuthenticationMonitor();
  storageCleanup = initializeStorageCleanup();

  // Restore auth state from storage if available
  try {
    const { lastAuthCheck } = await chrome.storage.local.get('lastAuthCheck');
    if (lastAuthCheck?.status) {
      debugLog('Restored auth state from storage:', lastAuthCheck.status.isAuthenticated);
      // AuthMonitor will pick up the cached state on next check
    }
  } catch (error) {
    console.warn('Failed to restore auth state:', error);
  }

  // Start periodic cleanup
  storageCleanup.startPeriodicCleanup();

  servicesInitialized = true;
  debugLog('Services initialized successfully');
}

// Extension installation and startup
chrome.runtime.onInstalled.addListener(async (details) => {
  debugLog('Quotewise extension installed:', details.reason);

  // Initialize services
  await ensureServicesInitialized();

  if (details.reason === 'install') {
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
  debugLog('Quotewise extension starting up');
  await ensureServicesInitialized();
});

// Toolbar icon click: trigger extraction refresh in active tab
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
    debugLog('Service worker received message:', message.type);

    switch (message.type) {
      case MessageType.TWEET_DATA_EXTRACTED:
        handleTweetDataExtracted(message.data, sendResponse);
        break;

      case MessageType.GET_TWEET_DATA:
        handleGetTweetData(sender.tab?.id, sendResponse);
        break;

      // Delegate API messages to API handler
      case MessageType.CHECK_AUTH_STATUS:
        // Start auth monitoring when user first requests auth status
        if (authMonitor && !authMonitor.getCurrentAuthStatus()) {
          debugLog('Starting auth monitoring due to user interaction');
          authMonitor.startMonitoring();
        }
        // Fall through to delegate to API handler
      case MessageType.SEARCH_ORIGINATORS:
      case MessageType.CHECK_DUPLICATE:
      case MessageType.SUBMIT_QUOTE:
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

    // Update icon to show tweet data is ready
    await updateExtensionIconForTweetPage(validatedData);

    sendResponse({ success: true });
  } catch (error) {
    console.error('Error storing tweet data:', error);
    sendResponse({ error: 'Failed to store tweet data' });
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
    
    case 'should_collect':
      return {
        text: '●',
        color: '#4CAF50', // Green dot
        title: `Collect this: ${quote}`
      };
    
    case 'new_quote':
      return {
        text: '',
        color: '#1a73e8', // Regular blue - ready to add new quote
        title: `New quote ready: ${quote}`
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

debugLog('Service worker initialized');
