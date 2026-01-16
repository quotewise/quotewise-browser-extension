import type { TwitterData } from '../../types';
import { MessageType } from '../../types';
import type { DuplicateCheckResult, OriginatorSearchResult } from '../../types/api';

type DataProvider = () => Promise<TwitterData | null>;

/**
 * Session cache for successful originator lookups by handle
 * Only caches found originators - IDs don't change so cache for life of session
 * Not-found results are not cached so we re-check in case user creates the originator
 */
const originatorCache = new Map<string, OriginatorSearchResult>();

interface CaptureState {
  expanded: boolean;
  isLookingUp: boolean;
  lookupResult: 'found' | 'not_found' | 'error' | null;
  originator: OriginatorSearchResult | null;
  createUrl: string | null;
  isSubmitting: boolean;
  submitResult: 'success' | 'error' | null;
  errorMessage: string | null;
  selectedText: string | null; // User-selected portion of tweet text
  // Duplicate check state (informational only, doesn't block submit)
  isCheckingDuplicate: boolean;
  duplicateResult: DuplicateCheckResult | null;
}

/**
 * Overlay bar UI for tweet capture
 * Design:
 * - Row 1: Tweet preview with metadata chips and control buttons
 * - Row 2 (expandable): Originator lookup/selection and submit
 */
export class OverlayBar {
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private hidden = false;
  private dataProvider: DataProvider;
  private currentPlatformLabel = 'Twitter';
  private currentData: TwitterData | null = null;
  private captureState: CaptureState = {
    expanded: false,
    isLookingUp: false,
    lookupResult: null,
    originator: null,
    createUrl: null,
    isSubmitting: false,
    submitResult: null,
    errorMessage: null,
    selectedText: null,
    isCheckingDuplicate: false,
    duplicateResult: null
  };

  constructor(dataProvider: DataProvider) {
    this.dataProvider = dataProvider;
  }

  show(platformLabel: string): void {
    this.currentPlatformLabel = platformLabel;
    this.hidden = false;
    if (!this.root) {
      this.mount();
    }
    if (this.root) {
      this.root.setAttribute('aria-hidden', 'false');
    }
    if (this.shadow) {
      const container = this.shadow.querySelector('.container');
      container?.setAttribute('aria-hidden', 'false');
    }
    // Auto-expand capture when showing (user clicked icon = they want to capture)
    this.refresh().then(() => {
      if (this.currentData) {
        this.expandCapture();
      }
    });
  }

  hide(): void {
    this.hidden = true;
    this.collapseCapture();
    if (this.root) {
      this.root.setAttribute('aria-hidden', 'true');
    }
    if (this.shadow) {
      const container = this.shadow.querySelector('.container');
      container?.setAttribute('aria-hidden', 'true');
    }
  }

  async refresh(): Promise<void> {
    if (!this.shadow) return;
    const data = await this.dataProvider();
    this.currentData = data;
    this.render(data);
  }

  private mount(): void {
    this.root = document.createElement('div');
    this.root.id = 'qw-overlay-bar-root';
    this.root.style.position = 'fixed';
    this.root.style.top = '0';
    this.root.style.left = '0';
    this.root.style.right = '0';
    this.root.style.zIndex = '2147483647';
    this.root.style.pointerEvents = 'none';
    document.documentElement.appendChild(this.root);

    this.shadow = this.root.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = this.buildBaseMarkup();

    this.wireInteractions();
    this.refresh();
  }

