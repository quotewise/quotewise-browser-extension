import { cleanUrl, debugLog, extractTextContent, parseNumber, sendMessageToBackground } from '../../content/common';
import type { ExtensionMessage, TwitterData } from '../../types';
import { MessageType } from '../../types';
import type { PlatformAdapter } from '../types';

const TWEET_PATH_REGEX = /\/status\/\d+/;

export class TwitterAdapter implements PlatformAdapter<TwitterData> {
  public readonly id = 'twitter' as const;

  private currentUrl: string = window.location.href;
  private cachedData: TwitterData | null = null;
  private mutationObserver: MutationObserver | null = null;
  private extractionInFlight = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastExtractedHash: string | null = null; // To avoid re-sending identical data

  matches(location: Location): boolean {
    const host = location.hostname;
    const path = location.pathname;
    return (host === 'twitter.com' || host === 'x.com') && TWEET_PATH_REGEX.test(path);
  }

  async bootstrap(): Promise<void> {
    if (!this.matches(window.location)) {
      return;
    }

    this.currentUrl = window.location.href;
    await this.extractAndCache();
    this.startDomWatcher();
  }

  async teardown(): Promise<void> {
    this.cachedData = null;
    this.lastExtractedHash = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }

  async getLatestData(): Promise<TwitterData | null> {
    return this.ensureData();
  }

  async handleMessage(
    message: ExtensionMessage,
    sendResponse: (response: any) => void
  ): Promise<boolean> {
    if (message.type !== MessageType.EXTRACT_TWEET_DATA) {
      return false;
    }

    try {
      const data = await this.ensureData();
      if (data) {
        sendResponse({ success: true, data });
      } else {
        sendResponse({ success: false, error: 'No tweet data available on this page.' });
      }
    } catch (error) {
      console.error('Error responding with tweet data', error);
      sendResponse({ success: false, error: 'Failed to extract tweet data' });
    }

    return true;
  }

