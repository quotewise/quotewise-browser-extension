/**
 * Twitter/X content script for quote extraction
 */

import { 
  MessageType, 
  TwitterData, 
  ExtensionMessage 
} from '../types/index';
import { 
  sendMessageToBackground, 
  cleanUrl, 
  waitForElement, 
  extractTextContent,
  parseDate,
  parseNumber,
  safeQuerySelector,
  safeQuerySelectorAll,
  debugLog 
} from './common';

class TwitterContentScript {
  private isInitialized = false;
  private currentUrl = '';
  private extractedData: TwitterData | null = null;

  constructor() {
    this.init();
  }

  /**
   * Initialize the content script
   */
  private async init(): Promise<void> {
    if (this.isInitialized) return;
    
    debugLog('Initializing Twitter content script');
    
    // Check if we're on a tweet page
    if (!this.isTweetPage()) {
      debugLog('Not on a tweet page, skipping initialization');
      return;
    }
    
    this.currentUrl = window.location.href;
    this.isInitialized = true;
    
    // Set up message listener
    this.setupMessageListener();
    
    // Wait for page to load and extract data
    await this.waitForPageLoad();
    await this.extractTweetData();
    
    // Set up URL change detection for SPA navigation
    this.setupUrlChangeDetection();
    
    debugLog('Twitter content script initialized');
  }

  /**
   * Check if current page is an individual tweet page
   */
  private isTweetPage(): boolean {
    const path = window.location.pathname;
    return /\/status\/\d+/.test(path);
  }

  /**
   * Set up message listener for background script communication
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((
      message: ExtensionMessage,
      sender,
      sendResponse
    ) => {
      debugLog('Content script received message:', message.type);
      
      switch (message.type) {
        case MessageType.EXTRACT_TWEET_DATA:
          this.handleExtractRequest(sendResponse);
          break;
          
        default:
          sendResponse({ error: 'Unknown message type' });
      }
      
      return true; // Keep message channel open for async response
    });
  }

  /**
   * Handle tweet data extraction request
   */
  private async handleExtractRequest(sendResponse: (response: any) => void): Promise<void> {
    try {
      if (this.extractedData) {
        sendResponse({ 
          success: true, 
          data: this.extractedData 
        });
        return;
      }
      
      const data = await this.extractTweetData();
      if (data) {
        sendResponse({ 
          success: true, 
          data: data 
        });
      } else {
        sendResponse({ 
          error: 'Could not extract tweet data' 
        });
      }
    } catch (error) {
      console.error('Error handling extract request:', error);
      sendResponse({ 
        error: 'Failed to extract tweet data' 
      });
    }
  }

  /**
   * Wait for page content to load
   */
  private async waitForPageLoad(): Promise<void> {
    try {
      // Wait for main tweet container
      await waitForElement('article[data-testid="tweet"]', 10000);
      debugLog('Tweet container found');
    } catch (error) {
      debugLog('Tweet container not found, trying alternative selectors');
      // Twitter/X frequently changes selectors, so we'll try alternatives
      try {
        await waitForElement('[data-testid="tweetText"]', 5000);
      } catch (e) {
        throw new Error('Could not find tweet content on page');
      }
    }
  }

  /**
   * Extract tweet data from the page
   */
  private async extractTweetData(): Promise<TwitterData | null> {
    try {
      debugLog('Starting tweet data extraction');
      
      const article = safeQuerySelector('article[data-testid="tweet"]');
      if (!article) {
        throw new Error('Tweet article not found');
      }

      // Extract text content
      const tweetText = this.extractTweetText(article);
      if (!tweetText) {
        throw new Error('Tweet text not found');
      }

      // Extract author information
      const author = this.extractAuthorInfo(article);
      
      // Extract metrics
      const metrics = this.extractMetrics(article);
      
      // Extract date
      const date = this.extractDate(article);
      
      // Get tweet ID from URL
      const tweetId = this.extractTweetId();
      
      // Build the data object
      const data: TwitterData = {
        text: tweetText,
        author: author,
        url: cleanUrl(window.location.href),
        date: date,
        likes: metrics.likes,
        retweets: metrics.retweets,
        replies: metrics.replies,
        views: metrics.views,
        bookmarks: metrics.bookmarks,
        platform_data: {
          tweet_id: tweetId,
          reply_count: metrics.replies,
          retweet_count: metrics.retweets,
          quote_count: metrics.quotes,
          bookmark_count: metrics.bookmarks,
          view_count: metrics.views
        }
      };

      this.extractedData = data;
      
      // Send to background script for storage
      await sendMessageToBackground({
        type: MessageType.TWEET_DATA_EXTRACTED,
        data: data
      });
      
      debugLog('Tweet data extracted successfully:', data);
      return data;
      
    } catch (error) {
      console.error('Error extracting tweet data:', error);
      return null;
    }
  }

