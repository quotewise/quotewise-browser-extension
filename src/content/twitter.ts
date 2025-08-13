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
  debugLog,
  debounce
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
    
    // Set up cleanup handlers
    this.setupCleanup();
    
    debugLog('Twitter content script initialized');
  }

  /**
   * Check if current page is an individual tweet page
   */
  private isTweetPage(): boolean {
    const hostname = window.location.hostname;
    const path = window.location.pathname;
    
    // Support both twitter.com and x.com domains
    const isTwitterDomain = hostname === 'twitter.com' || hostname === 'x.com';
    
    // Check for individual tweet URL pattern
    const isTweetUrl = /\/[^\/]+\/status\/\d+/.test(path);
    
    return isTwitterDomain && isTweetUrl;
  }

  /**
   * Get tweet type based on URL and content
   */
  private getTweetType(): 'original' | 'reply' | 'retweet' | 'quote' {
    // Check URL parameters for context
    const urlParams = new URLSearchParams(window.location.search);
    
    // Check for reply context
    if (urlParams.has('reply_to') || this.detectReplyInDOM()) {
      return 'reply';
    }
    
    // Check for quote tweet
    if (this.detectQuoteTweetInDOM()) {
      return 'quote';
    }
    
    // Check for retweet
    if (this.detectRetweetInDOM()) {
      return 'retweet';
    }
    
    return 'original';
  }

  /**
   * Detect if tweet is a reply based on DOM structure
   */
  private detectReplyInDOM(): boolean {
    const replyIndicators = [
      '[data-testid="tweet"] [data-testid="reply"]',
      '.tweet-reply-context',
      '[aria-label*="Replying to"]',
      '[data-testid="tweetText"] + [role="link"]'
    ];
    
    return replyIndicators.some(selector => safeQuerySelector(selector));
  }

  /**
   * Detect if tweet is a quote tweet
   */
  private detectQuoteTweetInDOM(): boolean {
    const quoteIndicators = [
      '[data-testid="tweet"] [data-testid="quoteTweet"]',
      '.quoted-tweet',
      '[role="blockquote"]',
      '[data-testid="card.layoutSmall.media"]'
    ];
    
    return quoteIndicators.some(selector => safeQuerySelector(selector));
  }

  /**
   * Detect if tweet is a retweet
   */
  private detectRetweetInDOM(): boolean {
    const retweetIndicators = [
      '[data-testid="socialContext"] [data-testid="UserAvatar-Container-unknown"]',
      '[data-testid="retweetedBy"]',
      '.retweet-header'
    ];
    
    return retweetIndicators.some(selector => safeQuerySelector(selector));
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
   * Extract tweet data from the page with comprehensive error handling
   */
  private async extractTweetData(): Promise<TwitterData | null> {
    const startTime = performance.now();
    
    try {
      debugLog('Starting tweet data extraction');
      
      // Try multiple strategies to find the tweet article
      const article = await this.findTweetArticleWithRetry();
      if (!article) {
        throw new Error('Tweet article not found after retry attempts');
      }

      // Extract data with error resilience
      const extractedData = await this.extractAllData(article);
      
      // Validate extracted data
      const validationResult = this.validateExtractedData(extractedData);
      if (!validationResult.isValid) {
        debugLog('Data validation failed:', validationResult.errors);
        // Try to use partial data if available
        if (validationResult.hasPartialData) {
          debugLog('Using partial data despite validation errors');
        } else {
          throw new Error(`Data validation failed: ${validationResult.errors.join(', ')}`);
        }
      }

      this.extractedData = extractedData;
      
      // Send to background script for storage
      await sendMessageToBackground({
        type: MessageType.TWEET_DATA_EXTRACTED,
        data: extractedData
      });
      
      const extractionTime = performance.now() - startTime;
      debugLog(`Tweet data extracted successfully in ${extractionTime.toFixed(2)}ms:`, extractedData);
      return extractedData;
      
    } catch (error) {
      const extractionTime = performance.now() - startTime;
      console.error(`Error extracting tweet data (${extractionTime.toFixed(2)}ms):`, error);
      
      // Try fallback extraction if main method fails
      return await this.fallbackExtraction();
    }
  }

  /**
   * Find tweet article with retry logic
   */
  private async findTweetArticleWithRetry(maxRetries: number = 3): Promise<Element | null> {
    const selectors = [
      'article[data-testid="tweet"]',
      'article[role="article"]',
      'div[data-testid="tweet"]',
      'main article',
      '[data-testid="primaryColumn"] article'
    ];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      for (const selector of selectors) {
        const article = safeQuerySelector(selector);
        if (article) {
          debugLog(`Found tweet article using selector: ${selector} (attempt ${attempt + 1})`);
          return article;
        }
      }

      if (attempt < maxRetries - 1) {
        debugLog(`Tweet article not found, retrying in ${(attempt + 1) * 500}ms...`);
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
      }
    }

    return null;
  }

  /**
   * Extract all data with individual error handling
   */
  private async extractAllData(article: Element): Promise<TwitterData> {
    const errors: string[] = [];

    // Extract with individual try-catch for each component
    const tweetText = this.safeExtract(() => this.extractTweetText(article), 'tweet text', errors);
    const author = this.safeExtract(() => this.extractAuthorInfo(article), 'author info', errors, { username: '', displayName: '' });
    const metrics = this.safeExtract(() => this.extractMetrics(article), 'metrics', errors, { likes: 0, retweets: 0, replies: 0, views: 0, bookmarks: 0, quotes: 0 });
    const date = this.safeExtract(() => this.extractDate(article), 'date', errors);
    const tweetId = this.safeExtract(() => this.extractTweetId(), 'tweet ID', errors);
    const tweetType = this.safeExtract(() => this.getTweetType(), 'tweet type', errors, 'original' as const);
    const language = this.safeExtract(() => this.extractLanguage(article), 'language', errors);
    const isProtected = this.safeExtract(() => this.detectProtectedTweet(article), 'protected status', errors, false);

    if (errors.length > 0) {
      debugLog('Extraction errors encountered:', errors);
    }

    return {
      text: tweetText || '',
      author: author || { username: '', displayName: '' },
      url: cleanUrl(window.location.href),
      date: date || null,
      likes: metrics?.likes || 0,
      retweets: metrics?.retweets || 0,
      replies: metrics?.replies || 0,
      views: metrics?.views || 0,
      bookmarks: metrics?.bookmarks || 0,
      tweetType: tweetType || 'original',
      language: language === null ? undefined : language,
      isProtected: isProtected || false,
      platform_data: {
        tweet_id: tweetId || null,
        reply_count: metrics?.replies || 0,
        retweet_count: metrics?.retweets || 0,
        quote_count: metrics?.quotes || 0,
        bookmark_count: metrics?.bookmarks || 0,
        view_count: metrics?.views || 0,
        is_protected: isProtected || false,
        has_media: this.safeExtract(() => this.detectMedia(article), 'media detection', errors, false) || false,
        reply_to_tweet_id: this.safeExtract(() => this.extractReplyToTweetId(article), 'reply-to ID', errors) || undefined,
        quoted_tweet_id: this.safeExtract(() => this.extractQuotedTweetId(article), 'quoted tweet ID', errors) || undefined
      }
    };
  }

  /**
   * Safe extraction wrapper
   */
  private safeExtract<T>(
    extractorFn: () => T,
    componentName: string,
    errors: string[],
    fallbackValue?: T
  ): T | undefined {
    try {
      const result = extractorFn();
      return result;
    } catch (error) {
      const errorMsg = `Failed to extract ${componentName}: ${error}`;
      errors.push(errorMsg);
      debugLog(errorMsg);
      return fallbackValue;
    }
  }

  /**
   * Validate extracted data
   */
  private validateExtractedData(data: TwitterData): {
    isValid: boolean;
    hasPartialData: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    let hasPartialData = false;

    // Critical validations
    if (!data.text || data.text.trim().length === 0) {
      errors.push('Tweet text is missing or empty');
    } else {
      hasPartialData = true;
    }

    if (!data.author.username && !data.author.displayName) {
      errors.push('Author information is missing');
    } else if (data.author.username || data.author.displayName) {
      hasPartialData = true;
    }

    if (!data.platform_data.tweet_id) {
      errors.push('Tweet ID is missing');
    } else {
      hasPartialData = true;
    }

    // Warn about missing optional data
    if (!data.date) {
      debugLog('Warning: Tweet date not extracted');
    }

    return {
      isValid: errors.length === 0,
      hasPartialData,
      errors
    };
  }

  /**
   * Fallback extraction for when main method fails
   */
  private async fallbackExtraction(): Promise<TwitterData | null> {
    debugLog('Attempting fallback extraction');
    
    try {
      // Very basic extraction using any available content
      const pageText = document.body.textContent || '';
      const tweetId = this.extractTweetId();
      
      if (!tweetId) {
        debugLog('Fallback extraction failed: no tweet ID available');
        return null;
      }

      // Create minimal data structure
      const fallbackData: TwitterData = {
        text: pageText.substring(0, 280), // Rough tweet length limit
        author: { username: '', displayName: 'Unknown' },
        url: cleanUrl(window.location.href),
        date: new Date().toISOString(),
        likes: 0,
        retweets: 0,
        replies: 0,
        views: 0,
        bookmarks: 0,
        tweetType: 'original',
        language: undefined,
        isProtected: false,
        platform_data: {
          tweet_id: tweetId,
          reply_count: 0,
          retweet_count: 0,
          quote_count: 0,
          bookmark_count: 0,
          view_count: 0,
          is_protected: false,
          has_media: false,
          reply_to_tweet_id: undefined,
          quoted_tweet_id: undefined
        }
      };

      debugLog('Fallback extraction completed with minimal data');
      return fallbackData;

    } catch (error) {
      console.error('Fallback extraction also failed:', error);
      return null;
    }
  }

  /**
   * Robust selector strategy for finding elements
   */
  private findElementWithFallbacks(selectors: string[], parent: Element | Document = document): Element | null {
    for (const selector of selectors) {
      const element = safeQuerySelector(selector, parent as Element);
      if (element) {
        return element;
      }
    }
    return null;
  }

  /**
   * Extract tweet text content with enhanced reliability
   */
  private extractTweetText(article: Element): string | null {
    // Primary selectors (current Twitter/X structure)
    const primarySelectors = [
      '[data-testid="tweetText"]',
      '[data-testid="tweetText"] span',
      '[lang] span'
    ];
    
    // Fallback selectors for resilience
    const fallbackSelectors = [
      '.tweet-text',
      '.TweetTextSize',
      'article span[lang]',
      '[role="blockquote"] span',
      'div[lang] > span'
    ];
    
    // Pattern-based selectors
    const patternSelectors = [
      'span[dir="ltr"]',
      'span[dir="auto"]',
      'div[dir="auto"] span'
    ];
    
    const allSelectors = [...primarySelectors, ...fallbackSelectors, ...patternSelectors];
    
    for (const selector of allSelectors) {
      const element = safeQuerySelector(selector, article);
      if (element) {
        const text = this.extractCompleteText(element);
        if (text && text.length > 0) {
          debugLog('Tweet text extracted using selector:', selector);
          return text;
        }
      }
    }
    
    debugLog('No tweet text found with any selector');
    return null;
  }

  /**
   * Extract complete text handling truncation and show more
   */
  private extractCompleteText(element: Element): string {
    // Clone element to avoid modifying original
    const clone = element.cloneNode(true) as Element;
    
    // Remove script and style elements
    const unwantedElements = clone.querySelectorAll('script, style, noscript');
    unwantedElements.forEach(el => el.remove());
    
    // Check for "Show more" or truncation indicators
    const showMoreButton = clone.querySelector('[data-testid="tweet-text-show-more-link"]');
    if (showMoreButton) {
      // If truncated, try to expand or note truncation
      debugLog('Tweet appears to be truncated');
    }
    
    // Get text content and clean it up
    let text = clone.textContent?.trim() || '';
    
    // Remove common Twitter artifacts
    text = text.replace(/^Show this thread$/, '');
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  /**
   * Extract comprehensive author information
   */
  private extractAuthorInfo(article: Element): {
    username: string;
    displayName: string;
    verified?: boolean;
    profileUrl?: string;
    avatarUrl?: string;
  } {
    const author: any = { 
      username: '', 
      displayName: '',
      verified: false,
      profileUrl: '',
      avatarUrl: ''
    };
    
    // Extract username (handle) with multiple strategies
    const usernameSelectors = [
      '[data-testid="User-Name"] a[href*="/"]',
      '[data-testid="User-Names"] a[href*="/"]',
      'a[href*="/"][role="link"][tabindex="-1"]',
      '[data-testid="UserAvatar-Container-unknown"] + div a',
      '.username'
    ];
    
    for (const selector of usernameSelectors) {
      const element = safeQuerySelector(selector, article);
      if (element) {
        const href = element.getAttribute('href');
        if (href) {
          const match = href.match(/\/([^\/]+)(?:\?|$)/);
          if (match && match[1] !== 'status') {
            author.username = match[1];
            author.profileUrl = `https://${window.location.hostname}${href}`;
            break;
          }
        }
      }
    }
    
    // Extract display name with improved selectors
    const displayNameSelectors = [
      '[data-testid="User-Name"] span:first-child span',
      '[data-testid="User-Names"] span:first-child',
      '[data-testid="UserAvatar-Container-unknown"] + div span:first-child',
      '.fullname',
      '.display-name'
    ];
    
    for (const selector of displayNameSelectors) {
      const element = safeQuerySelector(selector, article);
      if (element) {
        const text = extractTextContent(element);
        if (text && text.length > 0 && !text.includes('@') && !text.match(/^\d+[smhd]$/)) {
          author.displayName = text;
          break;
        }
      }
    }
    
    // Check for verification status
    const verificationSelectors = [
      '[data-testid="icon-verified"]',
      '[data-testid="UserName"] svg[data-testid="icon-verified"]',
      '.verified-icon',
      'svg[aria-label*="Verified"]'
    ];
    
    author.verified = verificationSelectors.some(selector => 
      safeQuerySelector(selector, article) !== null
    );
    
    // Extract avatar URL
    const avatarSelectors = [
      '[data-testid="UserAvatar-Container-unknown"] img',
      '[data-testid="Tweet-User-Avatar"] img',
      '.avatar img',
      'img[alt*="avatar"]'
    ];
    
    for (const selector of avatarSelectors) {
      const element = safeQuerySelector(selector, article) as HTMLImageElement;
      if (element && element.src) {
        author.avatarUrl = element.src;
        break;
      }
    }
    
    debugLog('Author info extracted:', author);
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
   * Enhanced metric value parsing with better abbreviation handling
   */
  private parseMetricValue(text: string): number {
    if (!text) return 0;
    
    // Clean the text first
    const cleanText = text.replace(/[^\d.,KMBkmb]/g, '').trim();
    if (!cleanText) return 0;
    
    // Handle different number formats
    const patterns = [
      // Standard format: 1.2K, 5.3M, 2.1B
      /^(\d+(?:\.\d+)?)\s*([KMBkmb])$/,
      // Comma format: 1,234 or 1,234,567
      /^(\d{1,3}(?:,\d{3})+)$/,
      // Simple numbers: 123, 1234
      /^(\d+)$/,
      // Decimal numbers: 1.5, 2.3
      /^(\d+\.\d+)$/
    ];
    
    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        const suffix = match[2]?.toUpperCase();
        
        if (suffix) {
          switch (suffix) {
            case 'K': return Math.round(value * 1000);
            case 'M': return Math.round(value * 1000000);
            case 'B': return Math.round(value * 1000000000);
            default: return Math.round(value);
          }
        } else {
          return Math.round(value);
        }
      }
    }
    
    // Fallback to parseNumber from common utilities
    return parseNumber(cleanText);
  }

  /**
   * Extract metric from aria-label attribute
   */
  private extractMetricFromAriaLabel(element: Element): { type: string; value: number } | null {
    const ariaLabel = element.getAttribute('aria-label') || '';
    
    // Common patterns in aria-labels
    const patterns = [
      { regex: /(\d+(?:[.,]\d+)?[KMB]?)\s*(?:likes?|hearts?)/i, type: 'likes' },
      { regex: /(\d+(?:[.,]\d+)?[KMB]?)\s*(?:retweets?|reposts?)/i, type: 'retweets' },
      { regex: /(\d+(?:[.,]\d+)?[KMB]?)\s*(?:replies?|comments?)/i, type: 'replies' },
      { regex: /(\d+(?:[.,]\d+)?[KMB]?)\s*(?:views?)/i, type: 'views' },
      { regex: /(\d+(?:[.,]\d+)?[KMB]?)\s*(?:bookmarks?)/i, type: 'bookmarks' },
      { regex: /(\d+(?:[.,]\d+)?[KMB]?)\s*(?:quotes?)/i, type: 'quotes' }
    ];
    
    for (const pattern of patterns) {
      const match = ariaLabel.match(pattern.regex);
      if (match) {
        return {
          type: pattern.type,
          value: this.parseMetricValue(match[1])
        };
      }
    }
    
    return null;
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
   * Extract language from tweet content
   */
  private extractLanguage(article: Element): string | null {
    // Try to get language from lang attribute
    const langElement = safeQuerySelector('[lang]', article);
    if (langElement) {
      const lang = langElement.getAttribute('lang');
      if (lang && lang !== 'und') {
        return lang;
      }
    }
    
    // Fallback to document language
    return document.documentElement.lang || null;
  }

  /**
   * Detect if tweet is from protected account
   */
  private detectProtectedTweet(article: Element): boolean {
    const protectedIndicators = [
      '[data-testid="tweet"] [data-testid="lockIcon"]',
      '[aria-label*="Protected"]',
      '.protected-icon',
      'svg[data-testid="lockIcon"]'
    ];
    
    return protectedIndicators.some(selector => 
      safeQuerySelector(selector, article) !== null
    );
  }

  /**
   * Detect if tweet has media attachments
   */
  private detectMedia(article: Element): boolean {
    const mediaIndicators = [
      '[data-testid="tweetPhoto"]',
      '[data-testid="videoPlayer"]',
      '[data-testid="card.layoutLarge.media"]',
      '[data-testid="card.layoutSmall.media"]',
      'video',
      '.media-container',
      '[data-testid="tweetText"] + div img'
    ];
    
    return mediaIndicators.some(selector => 
      safeQuerySelector(selector, article) !== null
    );
  }

  /**
   * Extract reply-to tweet ID for replies
   */
  private extractReplyToTweetId(article: Element): string | null {
    // Look for reply context links
    const replyLinks = safeQuerySelectorAll('a[href*="/status/"]', article);
    
    for (const link of replyLinks) {
      const href = link.getAttribute('href');
      if (href) {
        const match = href.match(/\/status\/(\d+)/);
        if (match) {
          const tweetId = match[1];
          // Make sure it's not the current tweet
          if (tweetId !== this.extractTweetId()) {
            return tweetId;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Extract quoted tweet ID for quote tweets
   */
  private extractQuotedTweetId(article: Element): string | null {
    // Look for quoted tweet links
    const quotedTweetSelectors = [
      '[data-testid="quoteTweet"] a[href*="/status/"]',
      '[role="blockquote"] a[href*="/status/"]'
    ];
    
    for (const selector of quotedTweetSelectors) {
      const link = safeQuerySelector(selector, article);
      if (link) {
        const href = link.getAttribute('href');
        if (href) {
          const match = href.match(/\/status\/(\d+)/);
          if (match) {
            return match[1];
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Set up URL change detection for SPA navigation
   */
  private setupUrlChangeDetection(): void {
    // Override pushState and replaceState to detect navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    const handleUrlChange = debounce(() => {
      if (window.location.href !== this.currentUrl) {
        debugLog(`URL changed from ${this.currentUrl} to ${window.location.href}`);
        this.cleanup(); // Clean up previous state
        this.currentUrl = window.location.href;
        
        if (this.isTweetPage()) {
          // Re-extract data for new tweet with proper delay
          setTimeout(() => {
            this.waitForPageLoad().then(() => {
              this.extractTweetData();
            });
          }, 1500); // Increased delay for Twitter's loading
        } else {
          debugLog('Not on tweet page after navigation');
        }
      }
    }, 300);
    
    // Store original functions for cleanup
    (window as any).__originalPushState = originalPushState;
    (window as any).__originalReplaceState = originalReplaceState;
    
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
    
    // Store cleanup function
    (window as any).__quotewise_cleanup = () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', handleUrlChange);
    };
  }

  /**
   * Clean up previous extraction state
   */
  private cleanup(): void {
    this.extractedData = null;
    debugLog('Cleaned up previous tweet data');
  }

  /**
   * Handle page unload cleanup
   */
  private setupCleanup(): void {
    window.addEventListener('beforeunload', () => {
      this.cleanup();
      // Restore original functions
      if ((window as any).__quotewise_cleanup) {
        (window as any).__quotewise_cleanup();
      }
    });
  }
}

// Initialize when script loads
new TwitterContentScript();