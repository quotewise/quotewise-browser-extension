import { debugLog, sendMessageToBackground } from '../../content/common';
import type { CapturedPostData, ExtensionMessage } from '../../types';
import { MessageType } from '../../types';
import {
  canonicalUrl,
  datetimeFrom,
  firstElementWithHrefContaining,
  metaContent,
  normalizeHandle,
  textFromSelectors,
  visibleLikesFrom,
} from '../dom-extraction';
import { sourceIdFromUrl } from '../capture';
import type { PlatformAdapter } from '../types';

const BLUESKY_POST_PATH_REGEX = /^\/profile\/[^/]+\/post\/[^/?#]+/;

export class BlueskyAdapter implements PlatformAdapter<CapturedPostData> {
  public readonly id = 'bluesky' as const;

  private cachedData: CapturedPostData | null = null;

  matches(location: Location): boolean {
    return location.hostname === 'bsky.app' && BLUESKY_POST_PATH_REGEX.test(location.pathname);
  }

  async bootstrap(): Promise<void> {
    await this.extractAndCache();
  }

  async teardown(): Promise<void> {
    this.cachedData = null;
  }

  async getLatestData(): Promise<CapturedPostData | null> {
    return this.extractAndCache();
  }

  async handleMessage(
    message: ExtensionMessage,
    sendResponse: (response: unknown) => void,
  ): Promise<boolean> {
    if (message.type !== MessageType.EXTRACT_POST_DATA && message.type !== MessageType.EXTRACT_TWEET_DATA) {
      return false;
    }

    const data = await this.getLatestData();
    sendResponse(data
      ? { success: true, data }
      : { success: false, error: 'No Bluesky post data available on this page.' });
    return true;
  }

  private async extractAndCache(): Promise<CapturedPostData | null> {
    const data = this.extractFromDom();
    if (!data) {
      debugLog('BlueskyAdapter: no data extracted');
      return null;
    }

    const changed = !this.cachedData ||
      this.cachedData.sourceId !== data.sourceId ||
      this.cachedData.text !== data.text ||
      this.cachedData.author.handle !== data.author.handle;
    this.cachedData = data;

    if (changed) {
      void sendMessageToBackground({ type: MessageType.POST_DATA_EXTRACTED, data }).catch(error => {
        console.warn('Unable to send extracted Bluesky post to background', error);
      });
    }

    return data;
  }

  extractFromDom(urlOverride = window.location.href): CapturedPostData | null {
    const sourceUrl = canonicalUrl(urlOverride);
    const sourceId = sourceIdFromUrl(sourceUrl) || sourceIdFromUrl(urlOverride);
    const handleFromUrl = new URL(urlOverride).pathname.match(/^\/profile\/([^/]+)\/post\//)?.[1];
    const handle = normalizeHandle(handleFromUrl);
    if (!sourceId || !handle) return null;

    const root = firstElementWithHrefContaining(document, sourceId) ||
      document.querySelector<HTMLElement>('[data-testid="postThreadItem"], [data-testid="post"], article, [role="article"]') ||
      document.body;

    const text = textFromSelectors(root, [
      '[data-testid="postText"]',
      '[data-testid*="post-text" i]',
      '[data-testid*="postContent" i]',
      '[dir="auto"]',
    ]) || metaContent('meta[property="og:description"]', 'meta[name="description"]') || '';
    if (!text) return null;

    const displayName = textFromSelectors(root, [
      '[data-testid="postAuthorDisplayName"]',
      '[data-testid*="author" i] [dir="auto"]',
      'h1',
    ]) || handle;
    const likesCount = visibleLikesFrom(root);

    return {
      platform: 'bluesky',
      platformCode: 'BS',
      sourceUrl,
      sourceId,
      text,
      author: {
        handle,
        displayName,
        profileUrl: `https://bsky.app/profile/${handle}`,
      },
      postedAt: datetimeFrom(root),
      ...(likesCount !== undefined ? { likesCount } : {}),
      requiresSelection: false,
      platformData: {
        source_id: sourceId,
        post_id: sourceId,
        has_media: !!root.querySelector('img, video'),
      },
    };
  }
}