  /**
   * Extract tweet text content
   */
  private extractTweetText(article: Element): string | null {
    // Try multiple selectors as Twitter/X changes them frequently
    const selectors = [
      '[data-testid="tweetText"]',
      '[lang] > span',
      '.tweet-text',
      '.TweetTextSize'
    ];
    
    for (const selector of selectors) {
      const element = safeQuerySelector(selector, article);
      if (element) {
        const text = extractTextContent(element);
        if (text && text.length > 0) {
          return text;
        }
      }
    }
    
    return null;
  }

  /**
   * Extract author information
   */
  private extractAuthorInfo(article: Element): { username: string; displayName: string } {
    const author = { username: '', displayName: '' };
    
    // Try to find username (handle)
    const usernameSelectors = [
      '[data-testid="User-Name"] a[href*="/"]',
      'a[href*="/"][role="link"] span',
      '.username'
    ];
    
    for (const selector of usernameSelectors) {
      const element = safeQuerySelector(selector, article);
      if (element) {
        const href = element.getAttribute('href');
        if (href) {
          const match = href.match(/\/([^\/]+)$/);
          if (match) {
            author.username = match[1];
            break;
          }
        }
      }
    }
    
    // Try to find display name
    const displayNameSelectors = [
      '[data-testid="User-Name"] span span',
      '.fullname',
      '.display-name'
    ];
    
    for (const selector of displayNameSelectors) {
      const element = safeQuerySelector(selector, article);
      if (element) {
        const text = extractTextContent(element);
        if (text && text.length > 0 && !text.includes('@')) {
          author.displayName = text;
          break;
        }
      }
    }
    
    return author;
  }

  /**
   * Extract engagement metrics
   */
  private extractMetrics(article: Element): {
    likes: number;
    retweets: number;
    replies: number;
    views: number;
    bookmarks: number;
    quotes: number;
  } {
    const metrics = {
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      bookmarks: 0,
      quotes: 0
    };
    
    // Look for metric buttons
    const buttons = safeQuerySelectorAll('[role="button"]', article);
    
    buttons.forEach(button => {
      const ariaLabel = button.getAttribute('aria-label') || '';
      const text = extractTextContent(button);
      
      // Parse metrics based on aria-labels and icons
      if (ariaLabel.includes('like') || ariaLabel.includes('Like')) {
        metrics.likes = this.parseMetricValue(text);
      } else if (ariaLabel.includes('retweet') || ariaLabel.includes('Retweet')) {
        metrics.retweets = this.parseMetricValue(text);
      } else if (ariaLabel.includes('repl') || ariaLabel.includes('Repl')) {
        metrics.replies = this.parseMetricValue(text);
      } else if (ariaLabel.includes('view') || ariaLabel.includes('View')) {
        metrics.views = this.parseMetricValue(text);
      } else if (ariaLabel.includes('bookmark') || ariaLabel.includes('Bookmark')) {
        metrics.bookmarks = this.parseMetricValue(text);
      }
    });
    
    return metrics;
  }

  /**
   * Parse metric value from text
   */
  private parseMetricValue(text: string): number {
    if (!text) return 0;
    
    // Handle abbreviated numbers (1.2K, 5.3M, etc.)
    const match = text.match(/(\d+(?:\.\d+)?)\s*([KMB]?)/i);
    if (match) {
      const value = parseFloat(match[1]);
      const suffix = match[2].toUpperCase();
      
      switch (suffix) {
        case 'K': return Math.round(value * 1000);
        case 'M': return Math.round(value * 1000000);
        case 'B': return Math.round(value * 1000000000);
        default: return Math.round(value);
      }
    }
    
    return parseNumber(text);
  }

  /**
   * Extract tweet date
   */
  private extractDate(article: Element): string | null {
    const timeElement = safeQuerySelector('time', article);
    if (timeElement) {
      const datetime = timeElement.getAttribute('datetime');
      if (datetime) {
        return parseDate(datetime);
      }
    }
    
    return null;
  }

  /**
   * Extract tweet ID from URL
   */
  private extractTweetId(): string | null {
    const match = window.location.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Set up URL change detection for SPA navigation
   */
  private setupUrlChangeDetection(): void {
    // Override pushState and replaceState to detect navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    const handleUrlChange = () => {
      if (window.location.href !== this.currentUrl) {
        debugLog('URL changed, checking if still on tweet page');
        this.currentUrl = window.location.href;
        this.extractedData = null; // Clear cached data
        
        if (this.isTweetPage()) {
          // Re-extract data for new tweet
          setTimeout(() => {
            this.extractTweetData();
          }, 1000); // Wait for page to update
        }
      }
    };
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      handleUrlChange();
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      handleUrlChange();
    };
    
    // Also listen for popstate
    window.addEventListener('popstate', handleUrlChange);
  }
}

// Initialize when script loads
new TwitterContentScript();