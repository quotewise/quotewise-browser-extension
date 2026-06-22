import { debugLog, sendMessageToBackground } from '../../content/common';
import type { CapturedPostData, ExtensionMessage } from '../../types';
import { MessageType } from '../../types';
import {
  adjacentActionCountFrom,
  bodyTextFromRoot,
  cleanPermalinkUrl,
  datetimeFromSourceLink,
  firstElementWithHrefContaining,
  metadataUrl,
  metaContent,
  normalizeHandle,
  sourceLinkedRoot,
  textFromSelectors,
  visibleLikesFrom,
} from '../dom-extraction';
import { sourceIdFromUrl } from '../capture';
import type { PlatformAdapter } from '../types';

const THREADS_POST_PATH_REGEX = /\/(?:@[^/]+\/)?(?:post|t)\/[^/?#]+/;

export class ThreadsAdapter implements PlatformAdapter<CapturedPostData> {
  public readonly id = 'threads' as const;

  private cachedData: CapturedPostData | null = null;

  matches(location: Location): boolean {
    const host = location.hostname;
    return (host === 'threads.com' || host === 'www.threads.com' || host === 'threads.net' || host === 'www.threads.net') &&
      THREADS_POST_PATH_REGEX.test(location.pathname);
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
      : { success: false, error: 'No Threads post data available on this page.' });
    return true;
  }

  private async extractAndCache(): Promise<CapturedPostData | null> {
    const data = this.extractFromDom();
    if (!data) {
      debugLog('ThreadsAdapter: no data extracted');
      return null;
    }

    const changed = !this.cachedData ||
      this.cachedData.sourceId !== data.sourceId ||
      this.cachedData.text !== data.text ||
      this.cachedData.author.handle !== data.author.handle;
    this.cachedData = data;

    if (changed) {
      void sendMessageToBackground({ type: MessageType.POST_DATA_EXTRACTED, data }).catch(error => {
        console.warn('Unable to send extracted Threads post to background', error);
      });
    }

    return data;
  }

  extractFromDom(urlOverride = window.location.href): CapturedPostData | null {
    const sourceUrl = cleanPermalinkUrl(urlOverride);
    const sourceId = sourceIdFromUrl(sourceUrl) || sourceIdFromUrl(urlOverride);
    if (!sourceId) return null;

    const handleFromUrl = threadsHandleFromUrl(sourceUrl) || threadsHandleFromUrl(urlOverride);
    const root = sourceLinkedRoot(
      document,
      sourceId,
      'article, [role="article"], [data-testid*="post" i], [data-testid*="thread" i], [aria-label="Column body" i]',
    ) ||
      firstElementWithHrefContaining(document, sourceId) ||
      document.body;

    const metadataMatchesSource = threadsMetadataMatchesSource(sourceId, handleFromUrl);
    const metadataText = metadataMatchesSource
      ? metaContent('meta[property="og:description"]', 'meta[name="description"]')
      : null;
    const visibleText = textFromSelectors(root, [
      '[data-testid="post-text"]',
      '[data-testid="thread-text"]',
      '[data-testid*="post-text" i]',
      '[data-pressable-container="true"] [dir="auto"]',
    ]) || bodyTextFromRoot(root, sourceId);
    const text = metadataText || visibleText;

    const handleFromDom = root.querySelector<HTMLAnchorElement>('a[href*="/@"]')?.pathname.match(/\/@([^/]+)/)?.[1];
    const handleFromMetadata = metadataMatchesSource ? threadsHandleFromTitle() : undefined;
    const handle = normalizeHandle(handleFromUrl || handleFromDom || handleFromMetadata);
    if (!text || !handle) return null;

    const displayName = (metadataMatchesSource ? threadsDisplayNameFromTitle() : null) || textFromSelectors(root, [
      '[data-testid="post-author-name"]',
      '[data-testid*="author" i] [dir="auto"]',
      'h1',
    ]) || handle;
    const likesCount = visibleLikesFrom(root) ?? adjacentActionCountFrom(root, 'Like', 'Reply');

    return {
      platform: 'threads',
      platformCode: 'TH',
      sourceUrl,
      sourceId,
      text,
      author: {
        handle,
        displayName,
        profileUrl: `https://threads.com/@${handle}`,
      },
      postedAt: datetimeFromSourceLink(document, sourceId),
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

function threadsHandleFromUrl(url: string): string | undefined {
  try {
    return normalizeHandle(new URL(url).pathname.match(/\/@([^/]+)\//)?.[1]);
  } catch {
    return undefined;
  }
}

function threadsMetadataMatchesSource(sourceId: string, handle?: string): boolean {
  const candidates = [
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    metadataUrl('meta[property="og:url"]'),
  ].filter((value): value is string => !!value);

  return candidates.some(url => {
    const metadataHandle = threadsHandleFromUrl(url);
    return sourceIdFromUrl(url) === sourceId &&
      (!handle || !metadataHandle || metadataHandle === handle);
  });
}

function threadsDisplayNameFromTitle(): string | null {
  const title = metaContent('meta[property="og:title"]') || document.title;
  const match = title.match(/^(.+?)\s+\(@[^)]+\)/);
  return match?.[1]?.trim() || null;
}

function threadsHandleFromTitle(): string | undefined {
  const title = metaContent('meta[property="og:title"]') || document.title;
  return normalizeHandle(title.match(/\(@([^)]+)\)/)?.[1]);
}
