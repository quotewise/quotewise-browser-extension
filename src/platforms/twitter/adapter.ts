import { cleanUrl, debugLog, extractTextContent, parseNumber, sendMessageToBackground } from '../../content/common';
import type { ExtensionMessage, TwitterData } from '../../types';
import { MessageType } from '../../types';
import type { PlatformAdapter } from '../types';

const TWEET_PATH_REGEX = /^\/[^/]+\/status\/\d+/;

export class TwitterAdapter implements PlatformAdapter<TwitterData> {
  public readonly id = 'twitter' as const;

  private currentUrl: string = window.location.href;
  private cachedData: TwitterData | null = null;
  private mutationObserver: MutationObserver | null = null;
  private extractionInFlight = false;

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

    const reExtract = () => {
      const newUrl = window.location.href;
      if (newUrl !== this.currentUrl) {
        this.currentUrl = newUrl;
        this.cachedData = null;
      }
      this.extractAndCache();
    };

    this.mutationObserver = new MutationObserver(() => reExtract());
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

      this.cachedData = data;

      try {
        await sendMessageToBackground({
          type: MessageType.TWEET_DATA_EXTRACTED,
          data
        });
      } catch (error) {
        console.warn('Unable to send extracted tweet to background', error);
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
    const tweetId = this.extractTweetId();
    const url = cleanUrl(window.location.href);
    const date = this.extractDate(article);
    const language = this.extractLanguage(article);
    const isProtected = this.detectProtected(article);
    const mediaPresent = this.detectMedia(article);
    const retweeter = author.retweeter;
    const tweetType = this.detectTweetType(article, !!retweeter);

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
      retweeter: retweeter ? {
        username: retweeter.username,
        displayName: retweeter.displayName
      } : undefined,
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
        quoted_tweet_id: undefined,
        retweeter_username: retweeter?.username,
        retweeter_display_name: retweeter?.displayName
      }
    };

    return twitterData;
  }

  private findPrimaryArticle(): HTMLElement | null {
    const selectors = [
      'article[data-testid="tweet"]',
      'article[role="article"]',
      'div[data-testid="tweet"]',
      '[data-testid="primaryColumn"] article'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el as HTMLElement;
    }

    return null;
  }

  private extractTweetText(article: Element): string | null {
    const selectors = [
      '[data-testid="tweetText"]',
      '[lang]',
      'div[dir="auto"]',
      'article span[lang]'
    ];

    for (const selector of selectors) {
      const node = article.querySelector(selector);
      if (node) {
        const text = extractTextContent(node);
        if (text) return text;
      }
    }

    return null;
  }

  private extractAuthor(article: Element): {
    username: string;
    displayName: string;
    verified: boolean;
    profileUrl?: string;
    avatarUrl?: string;
    retweeter?: { username: string; displayName: string };
  } {
    const author = {
      username: '',
      displayName: '',
      verified: false,
      profileUrl: undefined as string | undefined,
      avatarUrl: undefined as string | undefined,
      retweeter: undefined as { username: string; displayName: string } | undefined
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

    const socialContext = document.querySelector('[data-testid="socialContext"]');
    const socialText = socialContext ? extractTextContent(socialContext).toLowerCase() : '';
    if (socialText.includes('retweeted') || socialText.includes('reposted')) {
      const retweeterLink = socialContext?.querySelector('a[href*="/"]') as HTMLAnchorElement | null;
      const retweeterHandle = retweeterLink?.href ? this.extractHandleFromHref(retweeterLink.href) : null;
      const retweeterName = retweeterLink ? extractTextContent(retweeterLink) : null;
      if (retweeterHandle) {
        author.retweeter = {
          username: retweeterHandle,
          displayName: retweeterName || retweeterHandle
        };
      }
    }

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
    metrics.views = parseCount(collectElements(selectors.views), ['view']);

    return metrics;
  }

  private extractTweetId(): string | null {
    const match = window.location.pathname.match(/status\/(\d+)/);
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

  private detectTweetType(article: Element, hasRetweeter: boolean): TwitterData['tweetType'] {
    if (article.querySelector('[data-testid="quoteTweet"]')) return 'quote';
    if (hasRetweeter) return 'retweet';
    const replyIndicator = article.querySelector('[data-testid="reply"]') || article.textContent?.includes('Replying to');
    if (replyIndicator) return 'reply';
    return 'original';
  }
}