  private startDomWatcher(): void {
    if (this.mutationObserver) return;

    const debouncedReExtract = () => {
      // Clear any pending debounce timer
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      // Debounce extraction to avoid repeated calls during DOM updates
      this.debounceTimer = setTimeout(() => {
        const newUrl = window.location.href;
        // Compare tweet IDs, not full URLs - this is more reliable for detecting actual tweet changes
        const newTweetId = this.extractTweetIdFromUrl(newUrl);
        const oldTweetId = this.extractTweetIdFromUrl(this.currentUrl);
        if (newTweetId !== oldTweetId) {
          this.currentUrl = newUrl;
          this.cachedData = null;
          this.lastExtractedHash = null;
        }
        this.extractAndCache();
      }, 500); // Wait 500ms after last DOM mutation
    };

    this.mutationObserver = new MutationObserver(() => debouncedReExtract());
    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  private async ensureData(): Promise<TwitterData | null> {
    if (this.cachedData) return this.cachedData;
    return await this.extractAndCache();
  }

  private async extractAndCache(): Promise<TwitterData | null> {
    if (this.extractionInFlight) return this.cachedData;
    this.extractionInFlight = true;

    try {
      const data = this.extractFromDom();
      if (!data) {
        debugLog('TwitterAdapter: no data extracted');
        return null;
      }

      // Create a hash of the important data to detect changes
      // Tweet ID is the most reliable indicator of different tweets
      const tweetId = this.extractTweetId();
      const dataHash = `${tweetId}|${data.text}|${data.author?.username}`;

      // Only send to background if data has actually changed
      if (dataHash !== this.lastExtractedHash) {
        this.lastExtractedHash = dataHash;
        this.cachedData = data;

        try {
          await sendMessageToBackground({
            type: MessageType.TWEET_DATA_EXTRACTED,
            data
          });
          debugLog('TwitterAdapter: sent new data to background');
        } catch (error) {
          console.warn('Unable to send extracted tweet to background', error);
        }
      } else {
        debugLog('TwitterAdapter: data unchanged, skipping send');
      }

      return data;
    } catch (error) {
      console.error('TwitterAdapter extraction failed', error);
      return null;
    } finally {
      this.extractionInFlight = false;
    }
  }

  private extractFromDom(): TwitterData | null {
    const article = this.findPrimaryArticle();
    if (!article) {
      return null;
    }

    const text = this.extractTweetText(article);
    const author = this.extractAuthor(article);
    const metrics = this.extractMetrics(article);
    const tweetId = this.extractTweetIdFromArticle(article);
    // Construct URL from extracted tweet ID and author to ensure we have the correct direct link
    const url = tweetId && author.username
      ? `https://x.com/${author.username}/status/${tweetId}`
      : cleanUrl(window.location.href);
    const date = this.extractDate(article);
    const language = this.extractLanguage(article);
    const isProtected = this.detectProtected(article);
    const mediaPresent = this.detectMedia(article);
    const tweetType = this.detectTweetType(article);
    const isArticle = this.detectArticle(article);

    if (!text || !tweetId) {
      return null;
    }

    const twitterData: TwitterData = {
      text,
      author: {
        username: author.username,
        displayName: author.displayName,
        verified: author.verified,
        profileUrl: author.profileUrl,
        avatarUrl: author.avatarUrl
      },
      url,
      date,
      likes: metrics.likes,
      retweets: metrics.retweets,
      replies: metrics.replies,
      views: metrics.views,
      bookmarks: metrics.bookmarks,
      tweetType,
      language: language || undefined,
      isProtected,
      isArticle,
      platform_data: {
        tweet_id: tweetId,
        reply_count: metrics.replies,
        retweet_count: metrics.retweets,
        quote_count: metrics.quotes,
        bookmark_count: metrics.bookmarks,
        view_count: metrics.views,
        is_protected: isProtected,
        has_media: mediaPresent,
        reply_to_tweet_id: undefined,
        quoted_tweet_id: undefined
      }
    };

    return twitterData;
  }

  private findPrimaryArticle(urlOverride?: string): HTMLElement | null {
    // Get the tweet ID from the current URL - this is the tweet we want to capture
    const urlTweetId = this.extractTweetIdFromUrl(urlOverride ?? window.location.href);

    const selectors = [
      'article[data-testid="tweet"]',
      'article[role="article"]',
      'div[data-testid="tweet"]',
      '[data-testid="primaryColumn"] article'
    ];

    // Collect all unique candidate articles
    const allArticles: HTMLElement[] = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        if (!allArticles.includes(el as HTMLElement)) {
          allArticles.push(el as HTMLElement);
        }
      });
    }

    if (allArticles.length === 0) {
      return null;
    }

    // Score each article based on multiple signals
    const scored = allArticles.map((article, index) => ({
      element: article,
      tweetId: this.extractTweetIdFromArticleElement(article),
      priority: this.calculateArticlePriority(article, index, urlTweetId)
    }));

    // Sort by priority (highest first)
    scored.sort((a, b) => b.priority - a.priority);

    const winner = scored[0];
    debugLog(`TwitterAdapter: Selected article with priority ${winner.priority} (tweet ID: ${winner.tweetId})`);

    return winner.element;
  }

  /**
   * Calculate priority score for an article based on multiple signals.
   * Higher score = more likely to be the focal tweet.
   */
  private calculateArticlePriority(article: HTMLElement, index: number, urlTweetId: string | null): number {
    let priority = 0;
    const articleTweetId = this.extractTweetIdFromArticleElement(article);

    // HIGHEST PRIORITY: URL tweet ID match (most reliable signal)
    if (urlTweetId && articleTweetId === urlTweetId) {
      priority += 1000;
    }

    // HIGH PRIORITY: Position in primaryColumn
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    if (primaryColumn?.contains(article)) {
      // First article in primary column gets bonus
      const primaryArticles = primaryColumn.querySelectorAll('article[data-testid="tweet"]');
      if (primaryArticles[0] === article) {
        priority += 100;
      }
    }

    // MEDIUM PRIORITY: First cellInnerDiv (Twitter's internal cell structure)
    const cellInnerDiv = article.closest('[data-testid="cellInnerDiv"]');
    if (cellInnerDiv) {
      const allCells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      if (allCells[0] === cellInnerDiv) {
        priority += 50;
      }
    }

    // LOW PRIORITY: Tabindex="0" indicates focused/primary element
    if (article.getAttribute('tabindex') === '0') {
      priority += 25;
    }

    // SLIGHT PRIORITY: Earlier in DOM order (tiebreaker)
    priority += Math.max(0, 10 - index);

    // NEGATIVE: Inside a quoted tweet container (embedded quote, not the main tweet)
    if (article.closest('[data-testid="quotedTweet"]')) {
      priority -= 500;
    }

    // NEGATIVE: Has social context sibling (indicates retweet context)
    const prevSibling = article.parentElement?.previousElementSibling;
    if (prevSibling?.querySelector('[data-testid="socialContext"]')) {
      priority -= 50;
    }

    return priority;
  }

  /**
   * Extract tweet ID from an article element without side effects
   * Used for matching articles to URL tweet IDs
   */
  private extractTweetIdFromArticleElement(article: Element): string | null {
    // Try to get tweet ID from the timestamp link within the article
    const timeLink = article.querySelector('a[href*="/status/"] time')?.parentElement as HTMLAnchorElement | null;
    if (timeLink?.href) {
      const match = timeLink.href.match(/status\/(\d+)/);
      if (match) return match[1];
    }

    // Also try other links that might contain the tweet status URL
    const statusLinks = article.querySelectorAll('a[href*="/status/"]');
    for (const link of statusLinks) {
      const href = (link as HTMLAnchorElement).href;
      // Skip links to quoted tweets or other embedded content
      if (href.includes('/photo/') || href.includes('/video/')) continue;
      const match = href.match(/status\/(\d+)/);
      if (match) return match[1];
    }

    return null;
  }

  private extractTweetText(article: Element): string | null {
    // Canonical tweet-text container (normal tweets): trust it when present.
    const primary = article.querySelector('[data-testid="tweetText"]');
    if (primary) {
      const text = extractTextContent(primary);
      if (text) return text;
    }

    // Long-form X Articles have no tweetText node — the body lives in a
    // dedicated read view, and its paragraphs carry no [lang]/dir="auto", so
    // the generic fallbacks below cannot reach it. The rich-text view is an
    // ancestor of the per-block longform component, so it is matched first in
    // document order and yields the full body.
    const articleBody = article.querySelector(
      '[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]'
    );
    if (articleBody) {
      const text = extractTextContent(articleBody);
      if (text) return text;
    }

    // Broad fallbacks. These latch onto non-content UI — notably the bare
    // "Click to Subscribe to <name>" CTA, which is a plain div[dir="auto"]
    // with no role/button/testid hook. Skip interactive controls and the
    // subscribe CTA, but never regress to null while some text exists (so
    // capture still opens and the user's selection can drive the quote).
    const fallbackSelectors = ['[lang]', 'div[dir="auto"]', 'article span[lang]'];
    let firstAnyText: string | null = null;

    for (const selector of fallbackSelectors) {
      for (const node of article.querySelectorAll(selector)) {
        const text = extractTextContent(node);
        if (!text) continue;
        if (firstAnyText === null) firstAnyText = text;
        if (this.isInteractiveControl(node) || this.isSubscribeCta(text)) continue;
        return text;
      }
    }

    return firstAnyText;
  }

  /**
   * True when the node is, or lives inside, an interactive control such as a
   * button — never real quote content.
   */
  private isInteractiveControl(node: Element): boolean {
    return !!node.closest('button, [role="button"], [data-testid="placementTracking"]');
  }

  /**
   * X's "Subscribe" call-to-action ("Click to Subscribe to <name>") renders as
   * a bare div with no structural hook, so it can only be recognized by its
   * short, fixed phrasing.
   */
  private isSubscribeCta(text: string): boolean {
    return text.length < 80 && /^(click to )?subscribe to /i.test(text);
  }

  private extractAuthor(article: Element): {
    username: string;
    displayName: string;
    verified: boolean;
    profileUrl?: string;
    avatarUrl?: string;
  } {
    const author = {
      username: '',
      displayName: '',
      verified: false,
      profileUrl: undefined as string | undefined,
      avatarUrl: undefined as string | undefined
    };

    const userLink = article.querySelector('[data-testid="User-Name"] a[href*="/"]') as HTMLAnchorElement | null;
    if (userLink?.href) {
      const handle = this.extractHandleFromHref(userLink.href);
      if (handle) {
        author.username = handle;
        author.profileUrl = userLink.href;
      }
    }

    const displayNameNode = article.querySelector('[data-testid="User-Name"] span:first-child span') ||
      article.querySelector('[data-testid="User-Names"] span:first-child') ||
      article.querySelector('[role="link"][tabindex="-1"] span');

    const displayName = displayNameNode ? extractTextContent(displayNameNode) : '';
    if (displayName) {
      author.displayName = displayName;
    }

    const verifiedIcon = article.querySelector('[data-testid="icon-verified"], svg[aria-label*="Verified"]');
    author.verified = !!verifiedIcon;

    const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"] img, [data-testid="UserAvatar-Container-unknown"] img') as HTMLImageElement | null;
    if (avatar?.src?.startsWith('http')) {
      author.avatarUrl = avatar.src;
    }

    // NB: no retweeter/socialContext extraction. The "X reposted" banner only
    // appears in timeline/feed views; on a /status/ permalink (the only place
    // the content script runs) you are viewing the original tweet, so there is
    // no reposter to extract. (Verified 2026-06-02, docs/twitter-dom-verification.md.)

    return author;
  }

  private extractHandleFromHref(href: string): string | null {
    const match = href.match(/twitter\.com\/([^/?]+)/i) || href.match(/x\.com\/([^/?]+)/i);
    return match ? match[1] : null;
  }

  private extractMetrics(article: Element): {
    replies: number;
    retweets: number;
    likes: number;
    views: number;
    bookmarks: number;
    quotes: number;
  } {
    const metrics = {
      replies: 0,
      retweets: 0,
      likes: 0,
      views: 0,
      bookmarks: 0,
      quotes: 0
    };

    const selectors: Record<keyof typeof metrics, string[]> = {
      replies: ['[data-testid="reply"]'],
      retweets: ['[data-testid="retweet"]', '[data-testid="retweetConfirm"]'],
      likes: ['[data-testid="like"]', '[data-testid="likeConfirm"]'],
      views: ['[aria-label*="View"]', '[data-testid="app-text-transition-container"]'],
      bookmarks: ['[data-testid="bookmark"]', '[aria-label*="Bookmark"]'],
      quotes: ['[data-testid="quoteTweet"] [data-testid="app-text-transition-container"]']
    };

    const collectElements = (sels: string[]): Element[] => {
      const found: Element[] = [];
      sels.forEach(sel => {
        article.querySelectorAll(sel).forEach(el => found.push(el));
      });
      return found;
    };

    const parseCount = (els: Element[], hints: string[] = []): number => {
      for (const el of els) {
        const candidates = [el, ...Array.from(el.querySelectorAll('[data-testid="app-text-transition-container"]'))];
        for (const c of candidates) {
          const text = c.getAttribute('aria-label') || c.textContent || '';
          const lowered = text.toLowerCase();
          if (hints.length === 0 || hints.some(h => lowered.includes(h)) || /\d/.test(text)) {
            const num = parseNumber(text);
            if (!isNaN(num) && num >= 0) {
              return num;
            }
          }
        }
      }
      return 0;
    };

    metrics.replies = parseCount(collectElements(selectors.replies));
    metrics.retweets = parseCount(collectElements(selectors.retweets));
    metrics.likes = parseCount(collectElements(selectors.likes));
    metrics.bookmarks = parseCount(collectElements(selectors.bookmarks), ['bookmark']);
    metrics.quotes = parseCount(collectElements(selectors.quotes));
    // Prefer the full-integer views from the article's aria-label summary; the
    // per-element views display is K/M-abbreviated and parses lossily.
    const summaryViews = this.extractViewsFromSummary(article);
    metrics.views = summaryViews ?? parseCount(collectElements(selectors.views), ['view']);

    return metrics;
  }

  /**
   * X exposes a full-integer metrics summary on the article (or a descendant)
   * aria-label, e.g. "2 replies, 11 reposts, 196 likes, 67 bookmarks, 24226 views".
   * The standalone views display is abbreviated ("24.2K"), so prefer this when present.
   * Returns null if no "N views" summary is found (caller falls back).
   */
  private extractViewsFromSummary(article: Element): number | null {
    const candidates = [article, ...Array.from(article.querySelectorAll('[aria-label]'))];
    for (const el of candidates) {
      const aria = el.getAttribute('aria-label') || '';
      if (!/\blikes?\b/i.test(aria)) continue; // identify the all-metrics summary
      const match = aria.match(/([\d,]+)\s+views?\b/i);
      if (match) {
        const n = parseInt(match[1].replace(/,/g, ''), 10);
        if (!isNaN(n)) return n;
      }
    }
    return null;
  }

  /**
   * Extract tweet ID from the article element (timestamp link) or fall back to URL
   */
  private extractTweetIdFromArticle(article: Element): string | null {
    // Try to extract from the article element first
    const articleTweetId = this.extractTweetIdFromArticleElement(article);
    if (articleTweetId) return articleTweetId;

    // Fall back to URL-based extraction
    return this.extractTweetIdFromUrl(window.location.href);
  }

  private extractTweetId(): string | null {
    return this.extractTweetIdFromUrl(window.location.href);
  }

  private extractTweetIdFromUrl(url: string): string | null {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
  }

  private extractDate(article: Element): string | null {
    const time = article.querySelector('time');
    if (!time) return null;
    const date = time.getAttribute('datetime') || time.getAttribute('aria-label');
    return date ? new Date(date).toISOString() : null;
  }

  private extractLanguage(article: Element): string | null {
    const node = article.querySelector('[lang]');
    if (!node) return null;
    const lang = node.getAttribute('lang');
    return lang || null;
  }

  private detectProtected(article: Element): boolean {
    return !!article.querySelector('[data-testid="icon-lock"], svg[aria-label*="Protected"], [aria-label*="Protected account"]');
  }

  private detectMedia(article: Element): boolean {
    return !!article.querySelector('[data-testid="tweetPhoto"], video, audio');
  }

  private detectTweetType(article: Element): TwitterData['tweetType'] {
    // A quote tweet nests the quoted tweet inside the focal article, so the
    // article has two [data-testid="tweetText"] nodes (X no longer exposes a
    // quoteTweet testid — verified 2026-06-02, see docs/twitter-dom-verification.md).
    if (article.querySelectorAll('[data-testid="tweetText"]').length >= 2) return 'quote';
    // "Replying to @x" marks a reply to another user. (Self-thread replies show a
    // thread connector instead and fall through to 'original' — acceptable.)
    // NB: do NOT use [data-testid="reply"] — that is the reply *action button*
    // present on every tweet, so it misclassifies all originals as replies.
    if (article.textContent?.includes('Replying to')) return 'reply';
    return 'original';
  }

  /**
   * Long-form X Articles render the body in a dedicated read view rather than a
   * tweetText node. Their presence marks the post as an article, where capture
   * should require an explicit text selection instead of grabbing the whole body.
   */
  private detectArticle(article: Element): boolean {
    return !!article.querySelector(
      '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]'
    );
  }
}
