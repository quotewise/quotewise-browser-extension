import type { TwitterData } from '../../types';
import { MessageType } from '../../types';
import type { DuplicateCheckResult, OriginatorSearchResult } from '../../types/api';
import { AuthState } from '../../auth/auth-state-machine';
import type { AuthStateData } from '../../auth/auth-state-machine';
import { DuplicateBadge } from './components/duplicate-badge';
import type { SubmitStateDirective } from './components/duplicate-badge';
import { QuotePreview } from './components/quote-preview';
import { OriginatorLookup } from './components/originator-lookup';
import { ActionButton } from './components/action-button';
import { classifyDuplicateSighting } from '../../utils/duplicate-status';

type DataProvider = () => Promise<TwitterData | null>;

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
  private duplicateBadge: DuplicateBadge | null = null;
  private duplicateBadgeContainer: HTMLElement | null = null;
  private quotePreview: QuotePreview | null = null;
  private originatorLookup: OriginatorLookup | null = null;
  private actionButton: ActionButton | null = null;
  private selectionChangeHandler: (() => void) | null = null;
  private selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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
                <!-- Action button inserted dynamically by updateActionButton() -->
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

    refreshBtn?.addEventListener('click', () => this.refresh());
    closeBtn?.addEventListener('click', () => this.hide());

    // Listen for auth state changes from AuthStateManager
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === MessageType.AUTH_STATE_CHANGED) {
        this.handleAuthStateChanged(message.data as AuthStateData);
      }
    });
  }

  /**
   * Handle auth state change broadcast from AuthStateManager
   * Reactively update overlay when user logs in/out
   */
  private handleAuthStateChanged(stateData: AuthStateData): void {
    // If we're showing login required and user just authenticated, retry capture
    if (
      stateData.state === AuthState.AUTHENTICATED &&
      this.captureState.expanded &&
      !this.captureState.originator
    ) {
      // User just logged in while overlay is showing login required
      // Re-attempt the capture flow
      this.collapseCapture();
      this.expandCapture();
    }

    // If user logged out while overlay is showing, show login required
    if (
      stateData.state === AuthState.UNAUTHENTICATED &&
      this.captureState.expanded &&
      this.captureState.originator
    ) {
      // User logged out - show login required
      this.captureState.originator = null;
      this.captureState.lookupResult = null;
      this.showLoginRequired();
    }
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

    // Initialize action button based on current auth state
    this.updateActionButton(true); // We know we're authenticated at this point

    // On articles, watch for the user highlighting a passage after opening so
    // capture enables live without reopening the bar.
    if (this.currentData.isArticle) {
      this.startSelectionWatcher();
    }

    // Start originator lookup by handle
    const handle = this.currentData.author?.username;
    if (handle) {
      await this.lookupOriginator(handle);
    } else {
      this.setOriginatorHtml('<span class="badge error">!</span> <span>No author handle available</span>');
    }
  }

  /**
   * Check if user is authenticated via AuthStateManager
   */
  private async checkAuthStatus(): Promise<{ isAuthenticated: boolean }> {
    try {
      const response = await this.sendMessage({ type: MessageType.AUTH_STATE_GET });
      return { isAuthenticated: response.data?.state === 'AUTHENTICATED' };
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
      `;

      // Create Login button in right section
      this.updateActionButton(false);
    }
  }

  /**
   * Get selected text from the page (if within tweet content)
   */
  private getPageSelection(): string | null {
    return QuotePreview.getPageSelection(this.currentData?.text);
  }

  /**
   * X Article bodies are far too long to capture wholesale, so on article pages
   * a quote requires an explicit text selection. Normal tweets fall back to the
   * full tweet text as before.
   */
  private requiresSelection(): boolean {
    return !!this.currentData?.isArticle && !this.captureState.selectedText;
  }

  /**
   * Watch the page selection while the bar is open on an article, so a quote
   * captured by highlighting after opening fills in live (no reopen needed).
   * Debounced because selectionchange fires continuously during a drag.
   */
  private startSelectionWatcher(): void {
    if (this.selectionChangeHandler) return;
    this.selectionChangeHandler = () => {
      if (this.selectionDebounceTimer) clearTimeout(this.selectionDebounceTimer);
      this.selectionDebounceTimer = setTimeout(() => this.onPageSelectionChanged(), 200);
    };
    document.addEventListener('selectionchange', this.selectionChangeHandler);
  }

  private stopSelectionWatcher(): void {
    if (this.selectionDebounceTimer) {
      clearTimeout(this.selectionDebounceTimer);
      this.selectionDebounceTimer = null;
    }
    if (this.selectionChangeHandler) {
      document.removeEventListener('selectionchange', this.selectionChangeHandler);
      this.selectionChangeHandler = null;
    }
  }

  /**
   * React to a settled page selection. Latches: only adopts a new valid
   * selection, never clears the current one on an empty event (clicking the
   * bar can momentarily collapse the page selection). Use the ✕ to clear.
   */
  private onPageSelectionChanged(): void {
    const selection = this.getPageSelection();
    if (!selection || selection === this.captureState.selectedText) return;
    this.captureState.selectedText = selection;
    this.updateQuotePreview();
    this.updateSubmitButton(!!this.captureState.originator);
  }

  /**
   * Update the quote preview in capture row to show what will be submitted
   */
  private updateQuotePreview(): void {
    const quotePreviewEl = this.shadow?.getElementById('quote-preview');
    if (!quotePreviewEl) return;

    if (!this.quotePreview) {
      this.quotePreview = new QuotePreview(quotePreviewEl, {
        onClearSelection: () => {
          this.captureState.selectedText = null;
          this.updateQuotePreview();
          // On articles, clearing the selection re-blocks submit.
          if (this.requiresSelection()) {
            this.updateSubmitButton(false);
          }
        },
      });
    }

    if (this.requiresSelection()) {
      this.quotePreview.showSelectionRequired();
      return;
    }

    const textToSubmit = this.captureState.selectedText || this.currentData?.text || '';
    this.quotePreview.update(textToSubmit, this.captureState.selectedText);
  }

  /**
   * Update quote preview to show success state (preserves Selection label if applicable)
   */
  private updateQuotePreviewSuccess(): void {
    if (!this.quotePreview) return;

    const textSubmitted = this.captureState.selectedText || this.currentData?.text || '';
    const isPartial = !!this.captureState.selectedText;
    this.quotePreview.showSuccess(textSubmitted, isPartial);
  }

  private collapseCapture(): void {
    this.stopSelectionWatcher();
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

    this.setOriginatorHtml('<span class="status-text">Looking up originator...</span>');
    this.updateSubmitButton(false);
    this.updateDuplicateInfo(null);
  }

  private async lookupOriginator(handle: string): Promise<void> {
    // Lazily create the OriginatorLookup component
    if (!this.originatorLookup) {
      const infoEl = this.shadow?.getElementById('originator-info');
      if (!infoEl) return;
      this.originatorLookup = new OriginatorLookup(infoEl, (msg) =>
        this.sendMessage({ type: msg.type as MessageType, data: msg.data })
      );
    }

    this.captureState.isLookingUp = true;

    try {
      const outcome = await this.originatorLookup.lookup(handle, this.currentData?.url);

      this.captureState.lookupResult = outcome.status;

      if (outcome.status === 'found' && outcome.originator) {
        this.captureState.originator = outcome.originator;
        this.updateSubmitButton(true);

        // On an article with no selection yet, submit is blocked, so skip the
        // duplicate check (it would run against the entire article body).
        if (!this.requiresSelection()) {
          // Use preloaded duplicate data if available and fresh
          if (
            outcome.preloadedDuplicateCheck &&
            outcome.preloadedDuplicateCheck.url === this.currentData?.url &&
            (Date.now() - outcome.preloadedDuplicateCheck.timestamp) < 60000
          ) {
            const result = outcome.preloadedDuplicateCheck.result as DuplicateCheckResult;
            this.captureState.isCheckingDuplicate = false;
            this.captureState.duplicateResult = result;
            this.updateDuplicateInfo({ result });
          } else {
            this.checkDuplicate(outcome.originator.unique_id);
          }
        }
      } else if (outcome.status === 'not_found') {
        this.captureState.createUrl = outcome.createUrl || null;
        this.updateSubmitButton(false);
      } else {
        // error
        this.captureState.errorMessage = outcome.errorMessage || null;
        this.updateSubmitButton(false);
      }
    } finally {
      this.captureState.isLookingUp = false;
    }
  }

  private async submitQuote(): Promise<void> {
    if (!this.currentData || !this.captureState.originator) return;

    // The slug is the public write identifier. Guard against a resolved
    // originator that somehow lacks one rather than POSTing an empty reference
    // (which the API rejects with a cryptic "originator is required").
    const originatorSlug = this.captureState.originator.unique_id;
    if (!originatorSlug) {
      this.setOriginatorHtml(
        `<span class="badge error">!</span>
         <span>Couldn't resolve this originator's ID — please retry or open it in Quotewise.</span>`
      );
      this.updateSubmitButton(true, 'Retry');
      return;
    }

    // Block submission when this URL or another sighting on the same platform is already captured.
    const duplicateResult = this.captureState.duplicateResult;
    const sightingState = classifyDuplicateSighting(duplicateResult);
    if (sightingState === 'exact_sighting') {
      // Submission should already be blocked via UI, but double-check here
      this.updateSubmitButton(false, 'Already Captured');
      return;
    }
    if (sightingState === 'same_platform_sighting') {
      this.updateSubmitButton(false, 'Sighting Exists');
      return;
    }

    // Articles require an explicit selection — never submit the full body.
    if (this.requiresSelection()) {
      this.updateSubmitButton(false);
      return;
    }

    this.captureState.isSubmitting = true;
    this.updateSubmitButton(false, 'Submitting...');

    // Use selected text if available, otherwise full tweet text
    const quoteText = this.captureState.selectedText || this.currentData.text;

    try {
      const response = await this.sendMessage({
        type: MessageType.SUBMIT_QUOTE,
        data: {
          text: quoteText,
          originator_slug: originatorSlug,
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
        this.setOriginatorHtml(
          `<span class="badge success">✓</span>
           <span>Quote added successfully!</span>`
        );
        this.updateSubmitButton(false, 'Done!');

        // Update badge based on whether quote was added to a collection
        // TODO: Once collection selector is added to overlay, update badge based on user's choice
        // For now, show 'exists_not_collected' since we're not adding to collections yet
        this.sendMessage({
          type: MessageType.UPDATE_COLLECTION_BADGE,
          data: {
            state: 'exists_not_collected',
            quoteText: quoteText,
            duplicateSightingState: 'exact_sighting'
          }
        }).catch(() => {
          // Badge update is non-critical
        });

        const clearDuplicateCache = this.clearPreloadedDuplicateCheckForCurrentUrl();

        // Auto-hide after success
        setTimeout(() => this.hide(), 1000);
        await clearDuplicateCache;
      } else {
        throw new Error(response.error || response.message || 'Submission failed');
      }
    } catch (error) {
      this.captureState.submitResult = 'error';
      this.captureState.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.setOriginatorHtml(
        `<span class="badge error">!</span>
         <span>Submit failed: ${this.escapeHtml(this.captureState.errorMessage || '')}</span>`
      );
      this.updateSubmitButton(true, 'Retry');
    } finally {
      this.captureState.isSubmitting = false;
    }
  }

  /**
   * Set HTML directly on the originator-info element (for non-lookup states like submit success/error)
   */
  private setOriginatorHtml(html: string): void {
    if (this.originatorLookup) {
      this.originatorLookup.setHtml(html);
    } else {
      const infoEl = this.shadow?.getElementById('originator-info');
      if (infoEl) {
        infoEl.innerHTML = html;
      }
    }
  }

  private updateSubmitButton(enabled: boolean, text?: string): void {
    if (!this.actionButton) return;
    if (this.requiresSelection()) {
      this.actionButton.showSubmit(false, 'Select quote-text to submit');
      return;
    }
    this.actionButton.showSubmit(enabled, text);
  }

  /**
   * Update submit button with warning style (for platform sighting confirmation)
   */
  private updateSubmitButtonWarning(enabled: boolean, text: string): void {
    if (!this.actionButton) return;
    if (this.requiresSelection()) {
      this.actionButton.showSubmit(false, 'Select quote-text to submit');
      return;
    }
    this.actionButton.showSubmitWarning(enabled, text);
  }

  private updateViewQuoteButton(url: string, text: string): void {
    if (!this.actionButton) return;
    this.actionButton.showViewQuote(url, text);
  }

  /**
   * Lazily initializes the ActionButton component targeting the right section of the originator row
   */
  private ensureActionButton(): ActionButton {
    if (!this.actionButton) {
      const rightSection = this.shadow?.querySelector('.originator-row .section.right') as HTMLElement;
      this.actionButton = new ActionButton(rightSection, {
        onSubmit: () => this.submitQuote(),
        onLogin: async () => {
          try {
            const response = await this.sendMessage({ type: MessageType.OAUTH_LOGIN });
            if (response.success) {
              this.collapseCapture();
              this.expandCapture();
              return { success: true };
            }
            this.setOriginatorHtml(
              `<span class="badge error">!</span>
               <span>Login failed: ${this.escapeHtml(response.error || 'Unknown error')}</span>`
            );
            return { success: false, error: response.error };
          } catch (error) {
            console.error('OAuth login error:', error);
            this.setOriginatorHtml(
              `<span class="badge error">!</span>
               <span>Unable to start login. Please reload the page and try again.</span>`
            );
            return { success: false, error: 'Unable to start login' };
          }
        },
        onViewQuote: (url: string) => {
          window.open(url, '_blank', 'noopener,noreferrer');
        },
      });
    }
    return this.actionButton;
  }

  /**
   * Updates the action button based on authentication state
   */
  private updateActionButton(isAuthenticated: boolean): void {
    const ab = this.ensureActionButton();
    if (isAuthenticated) {
      // Routed through updateSubmitButton so the article selection gate applies.
      this.updateSubmitButton(true);
    } else {
      ab.showLogin();
    }
  }

  /**
   * Check for duplicate quotes in background (non-blocking, informational only)
   */
  private async checkDuplicate(originatorSlug: string): Promise<void> {
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
          originator_slug: originatorSlug,
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
   * Also updates submit button state based on sighting status
   */
  private updateDuplicateInfo(state: { checking: true } | { result: DuplicateCheckResult } | null): void {
    const quotePreviewRow = this.shadow?.querySelector('.quote-preview-row');
    if (!quotePreviewRow) return;

    // Lazily create the badge container and component
    if (!this.duplicateBadgeContainer) {
      this.duplicateBadgeContainer = document.createElement('span');
      this.duplicateBadgeContainer.className = 'duplicate-badge';
      quotePreviewRow.querySelector('.section.center')?.appendChild(this.duplicateBadgeContainer);
    }

    if (!this.duplicateBadge) {
      this.duplicateBadge = new DuplicateBadge(this.duplicateBadgeContainer, {
        onSubmitStateChange: (directive: SubmitStateDirective) => {
          if (directive.type === 'view_quote') {
            this.updateViewQuoteButton(directive.url, directive.text);
            return;
          }

          if (directive.style === 'warning') {
            this.updateSubmitButtonWarning(directive.enabled, directive.text);
          } else {
            this.updateSubmitButton(directive.enabled, directive.text);
          }
        },
      });
    }

    this.duplicateBadge.update(state);
  }

  private async clearPreloadedDuplicateCheckForCurrentUrl(): Promise<void> {
    if (!this.currentData?.url) return;

    try {
      const storage = await chrome.storage.local.get(['preloadedDuplicateCheck']);
      if (storage.preloadedDuplicateCheck?.url === this.currentData.url) {
        await chrome.storage.local.remove(['preloadedDuplicateCheck']);
      }
    } catch {
      // Cache cleanup is best-effort; the next duplicate check can still recover.
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
    scopes?: string[];
    data?: { state?: string; username?: string; error?: string };
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
