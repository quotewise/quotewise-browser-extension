/**
 * Chrome extension service worker
 * Handles extension lifecycle, messaging, and background tasks
 */

import { MessageType, ExtensionMessage, TwitterData } from '../types/index';
import { initializeApiHandler } from './api-handler';
import { AuthenticationMonitor } from './auth-monitor';
import { initializeStorageCleanup } from './storage-cleanup';

// Initialize API handler, auth monitor, and storage cleanup
let apiHandler: ReturnType<typeof initializeApiHandler>;
let authMonitor: AuthenticationMonitor;
let storageCleanup: ReturnType<typeof initializeStorageCleanup>;

console.log('Service worker starting...');

// Extension installation and startup
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Quotewise extension installed:', details.reason);
  
  // Initialize API handler, auth monitor, and storage cleanup
  apiHandler = initializeApiHandler();
  authMonitor = new AuthenticationMonitor();
  storageCleanup = initializeStorageCleanup();
  storageCleanup.startPeriodicCleanup();
  
  if (details.reason === 'install') {
    chrome.storage.local.set({
      settings: {
        environment: 'production',
        autoCapture: true,
        duplicateCheck: true
      }
    });
  }
});

// Initialize API handler, auth monitor, and storage cleanup on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Quotewise extension starting up');
  apiHandler = initializeApiHandler();
  authMonitor = new AuthenticationMonitor();
  storageCleanup = initializeStorageCleanup();
  storageCleanup.startPeriodicCleanup();
});

// Handle messages from content scripts and popup
// NOTE: Service worker handles core messages, API handler handles API messages
chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  sender,
  sendResponse
) => {
  console.log('Service worker received message:', message.type);

  switch (message.type) {
    case MessageType.TWEET_DATA_EXTRACTED:
      handleTweetDataExtracted(message.data as TwitterData, sendResponse);
      return true; // We handle this message
      
    case MessageType.GET_TWEET_DATA:
      handleGetTweetData(sender.tab?.id, sendResponse);
      return true; // We handle this message
      
    // Delegate API messages to API handler
    case MessageType.CHECK_AUTH_STATUS:
      // Start auth monitoring when user first requests auth status
      if (authMonitor && !authMonitor.getCurrentAuthStatus()) {
        console.log('Starting auth monitoring due to user interaction');
        authMonitor.startMonitoring();
      }
      // Fall through to delegate to API handler
    case MessageType.SEARCH_ORIGINATORS:
    case MessageType.CHECK_DUPLICATE:
    case MessageType.SUBMIT_QUOTE:
      // Delegate to API handler if available
      if (apiHandler) {
        apiHandler.handleMessage(message, sender, sendResponse).catch(error => {
          console.error('API handler error:', error);
          sendResponse({
            success: false,
            error: error.message || 'API request failed'
          });
        });
        return true; // Keep message port open for async response
      } else {
        sendResponse({ success: false, error: 'API handler not initialized' });
        return true;
      }
      
    case MessageType.CLEANUP_STORAGE:
      // Manual storage cleanup for debugging
      if (storageCleanup) {
        storageCleanup.runCleanup().then(() => {
          sendResponse({ success: true, message: 'Storage cleanup completed' });
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        return true;
      } else {
        sendResponse({ success: false, error: 'Storage cleanup not initialized' });
        return true;
      }
      
    case MessageType.UPDATE_COLLECTION_BADGE:
      handleUpdateCollectionBadge(message.data, sendResponse);
      return true;
      
    case MessageType.GET_STORAGE_STATS:
      // Get storage statistics for debugging
      if (storageCleanup) {
        storageCleanup.getStorageStats().then(stats => {
          sendResponse({ success: true, stats });
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        return true;
      } else {
        sendResponse({ success: false, error: 'Storage cleanup not initialized' });
        return true;
      }
      
    default:
      console.warn('Unknown message type:', message.type);
      sendResponse({ error: 'Unknown message type' });
      return true;
  }
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
 */
async function handleTweetDataExtracted(
  tweetData: TwitterData, 
  sendResponse: (response: any) => void
) {
  try {
    // Store the extracted data for popup access
    await chrome.storage.local.set({
      currentTweet: {
        data: tweetData,
        timestamp: Date.now(),
        url: tweetData.url
      }
    });
    
    console.log('Tweet data stored:', tweetData);
    
    // Update icon to show tweet data is ready
    await updateExtensionIconForTweetPage(tweetData);
    
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

console.log('Service worker initialized');