  private buildBaseMarkup(): string {
    return `
      <style>
        :host { all: initial; }
        .container {
          pointer-events: auto;
          transform: translateY(0);
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        .container[aria-hidden="true"] {
          transform: translateY(-100%);
          opacity: 0.6;
        }
        .bar, .capture-row {
          box-sizing: border-box;
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          background: #0f172a;
          color: #e2e8f0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          line-height: 18px;
        }
        .bar {
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .capture-row {
          background: #1e293b;
          border-bottom: 1px solid rgba(255,255,255,0.12);
          display: none;
          padding: 0;
        }
        .capture-row.expanded {
          display: block;
        }
        .capture-row-content {
          display: flex;
          flex-direction: column;
        }
        .quote-preview-row, .originator-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
        }
        .quote-preview-row {
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .quote-preview {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }
        .quote-text {
          color: #94a3b8;
          font-style: italic;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .clear-selection {
          background: rgba(239,68,68,0.2);
          color: #f87171;
          border: none;
          border-radius: 4px;
          padding: 2px 6px;
          cursor: pointer;
          font-size: 11px;
          flex-shrink: 0;
        }
        .clear-selection:hover {
          background: rgba(239,68,68,0.3);
        }
        .section {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .left { flex: 0 0 auto; }
        .center {
          flex: 1 1 auto;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 16px;
          min-width: 0;
        }
        .right { flex: 0 0 auto; gap: 6px; }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(255,255,255,0.1);
          color: #e2e8f0;
          font-weight: 600;
          white-space: nowrap;
        }
        .badge.protected { background: rgba(234,179,8,0.15); color: #facc15; }
        .badge.success { background: rgba(34,197,94,0.2); color: #4ade80; }
        .badge.warning { background: rgba(251,146,60,0.2); color: #fb923c; }
        .badge.error { background: rgba(239,68,68,0.2); color: #f87171; }
        .badge.info { background: rgba(59,130,246,0.2); color: #60a5fa; }
        .text {
          min-width: 0;
          white-space: pre-line;
          max-height: calc(1.35em * 8);
          overflow-y: auto;
          overflow-x: hidden;
        }
        .meta-row {
          flex: 2 1 0%;
          display: flex;
          flex-wrap: nowrap;
          gap: 8px;
          font-size: 12px;
          color: #cbd5e1;
          justify-content: flex-end;
          min-width: 0;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 6px;
          border-radius: 6px;
          background: rgba(255,255,255,0.08);
          white-space: nowrap;
        }
        .chip .icon { opacity: 0.8; }
        button {
          border: none;
          border-radius: 6px;
          padding: 6px 10px;
          background: rgba(255,255,255,0.12);
          color: #e2e8f0;
          cursor: pointer;
          font-size: 12px;
          line-height: 16px;
        }
        button:hover:not(:disabled) { background: rgba(255,255,255,0.18); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.primary { background: #2563eb; color: #fff; }
        button.primary:hover:not(:disabled) { background: #1d4ed8; }
        button.success { background: #16a34a; color: #fff; }
        button.success:hover:not(:disabled) { background: #15803d; }
        button.warning { background: #ea580c; color: #fff; }
        button.warning:hover:not(:disabled) { background: #c2410c; }
        .toggle {
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.12);
          color: #e2e8f0;
        }
        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .originator-info {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
        }
        .originator-name {
          font-weight: 500;
          color: #e2e8f0;
        }
        .originator-handle {
          color: #94a3b8;
          font-size: 12px;
        }
        .cache-indicator {
          color: #64748b;
          font-size: 11px;
          font-style: italic;
        }
        a.create-link {
          color: #fb923c;
          text-decoration: none;
        }
        a.create-link:hover {
          text-decoration: underline;
        }
        .status-text {
          color: #94a3b8;
          font-size: 12px;
        }
      </style>
      <div class="container" aria-hidden="false">
        <div class="bar">
          <div class="section left">
            <div class="badge" id="platform-badge">${this.currentPlatformLabel}</div>
            <div class="badge protected" id="protected-badge" style="display:none;">Protected</div>
          </div>
          <div class="section center">
            <div class="text" id="tweet-preview">Collecting tweet data…</div>
            <div class="meta-row" id="meta-row"></div>
          </div>
          <div class="section right">
            <button id="refresh-btn">Refresh</button>
            <button class="toggle" id="close-btn" aria-label="Close bar">×</button>
          </div>
        </div>
        <div class="capture-row" id="capture-row">
          <div class="capture-row-content">
            <div class="quote-preview-row">
              <div class="section left">
                <div class="badge info">Quote</div>
              </div>
              <div class="section center">
                <div class="quote-preview" id="quote-preview"></div>
              </div>
            </div>
            <div class="originator-row">
              <div class="section left">
                <div class="badge info">Originator</div>
              </div>
              <div class="section center">
                <div class="originator-info" id="originator-info">
                  <span class="status-text">Looking up originator...</span>
                </div>
              </div>
              <div class="section right">
                <button class="success" id="submit-btn" disabled>Submit Quote</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  render(data: TwitterData | null): void {
    if (!this.shadow) return;
    const previewEl = this.shadow.getElementById('tweet-preview');
    const protectedBadge = this.shadow.getElementById('protected-badge');
    const platformBadge = this.shadow.getElementById('platform-badge');
    const metaRow = this.shadow.getElementById('meta-row');
    if (platformBadge) {
      platformBadge.textContent = this.currentPlatformLabel;
    }

    if (!previewEl) return;
    if (!data) {
      previewEl.textContent = 'No tweet detected on this page.';
      if (protectedBadge) protectedBadge.setAttribute('style', 'display:none;');
      if (metaRow) metaRow.innerHTML = '';
      return;
    }

    const protectedText = data.isProtected || data.platform_data?.is_protected;
    if (protectedBadge) {
      protectedBadge.setAttribute('style', protectedText ? '' : 'display:none;');
    }

    const snippet = (data.text || '').trim();
    previewEl.textContent = snippet || 'Tweet text unavailable';

    if (metaRow) {
      metaRow.innerHTML = this.buildMetaChips(data);
    }
  }

  private buildMetaChips(data: TwitterData): string {
    const chips: string[] = [];

    if (data.author?.username) {
      chips.push(`<span class="chip"><span class="icon">@</span>${this.escapeHtml(data.author.username)}</span>`);
    }

    if (data.date) {
      const date = new Date(data.date);
      const dateText = isNaN(date.getTime()) ? data.date : date.toLocaleString();
      chips.push(`<span class="chip"><span class="icon">🗓</span>${this.escapeHtml(dateText)}</span>`);
    }

    const metricChip = (icon: string, val?: number) =>
      typeof val === 'number' && !isNaN(val) ? `<span class="chip"><span class="icon">${icon}</span>${val}</span>` : '';

    chips.push(metricChip('💬', data.replies));
    chips.push(metricChip('🔁', data.retweets));
    chips.push(metricChip('❤️', data.likes));
    chips.push(metricChip('👁', data.views));
    chips.push(metricChip('🔖', data.bookmarks));

    return chips.filter(Boolean).join('');
  }

  private wireInteractions(): void {
    if (!this.shadow) return;
    const refreshBtn = this.shadow.getElementById('refresh-btn');
    const closeBtn = this.shadow.getElementById('close-btn');
    const submitBtn = this.shadow.getElementById('submit-btn');

    refreshBtn?.addEventListener('click', () => this.refresh());
    closeBtn?.addEventListener('click', () => this.hide());
    submitBtn?.addEventListener('click', () => this.submitQuote());
  }

  private async expandCapture(): Promise<void> {
    if (!this.shadow || !this.currentData) return;

    // Check authentication FIRST before doing any API calls
    const authStatus = await this.checkAuthStatus();
    if (!authStatus.isAuthenticated) {
      this.showLoginRequired();
      return;
    }

    // Check for text selection on the page before expanding
    const selectedText = this.getPageSelection();
    this.captureState.selectedText = selectedText;

    const captureRow = this.shadow.getElementById('capture-row');
    captureRow?.classList.add('expanded');
    this.captureState.expanded = true;

    // Update the quote preview to show selected text if any
    this.updateQuotePreview();

    // Start originator lookup by handle
    const handle = this.currentData.author?.username;
    if (handle) {
      await this.lookupOriginator(handle);
    } else {
      this.updateOriginatorInfo('No author handle available', 'error');
    }
  }

  /**
   * Check if user is authenticated via service worker
   */
  private async checkAuthStatus(): Promise<{ isAuthenticated: boolean }> {
    try {
      const response = await this.sendMessage({ type: MessageType.CHECK_AUTH_STATUS });
      return { isAuthenticated: response.isAuthenticated === true };
    } catch {
      return { isAuthenticated: false };
    }
  }

  /**
   * Show login required message with button to open popup for OAuth flow
   */
  private showLoginRequired(): void {
    const captureRow = this.shadow?.getElementById('capture-row');
    captureRow?.classList.add('expanded');
    this.captureState.expanded = true;

    // Update quote preview to show the captured text
    this.updateQuotePreview();

    // Show login message in originator section
    const originatorInfo = this.shadow?.getElementById('originator-info');
    if (originatorInfo) {
      originatorInfo.innerHTML = `
        <span class="badge warning">!</span>
        <span>Login required to capture quotes</span>
        <button class="primary" id="login-btn">Login to Quotewise</button>
      `;

      // Wire up login button to open popup (which has the OAuth flow)
      const loginBtn = this.shadow?.getElementById('login-btn');
      loginBtn?.addEventListener('click', () => {
        this.sendMessage({ type: MessageType.OPEN_POPUP }).catch(() => {
          // Fallback: open quotewise.io in new tab if popup fails
          window.open('https://quotewise.io/login/', '_blank');
        });
      });
    }

    // Disable submit button when not authenticated
    this.updateSubmitButton(false);
  }

  /**
   * Get selected text from the page (if within tweet content)
   */
  private getPageSelection(): string | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;

    const selectedText = selection.toString().trim();
    if (!selectedText) return null;

    // Verify the selection is part of the tweet text
    if (this.currentData?.text && this.currentData.text.includes(selectedText)) {
      return selectedText;
    }

    // Selection might not be exact match due to formatting, but if it's reasonable length, use it
    if (selectedText.length >= 10 && selectedText.length <= (this.currentData?.text?.length || 0)) {
      return selectedText;
    }

    return null;
  }

  /**
   * Update the quote preview in capture row to show what will be submitted
   */
  private updateQuotePreview(): void {
    const quotePreviewEl = this.shadow?.getElementById('quote-preview');
    if (!quotePreviewEl) return;

    const textToSubmit = this.captureState.selectedText || this.currentData?.text || '';
    const isPartial = !!this.captureState.selectedText;

    if (isPartial) {
      quotePreviewEl.innerHTML = `
        <span class="badge info">Selection</span>
        <span class="quote-text">"${this.escapeHtml(textToSubmit)}"</span>
        <button class="clear-selection" id="clear-selection-btn" title="Use full tweet">✕</button>
      `;
      // Wire up clear button
      const clearBtn = this.shadow?.getElementById('clear-selection-btn');
      clearBtn?.addEventListener('click', () => {
        this.captureState.selectedText = null;
        this.updateQuotePreview();
      });
    } else {
      const preview = textToSubmit.length > 100
        ? textToSubmit.substring(0, 100) + '...'
        : textToSubmit;
      quotePreviewEl.innerHTML = `<span class="quote-text">"${this.escapeHtml(preview)}"</span>`;
    }
  }

  /**
   * Update quote preview to show success state (preserves Selection label if applicable)
   */
  private updateQuotePreviewSuccess(): void {
    const quotePreviewEl = this.shadow?.getElementById('quote-preview');
    if (!quotePreviewEl) return;

    const textSubmitted = this.captureState.selectedText || this.currentData?.text || '';
    const isPartial = !!this.captureState.selectedText;
    const preview = textSubmitted.length > 80
      ? textSubmitted.substring(0, 80) + '...'
      : textSubmitted;

    if (isPartial) {
      quotePreviewEl.innerHTML = `
        <span class="badge info">Selection</span>
        <span class="badge success">✓ Submitted</span>
        <span class="quote-text">"${this.escapeHtml(preview)}"</span>
      `;
    } else {
      quotePreviewEl.innerHTML = `
        <span class="badge success">✓ Submitted</span>
        <span class="quote-text">"${this.escapeHtml(preview)}"</span>
      `;
    }
  }

  private collapseCapture(): void {
    if (!this.shadow) return;

    const captureRow = this.shadow.getElementById('capture-row');
    captureRow?.classList.remove('expanded');

    this.captureState = {
      expanded: false,
      isLookingUp: false,
      lookupResult: null,
      originator: null,
      createUrl: null,
      isSubmitting: false,
      submitResult: null,
      errorMessage: null,
      selectedText: null,
      isCheckingDuplicate: false,
      duplicateResult: null
    };

    this.updateOriginatorInfo('Looking up originator...', 'status');
    this.updateSubmitButton(false);
    this.updateDuplicateInfo(null);
  }

  private async lookupOriginator(handle: string): Promise<void> {
    const cacheKey = handle.toLowerCase();

    // Check in-memory cache first - only successful lookups are cached
    const cached = originatorCache.get(cacheKey);
    if (cached) {
      this.captureState.lookupResult = 'found';
      this.captureState.originator = cached;
      this.updateOriginatorInfo(
        `<span class="badge success">✓</span>
         <span class="originator-name">${this.escapeHtml(cached.full_name)}</span>
         <span class="originator-handle">@${this.escapeHtml(handle)}</span>
         <span class="cache-indicator">(cached)</span>`,
        'found'
      );
      this.updateSubmitButton(true);
      // Check for preloaded duplicate data before making API call
      try {
        const storage = await chrome.storage.local.get(['preloadedDuplicateCheck']);
        this.checkDuplicateWithPreload(cached.id, storage.preloadedDuplicateCheck);
      } catch {
        this.checkDuplicate(cached.id);
      }
      return;
    }

    // Check for preloaded originator data from service worker
    try {
      const storage = await chrome.storage.local.get(['preloadedOriginator', 'preloadedDuplicateCheck']);
      const preloaded = storage.preloadedOriginator;

      if (preloaded && preloaded.handle === cacheKey && (Date.now() - preloaded.timestamp) < 60000) {
        if (preloaded.originator) {
          // Preloaded found result
          originatorCache.set(cacheKey, preloaded.originator);
          this.captureState.lookupResult = 'found';
          this.captureState.originator = preloaded.originator;
          this.updateOriginatorInfo(
            `<span class="badge success">✓</span>
             <span class="originator-name">${this.escapeHtml(preloaded.originator.full_name)}</span>
             <span class="originator-handle">@${this.escapeHtml(handle)}</span>`,
            'found'
          );
          this.updateSubmitButton(true);
          // Check for preloaded duplicate result too
          this.checkDuplicateWithPreload(preloaded.originator.id, storage.preloadedDuplicateCheck);
          return;
        } else {
          // Preloaded not-found result
          this.captureState.lookupResult = 'not_found';
          this.captureState.createUrl = preloaded.create_url || null;
          const createLink = preloaded.create_url
            ? `<a href="${this.escapeHtml(preloaded.create_url)}" target="_blank" rel="noopener" class="create-link">Create on Quotosaurus</a>`
            : '';
          this.updateOriginatorInfo(
            `<span class="badge warning">?</span>
             <span>No originator found for @${this.escapeHtml(handle)}</span>
             ${createLink}`,
            'not_found'
          );
          this.updateSubmitButton(false);
          return;
        }
      }
    } catch {
      // Preload check failed, fall through to normal lookup
    }

    this.captureState.isLookingUp = true;
    this.updateOriginatorInfo(`<div class="spinner"></div> Looking up @${this.escapeHtml(handle)}...`, 'loading');

    try {
      const response = await this.sendMessage({
        type: MessageType.LOOKUP_ORIGINATOR_BY_HANDLE,
        data: { handle, platform: 'twitter' }
      });

      if (response.success && response.found && response.originator) {
        // Cache successful lookups for life of session
        originatorCache.set(cacheKey, response.originator);

        this.captureState.lookupResult = 'found';
        this.captureState.originator = response.originator;
        this.updateOriginatorInfo(
          `<span class="badge success">✓</span>
           <span class="originator-name">${this.escapeHtml(response.originator.full_name)}</span>
           <span class="originator-handle">@${this.escapeHtml(handle)}</span>`,
          'found'
        );
        this.updateSubmitButton(true);
        // Start duplicate check in background (non-blocking)
        this.checkDuplicate(response.originator.id);
      } else if (response.success && !response.found) {
        // Don't cache not-found - user might create the originator
        this.captureState.lookupResult = 'not_found';
        this.captureState.createUrl = response.create_url || null;
        const createLink = response.create_url
          ? `<a href="${this.escapeHtml(response.create_url)}" target="_blank" rel="noopener" class="create-link">Create on Quotosaurus</a>`
          : '';
        this.updateOriginatorInfo(
          `<span class="badge warning">?</span>
           <span>No originator found for @${this.escapeHtml(handle)}</span>
           ${createLink}`,
          'not_found'
        );
        this.updateSubmitButton(false);
      } else {
        throw new Error(response.error || 'Lookup failed');
      }
    } catch (error) {
      this.captureState.lookupResult = 'error';
      this.captureState.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.updateOriginatorInfo(
        `<span class="badge error">!</span>
         <span>Lookup failed: ${this.escapeHtml(this.captureState.errorMessage || '')}</span>`,
        'error'
      );
      this.updateSubmitButton(false);
    } finally {
      this.captureState.isLookingUp = false;
    }
  }

  /**
   * Check for duplicates, using preloaded data if available and fresh
   */
  private checkDuplicateWithPreload(
    originatorId: number,
    preloadedDuplicateCheck?: { url: string; result: unknown; timestamp: number }
  ): void {
    // Check if preloaded duplicate check is fresh and for the right URL
    if (
      preloadedDuplicateCheck &&
      preloadedDuplicateCheck.url === this.currentData?.url &&
      (Date.now() - preloadedDuplicateCheck.timestamp) < 60000
    ) {
      // Use preloaded result - no spinner needed since data is instant
      const result = preloadedDuplicateCheck.result as DuplicateCheckResult;
      this.captureState.isCheckingDuplicate = false;
      this.captureState.duplicateResult = result;
      this.updateDuplicateInfo({ result });
    } else {
      // Fall back to fresh check (preload not ready or stale)
      this.checkDuplicate(originatorId);
    }
  }

  private async submitQuote(): Promise<void> {
    if (!this.currentData || !this.captureState.originator) return;

    this.captureState.isSubmitting = true;
    this.updateSubmitButton(false, 'Submitting...');

    // Use selected text if available, otherwise full tweet text
    const quoteText = this.captureState.selectedText || this.currentData.text;

    try {
      const response = await this.sendMessage({
        type: MessageType.SUBMIT_QUOTE,
        data: {
          text: quoteText,
          originator_id: this.captureState.originator.id,
          source_url: this.currentData.url,
          platform_code: 'TX',
          likes_count: this.currentData.likes || 0,
          quote_date: this.currentData.date || undefined,
          attribution_type: 'DIRECT',
          platform_data: this.currentData.platform_data
        }
      });

      if (response.success) {
        this.captureState.submitResult = 'success';
        this.captureState.isCheckingDuplicate = false;
        this.captureState.duplicateResult = null;

        // Update quote preview to show success
        this.updateQuotePreviewSuccess();

        // Clear duplicate badge and show success in originator row
        this.updateDuplicateInfo(null);
        this.updateOriginatorInfo(
          `<span class="badge success">✓</span>
           <span>Quote added successfully!</span>`,
          'success'
        );
        this.updateSubmitButton(false, 'Done!');

        // Update badge based on whether quote was added to a collection
        // TODO: Once collection selector is added to overlay, update badge based on user's choice
        // For now, show 'exists_not_collected' since we're not adding to collections yet
        this.sendMessage({
          type: MessageType.UPDATE_COLLECTION_BADGE,
          data: {
            state: 'exists_not_collected',
            quoteText: quoteText
          }
        }).catch(() => {
          // Badge update is non-critical
        });

        // Auto-hide after success
        setTimeout(() => this.hide(), 1500);
      } else {
        throw new Error(response.error || response.message || 'Submission failed');
      }
    } catch (error) {
      this.captureState.submitResult = 'error';
      this.captureState.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.updateOriginatorInfo(
        `<span class="badge error">!</span>
         <span>Submit failed: ${this.escapeHtml(this.captureState.errorMessage || '')}</span>`,
        'error'
      );
      this.updateSubmitButton(true, 'Retry');
    } finally {
      this.captureState.isSubmitting = false;
    }
  }

  private updateOriginatorInfo(html: string, _type: string): void {
    const infoEl = this.shadow?.getElementById('originator-info');
    if (infoEl) {
      infoEl.innerHTML = html;
    }
  }

  private updateSubmitButton(enabled: boolean, text?: string): void {
    const submitBtn = this.shadow?.getElementById('submit-btn') as HTMLButtonElement | null;
    if (submitBtn) {
      submitBtn.disabled = !enabled;
      if (text) {
        submitBtn.textContent = text;
      } else {
        submitBtn.textContent = 'Submit Quote';
      }
    }
  }

  /**
   * Check for duplicate quotes in background (non-blocking, informational only)
   */
  private async checkDuplicate(originatorId: number): Promise<void> {
    if (!this.currentData?.text) return;

    this.captureState.isCheckingDuplicate = true;
    this.captureState.duplicateResult = null;
    this.updateDuplicateInfo({ checking: true });

    const quoteText = this.captureState.selectedText || this.currentData.text;

    try {
      const response = await this.sendMessage({
        type: MessageType.CHECK_DUPLICATE,
        data: {
          text: quoteText,
          originator_id: originatorId,
          source_url: this.currentData.url,
          social_handle: this.currentData.author?.username
        }
      });

      if (response.success && response.result) {
        this.captureState.duplicateResult = response.result as DuplicateCheckResult;
        this.updateDuplicateInfo({ result: this.captureState.duplicateResult });
      } else {
        // Clear spinner even if no result
        this.updateDuplicateInfo(null);
      }
    } catch (error) {
      // Silently fail - duplicate check is informational only
      console.warn('Duplicate check failed:', error);
      this.updateDuplicateInfo(null);
    } finally {
      this.captureState.isCheckingDuplicate = false;
    }
  }

  /**
   * Update duplicate info display (informational badge in quote preview row)
   */
  private updateDuplicateInfo(state: { checking: true } | { result: DuplicateCheckResult } | null): void {
    const quotePreviewRow = this.shadow?.querySelector('.quote-preview-row');
    if (!quotePreviewRow) return;

    // Remove existing duplicate badge if any
    const existingBadge = quotePreviewRow.querySelector('.duplicate-badge');
    existingBadge?.remove();

    if (!state) return;

    const badge = document.createElement('span');
    badge.className = 'duplicate-badge';

    if ('checking' in state) {
      badge.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div>';
      badge.title = 'Checking for duplicates...';
    } else {
      const { result } = state;
      if (result.recommendation === 'duplicate') {
        badge.className += ' badge warning';
        badge.innerHTML = '⚠️ Duplicate';
        badge.title = result.reasoning || 'This quote may already exist';
      } else if (result.recommendation === 'new_version') {
        badge.className += ' badge info';
        badge.innerHTML = 'ℹ️ New version';
        badge.title = result.reasoning || 'Similar quote exists - will create new version';
      } else if (result.in_quotosaurus) {
        badge.className += ' badge success';
        badge.innerHTML = '✓ In Quotosaurus';
        badge.title = 'Quote already in collection';
      }
      // Don't show badge for new_quote - that's the expected case
    }

    if (badge.innerHTML) {
      badge.style.marginLeft = '8px';
      quotePreviewRow.querySelector('.section.center')?.appendChild(badge);
    }
  }

  private sendMessage(message: { type: MessageType; data?: unknown }): Promise<{
    success: boolean;
    found?: boolean;
    originator?: OriginatorSearchResult;
    create_url?: string;
    error?: string;
    message?: string;
    result?: DuplicateCheckResult;
    isAuthenticated?: boolean;
  }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
      });
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
