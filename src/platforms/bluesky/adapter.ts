import { debugLog, sendMessageToBackground } from '../../content/common';
import type { CapturedPostData, ExtensionMessage } from '../../types';
import { MessageType } from '../../types';
import {
  bodyTextFromRoot,
  cleanPermalinkUrl,
  firstElementWithHrefContaining,
  normalizeHandle,
  sourceLinkedRoot,
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
    if (message.type !== MessageType.EXTRACT_POST_DATA) {
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
    const sourceUrl = cleanPermalinkUrl(urlOverride);
    const sourceId = sourceIdFromUrl(sourceUrl) || sourceIdFromUrl(urlOverride);
    const handleFromUrl = blueskyHandleFromUrl(sourceUrl) || blueskyHandleFromUrl(urlOverride);
    const handle = normalizeHandle(handleFromUrl);
    if (!sourceId || !handle) return null;

    const root = blueskyThreadItemForHandle(handle) ||
      sourceLinkedRoot(document, sourceId, '[data-testid^="postThreadItem-by-"], [data-testid="postThreadItem"], [data-testid="post"], article, [role="article"]') ||
      firstElementWithHrefContaining(document, sourceId) ||
      document.body;

    const text = textFromSelectors(root, [
      '[data-testid="postText"]',
      '[data-testid*="postContent" i]',
    ]) || bodyTextFromRoot(root, sourceId);
    if (!text) return null;

    const displayName = blueskyDisplayName(root, handle) || textFromSelectors(root, [
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

function blueskyHandleFromUrl(url: string): string | undefined {
  try {
    return new URL(url).pathname.match(/^\/profile\/([^/]+)\/post\//)?.[1];
  } catch {
    return undefined;
  }
}

function blueskyThreadItemForHandle(handle: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="postThreadItem-by-"]'))
    .find(element => element.getAttribute('data-testid') === `postThreadItem-by-${handle}`) ?? null;
}

function blueskyDisplayName(root: ParentNode, handle: string): string | null {
  const profileLink = Array.from(root.querySelectorAll<HTMLAnchorElement>(`a[href*="/profile/${handle}"]`))
    .find(link => {
      const text = link.textContent?.trim() || '';
      return text && !text.includes('/post/');
    });
  const profileText = profileLink?.textContent?.trim();
  if (profileText) {
    return profileText.replace(`@${handle}`, '').trim() || null;
  }

  const rootText = root.textContent || '';
  const profileMatch = rootText.match(new RegExp(`^(.+?)@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  return profileMatch?.[1]?.trim() || null;
}
