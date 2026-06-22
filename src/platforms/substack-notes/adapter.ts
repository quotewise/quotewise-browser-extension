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

const SUBSTACK_NOTE_PATH_REGEX = /\/(?:note|notes|p)\/[^/?#]+/;

export class SubstackNotesAdapter implements PlatformAdapter<CapturedPostData> {
  public readonly id = 'substack_notes' as const;

  private cachedData: CapturedPostData | null = null;

  matches(location: Location): boolean {
    return (location.hostname === 'substack.com' || location.hostname.endsWith('.substack.com')) &&
      SUBSTACK_NOTE_PATH_REGEX.test(location.pathname);
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
      : { success: false, error: 'No Substack Note data available on this page.' });
    return true;
  }

  private async extractAndCache(): Promise<CapturedPostData | null> {
    const data = this.extractFromDom();
    if (!data) {
      debugLog('SubstackNotesAdapter: no data extracted');
      return null;
    }

    const changed = !this.cachedData ||
      this.cachedData.sourceId !== data.sourceId ||
      this.cachedData.text !== data.text ||
      this.cachedData.author.handle !== data.author.handle;
    this.cachedData = data;

    if (changed) {
      void sendMessageToBackground({ type: MessageType.POST_DATA_EXTRACTED, data }).catch(error => {
        console.warn('Unable to send extracted Substack Note to background', error);
      });
    }

    return data;
  }

  extractFromDom(urlOverride = window.location.href): CapturedPostData | null {
    const sourceUrl = canonicalUrl(urlOverride);
    const sourceId = sourceIdFromUrl(sourceUrl) || sourceIdFromUrl(urlOverride);
    if (!sourceId) return null;

    const root = firstElementWithHrefContaining(document, sourceId) ||
      document.querySelector<HTMLElement>('article, [role="article"], [data-testid*="note" i], [class*="note" i]') ||
      document.body;

    const text = textFromSelectors(root, [
      '[data-testid="note-content"]',
      '[data-testid*="note" i] [dir="auto"]',
      '.available-content',
      '[dir="auto"]',
      'article',
    ]) || metaContent('meta[property="og:description"]', 'meta[name="description"]') || '';

    const handleFromPath = new URL(urlOverride).pathname.match(/\/@([^/]+)/)?.[1];
    const handleFromDom = root.querySelector<HTMLAnchorElement>('a[href*="/@"]')?.pathname.match(/\/@([^/]+)/)?.[1];
    const handleFromMeta = metaContent('meta[name="author"]', 'meta[property="article:author"]');
    const handle = normalizeHandle(handleFromDom || handleFromPath || handleFromMeta);
    if (!text || !handle) return null;

    const displayName = textFromSelectors(root, [
      '[data-testid*="author" i]',
      '.byline',
      'h1',
    ]) || handle;
    const likesCount = visibleLikesFrom(root);

    return {
      platform: 'substack_notes',
      platformCode: 'SS',
      sourceUrl,
      sourceId,
      text,
      author: {
        handle,
        displayName,
      },
      postedAt: datetimeFrom(root),
      ...(likesCount !== undefined ? { likesCount } : {}),
      requiresSelection: false,
      platformData: {
        source_id: sourceId,
        note_id: sourceId,
        has_media: !!root.querySelector('img, video, audio'),
      },
    };
  }
}
