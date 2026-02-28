import type { OriginatorSearchResult } from '../../../types/api';
import type { DuplicateCheckResult } from '../../../types/api';

type MessageSender = (message: { type: string; data?: unknown }) => Promise<Record<string, unknown>>;

export interface LookupOutcome {
  status: 'found' | 'not_found' | 'error';
  originator?: OriginatorSearchResult;
  createUrl?: string;
  errorMessage?: string;
  /** Preloaded duplicate check data passthrough for the caller */
  preloadedDuplicateCheck?: { url: string; result: DuplicateCheckResult; timestamp: number };
}

/**
 * Handles originator lookup by Twitter handle with:
 * - In-memory session cache (found results only)
 * - Preloaded data from chrome.storage.local
 * - API fallback via sendMessage
 * - Renders loading/found/not-found/error states into its container
 */
export class OriginatorLookup {
  private cache = new Map<string, OriginatorSearchResult>();

  constructor(
    private container: HTMLElement,
    private sendMessage: MessageSender
  ) {}

  async lookup(handle: string, currentUrl?: string): Promise<LookupOutcome> {
    const cacheKey = handle.toLowerCase();

    // 1. Check in-memory cache (only successful lookups are cached)
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.renderFound(cached, handle, true);
      // Try to get preloaded duplicate data for passthrough
      let preloadedDuplicateCheck: LookupOutcome['preloadedDuplicateCheck'];
      try {
        const storage = await chrome.storage.local.get(['preloadedDuplicateCheck']);
        if (storage.preloadedDuplicateCheck) {
          preloadedDuplicateCheck = storage.preloadedDuplicateCheck;
        }
      } catch {
        // Ignore
      }
      return { status: 'found', originator: cached, preloadedDuplicateCheck };
    }

    // 2. Check preloaded data from service worker
    try {
      const storage = await chrome.storage.local.get(['preloadedOriginator', 'preloadedDuplicateCheck']);
      const preloaded = storage.preloadedOriginator;

      if (preloaded && preloaded.handle === cacheKey && (Date.now() - preloaded.timestamp) < 60000) {
        if (preloaded.originator) {
          this.cache.set(cacheKey, preloaded.originator);
          this.renderFound(preloaded.originator, handle, false);
          return {
            status: 'found',
            originator: preloaded.originator,
            preloadedDuplicateCheck: storage.preloadedDuplicateCheck,
          };
        }
        // Preloaded not-found
        const createUrl = preloaded.create_url || undefined;
        this.renderNotFound(handle, createUrl);
        return { status: 'not_found', createUrl };
      }
    } catch {
      // Fall through to API lookup
    }

    // 3. Show loading state and call API
    this.renderLoading(handle);

    try {
      const response = await this.sendMessage({
        type: 'LOOKUP_ORIGINATOR_BY_HANDLE',
        data: { handle, platform: 'twitter' }
      });

      if (response.success && response.found && response.originator) {
        const originator = response.originator as OriginatorSearchResult;
        this.cache.set(cacheKey, originator);
        this.renderFound(originator, handle, false);
        return { status: 'found', originator };
      }

      if (response.success && !response.found) {
        const createUrl = (response.create_url as string) || undefined;
        this.renderNotFound(handle, createUrl);
        return { status: 'not_found', createUrl };
      }

      throw new Error((response.error as string) || 'Lookup failed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.renderError(errorMessage);
      return { status: 'error', errorMessage };
    }
  }

  /**
   * Set arbitrary HTML on the container (for post-submit status messages)
   */
  setHtml(html: string): void {
    this.container.innerHTML = html;
  }

  private renderLoading(handle: string): void {
    this.container.innerHTML =
      `<div class="spinner"></div> Looking up @${this.escapeHtml(handle)}...`;
  }

  private renderFound(originator: OriginatorSearchResult, handle: string, fromCache: boolean): void {
    const cacheTag = fromCache ? ' <span class="cache-indicator">(cached)</span>' : '';
    this.container.innerHTML =
      `<span class="badge success">✓</span>` +
      ` <span class="originator-name">${this.escapeHtml(originator.full_name)}</span>` +
      ` <span class="originator-handle">@${this.escapeHtml(handle)}</span>` +
      cacheTag;
  }

  private renderNotFound(handle: string, createUrl?: string): void {
    const createLink = createUrl
      ? ` <a href="${this.escapeHtml(createUrl)}" target="_blank" rel="noopener" class="create-link">Create on Quotewise</a>`
      : '';
    this.container.innerHTML =
      `<span class="badge warning">?</span>` +
      ` <span>No originator found for @${this.escapeHtml(handle)}</span>` +
      createLink;
  }

  private renderError(message: string): void {
    this.container.innerHTML =
      `<span class="badge error">!</span>` +
      ` <span>Lookup failed: ${this.escapeHtml(message)}</span>`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
