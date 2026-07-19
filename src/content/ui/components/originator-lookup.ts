import type { OriginatorSearchResult } from '../../../types/api';
import type { DuplicateCheckResult } from '../../../types/api';
import { getWebBaseUrl } from '../../../config/environment';
import type { CapturePlatform } from '../../../types';
import { safeHref } from './dom-utils';

type MessageSender = (message: { type: string; data?: unknown }) => Promise<Record<string, unknown>>;

export interface LookupOutcome {
  status: 'found' | 'not_found' | 'error';
  originator?: OriginatorSearchResult;
  createUrl?: string;
  errorMessage?: string;
  /** Preloaded duplicate check data passthrough for the caller */
  preloadedDuplicateCheck?: { url: string; result: DuplicateCheckResult; timestamp: number; preflightMs?: number };
  originatorRttMs?: number;
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

  async lookup(
    handle: string,
    currentUrl?: string,
    platform: CapturePlatform = 'twitter',
    forceRefresh = false,
  ): Promise<LookupOutcome> {
    const normalizedHandle = handle.toLowerCase();
    const cacheKey = `${platform}:${normalizedHandle}`;

    // 1. Check in-memory cache (only successful lookups are cached)
    const cached = forceRefresh ? undefined : this.cache.get(cacheKey);
    if (cached) {
      this.notifyLookupStatus(handle, currentUrl, platform, true);
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

      const preloadedHandleMatches = preloaded?.handle === normalizedHandle || preloaded?.handle === cacheKey;
      const preloadedPlatformMatches = !preloaded?.platform || preloaded.platform === platform;
      if (
        !forceRefresh &&
        preloaded &&
        preloadedHandleMatches &&
        preloadedPlatformMatches &&
        (Date.now() - preloaded.timestamp) < 60000
      ) {
        if (preloaded.originator) {
          const originator = this.normalizeOriginator(preloaded.originator);
          if (!originator) {
            throw new Error('Preloaded originator is missing a slug');
          }

          this.cache.set(cacheKey, originator);
          this.notifyLookupStatus(handle, currentUrl, platform, true);
          this.renderFound(originator, handle, false);
          return {
            status: 'found',
            originator,
            preloadedDuplicateCheck: storage.preloadedDuplicateCheck,
          };
        }
        // Preloaded not-found
        const createUrl = this.resolveCreateUrl(handle, platform, preloaded.create_url);
        this.notifyLookupStatus(handle, currentUrl, platform, false, createUrl);
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
        data: { handle, platform, source_url: currentUrl }
      });

      if (response.success && response.found && response.originator) {
        const originator = this.normalizeOriginator(response.originator);
        if (!originator) {
          // Only reached if the originator has no usable reference (unique_id/slug) or no name —
          // a genuinely unusable record. (The old "missing a slug" was misfiring on a missing
          // numeric id, which capture doesn't need; normalizeOriginator no longer requires it.)
          throw new Error('Resolved originator is missing a usable identifier');
        }

        this.cache.set(cacheKey, originator);
        this.renderFound(originator, handle, false);
        return {
          status: 'found',
          originator,
          originatorRttMs: typeof response.client_rtt_ms === 'number' ? response.client_rtt_ms : undefined,
        };
      }

      if (response.success && !response.found) {
        const createUrl = this.resolveCreateUrl(handle, platform, response.create_url);
        this.renderNotFound(handle, createUrl);
        return {
          status: 'not_found',
          createUrl,
          originatorRttMs: typeof response.client_rtt_ms === 'number' ? response.client_rtt_ms : undefined,
        };
      }

      throw new Error((response.error as string) || 'Lookup failed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.renderError(errorMessage);
      return { status: 'error', errorMessage };
    }
  }

  private notifyLookupStatus(
    handle: string,
    currentUrl: string | undefined,
    platform: CapturePlatform,
    found: boolean,
    createUrl?: string
  ): void {
    if (!currentUrl) {
      return;
    }

    void this.sendMessage({
      type: 'ORIGINATOR_LOOKUP_STATUS',
      data: {
        handle,
        platform,
        source_url: currentUrl,
        found,
        ...(createUrl ? { create_url: createUrl } : {}),
      },
    }).catch(() => undefined);
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
      `<span class="badge warning">@</span>` +
      ` <span>No originator found for @${this.escapeHtml(handle)}</span>` +
      createLink;
  }

  private renderError(message: string): void {
    this.container.innerHTML =
      `<span class="badge error">!</span>` +
      ` <span>Lookup failed: ${this.escapeHtml(message)}</span>`;
  }

  private normalizeOriginator(value: unknown): OriginatorSearchResult | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const originator = value as {
      id?: unknown;
      unique_id?: unknown;
      slug?: unknown;
      full_name?: unknown;
      sort_name_display?: unknown;
      confidence?: unknown;
    };
    const uniqueId = typeof originator.unique_id === 'string' && originator.unique_id
      ? originator.unique_id
      : typeof originator.slug === 'string' && originator.slug
        ? originator.slug
        : undefined;

    // `id` is NOT required: /v1/originators/by-handle/ omits the numeric id, and capture references
    // originators by unique_id/slug. Reject only when there's no usable reference or no name.
    if (typeof originator.full_name !== 'string' || !uniqueId) {
      return null;
    }

    if (
      typeof originator.unique_id === 'string' &&
      typeof originator.sort_name_display === 'string' &&
      (typeof originator.confidence === 'number' || originator.confidence === null)
    ) {
      return value as OriginatorSearchResult;
    }

    return {
      id: typeof originator.id === 'number' ? originator.id : undefined,
      unique_id: uniqueId,
      full_name: originator.full_name,
      sort_name_display: typeof originator.sort_name_display === 'string'
        ? originator.sort_name_display
        : originator.full_name,
      confidence: typeof originator.confidence === 'number' ? originator.confidence : null,
    };
  }

  private resolveCreateUrl(handle: string, platform: CapturePlatform, createUrl: unknown): string {
    const baseUrl = getWebBaseUrl().replace(/\/+$/, '');
    const fallback = `${baseUrl}/originators/add/?suggested_handle=${encodeURIComponent(handle)}&platform=${encodeURIComponent(platform)}`;

    // Only trust an API-provided create URL if it is a real http(s) link;
    // escapeHtml in renderNotFound stops attribute-breakout but not a
    // javascript: scheme. Fall back to our own constructed URL otherwise.
    if (typeof createUrl === 'string' && createUrl) {
      return safeHref(createUrl) ?? fallback;
    }

    return fallback;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
