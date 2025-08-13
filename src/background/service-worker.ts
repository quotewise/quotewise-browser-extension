/**
 * Chrome extension service worker
 * Handles extension lifecycle, messaging, and background tasks
 */

import { MessageType, ExtensionMessage, TwitterData } from '../types/index';

// Extension installation and startup
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Quotewise extension installed:', details.reason);
  
  if (details.reason === 'install') {
    // Set default settings
    chrome.storage.local.set({
      settings: {
        environment: 'production',
        autoCapture: true,
        duplicateCheck: true
      }
    });
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  sender,
  sendResponse
) => {
  console.log('Service worker received message:', message.type);

  switch (message.type) {
    case MessageType.TWEET_DATA_EXTRACTED:
      handleTweetDataExtracted(message.data as TwitterData, sendResponse);
      break;
      
    case MessageType.GET_TWEET_DATA:
      handleGetTweetData(sender.tab?.id, sendResponse);
      break;
      
    case MessageType.CHECK_AUTH_STATUS:
      handleCheckAuthStatus(sendResponse);
      break;
      
    case MessageType.SUBMIT_QUOTE:
      handleSubmitQuote(message.data, sendResponse);
      break;
      
    default:
      console.warn('Unknown message type:', message.type);
      sendResponse({ error: 'Unknown message type' });
  }
  
  // Return true to indicate we'll send a response asynchronously
  return true;
});

// Handle tab updates to detect tweet pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isTweetPage = /https:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(tab.url);
    
    if (isTweetPage) {
      // Update extension icon to indicate tweet page detected
      chrome.action.setIcon({
        tabId: tabId,
        path: {
          16: 'icons/icon16.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png'
        }
      });
      
      chrome.action.setTitle({
        tabId: tabId,
        title: 'Capture this quote'
      });
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
    
    if (currentTweet && tabId) {
      // Verify the data is from the current tab
      const tab = await chrome.tabs.get(tabId);
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
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { 
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
      sendResponse({ error: 'No active tab found' });
    }
  } catch (error) {
    console.error('Error getting tweet data:', error);
    sendResponse({ error: 'Failed to get tweet data' });
  }
}

/**
 * Handle authentication status check
 */
async function handleCheckAuthStatus(sendResponse: (response: any) => void) {
  try {
    // This will be implemented when API client is ready
    // For now, return a placeholder response
    sendResponse({ 
      success: true, 
      isAuthenticated: false,
      message: 'Authentication check not yet implemented'
    });
  } catch (error) {
    console.error('Error checking auth status:', error);
    sendResponse({ 
      success: false, 
      error: 'Failed to check authentication status' 
    });
  }
}

/**
 * Handle quote submission
 */
async function handleSubmitQuote(
  quoteData: any, 
  sendResponse: (response: any) => void
) {
  try {
    // This will be implemented when API client is ready
    console.log('Quote submission requested:', quoteData);
    
    sendResponse({ 
      success: true, 
      message: 'Quote submission not yet implemented'
    });
  } catch (error) {
    console.error('Error submitting quote:', error);
    sendResponse({ 
      success: false, 
      error: 'Failed to submit quote' 
    });
  }
}

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // This is handled by the popup, but we can add fallback logic here
  console.log('Extension icon clicked on tab:', tab.url);
});

// Cleanup old data periodically
chrome.alarms.create('cleanup', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup') {
    cleanupOldData();
  }
});

/**
 * Clean up old stored data
 */
async function cleanupOldData() {
  try {
    const result = await chrome.storage.local.get(['currentTweet']);
    const currentTweet = result.currentTweet;
    
    if (currentTweet && currentTweet.timestamp) {
      // Remove data older than 1 hour
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      if (currentTweet.timestamp < oneHourAgo) {
        await chrome.storage.local.remove(['currentTweet']);
        console.log('Cleaned up old tweet data');
      }
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}