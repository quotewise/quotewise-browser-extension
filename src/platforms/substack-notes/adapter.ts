import { debugLog, sendMessageToBackground } from '../../content/common';
import type { CapturedPostData, ExtensionMessage } from '../../types';
import { MessageType } from '../../types';
import {
  bodyTextFromRoot,
  cleanPermalinkUrl,
  datetimeFrom,
  firstElementWithHrefContaining,
  metadataCountByLabel,
  metadataUrl,
  metaContent,
  normalizeHandle,
  sourceLinkedRoot,
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
    const browserSourceId = sourceIdFromUrl(urlOverride);
    const metadataSourceUrl = substackMetadataUrlForSource(browserSourceId);
    const sourceUrl = metadataSourceUrl || cleanPermalinkUrl(urlOverride);
    const sourceId = sourceIdFromUrl(sourceUrl) || browserSourceId;
    if (!sourceId) return null;

    const root = sourceLinkedRoot(document, sourceId, 'article, [role="article"], [aria-label="Note" i], [data-testid*="note" i], [class*="feedItem" i], [class*="note" i]') ||
      firstElementWithHrefContaining(document, sourceId, 'article, [role="article"], [aria-label="Note" i], [data-testid*="note" i], [class*="feedItem" i], [class*="note" i]') ||
      document.querySelector<HTMLElement>('article, [role="article"], [data-testid*="note" i], [class*="note" i]') ||
      document.body;

    const metadataText = metaContent('meta[property="og:description"]', 'meta[name="description"]');
    const visibleText = textFromSelectors(root, [
      '[data-testid="note-content"]',
      '.ProseMirror',
      '.FeedProseMirror',
      '[data-testid*="note" i] [dir="auto"]',
      '.available-content',
      '[dir="auto"]',
      'article',
    ]) || bodyTextFromRoot(root, sourceId);
    const text = metadataText || visibleText;

    const handleFromPath = new URL(urlOverride).pathname.match(/\/@([^/]+)/)?.[1];
    const handleFromDom = substackHandleFromSourceLink(sourceId, root);
    const handleFromTitle = substackAuthorFromTitle().handle;
    const handleFromMeta = metaContent('meta[name="author"]', 'meta[property="article:author"]');
    const handle = normalizeHandle(handleFromPath || handleFromDom || handleFromTitle || handleFromMeta);
    if (!text || !handle) return null;

    const titleAuthor = substackAuthorFromTitle();
    const displayName = titleAuthor.displayName || textFromSelectors(root, [
      '[data-testid*="author" i]',
      '.byline',
      'h1',
    ]) || handle;
    const likesCount = metadataCountByLabel('Likes') ?? visibleLikesFrom(root);
    const repliesCount = metadataCountByLabel('Replies');

    return {
      platform: 'substack_notes',
      platformCode: 'SS',
      sourceUrl,
      sourceId,
      text,
      author: {
        handle,
        displayName,
        profileUrl: `https://substack.com/@${handle}`,
      },
      postedAt: datetimeFrom(root),
      ...(likesCount !== undefined ? { likesCount } : {}),
      requiresSelection: false,
      platformData: {
        source_id: sourceId,
        note_id: sourceId,
        ...(repliesCount !== undefined ? { reply_count: repliesCount } : {}),
        ...substackProfileSlug(urlOverride),
        has_media: !!root.querySelector('img, video, audio'),
      },
    };
  }
}

function substackMetadataUrlForSource(sourceId: string | null): string | null {
  const candidates = [
    metadataUrl('meta[property="og:url"]'),
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
  ].filter((value): value is string => !!value);

  if (!sourceId) {
    return candidates[0] ? cleanPermalinkUrl(candidates[0]) : null;
  }

  const match = candidates.find(url => sourceIdFromUrl(url) === sourceId);
  return match ? cleanPermalinkUrl(match) : null;
}

function substackHandleFromSourceLink(sourceId: string, root: ParentNode): string | undefined {
  const sourceLink = Array.from(root.querySelectorAll<HTMLAnchorElement>(`a[href*="${sourceId.replace(/["\\]/g, '\\$&')}"]`))
    .find(link => /\/@[^/]+\/note\//.test(link.pathname));
  return normalizeHandle(sourceLink?.pathname.match(/\/@([^/]+)\/note\//)?.[1]);
}

function substackAuthorFromTitle(): { displayName: string | null; handle: string | undefined } {
  const title = metaContent('meta[property="og:title"]') || document.title;
  const match = title.match(/^(.+?)\s+\(@([^)]+)\)/);
  return {
    displayName: match?.[1]?.trim() || null,
    handle: normalizeHandle(match?.[2]),
  };
}

function substackProfileSlug(url: string): { author_profile_slug?: string } {
  try {
    const slug = new URL(url).pathname.match(/\/profile\/([^/]+)\/note\//)?.[1];
    return slug ? { author_profile_slug: slug } : {};
  } catch {
    return {};
  }
}
