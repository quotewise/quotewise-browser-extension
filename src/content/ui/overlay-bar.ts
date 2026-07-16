import type { CapturedPostData } from '../../types';
import { DEFAULT_SETTINGS, MessageType, type Settings } from '../../types';
import type { Collection, DuplicateCheckResult, OriginatorSearchResult, PreflightOriginatorResult } from '../../types/api';
import { AuthState } from '../../auth/auth-state-machine';
import type { AuthStateData } from '../../auth/auth-state-machine';
import { DuplicateBadge } from './components/duplicate-badge';
import type { SubmitStateDirective } from './components/duplicate-badge';
import { CollectionPicker } from './components/collection-picker';
import type { CollectionAddOutcome } from './components/collection-seed';
import { describeSelection, seedSelection, summarizeAdds } from './components/collection-seed';
import { QuotePreview } from './components/quote-preview';
import { OriginatorLookup } from './components/originator-lookup';
import { ActionButton } from './components/action-button';
import { CaptureProgressIndicator } from './components/progress-indicator';
import { FirstRunNotice } from './components/first-run-notice';
import { AccountMenu } from './components/account-menu';
import { buildOverlayMarkup } from './overlay-template';
import {
  classifyDuplicateSighting,
  classifyMatchResolution,
  getMatchForDuplicateSightingState,
} from '../../utils/duplicate-status';
import {
  getSettings,
  onSettingsChanged,
  updateLastUsedCollectionSlugs,
  updateSettings,
} from '../../settings/settings-store';
import {
  captureAuthorHandle,
  captureLikesCount,
  capturePlatform,
  capturePlatformCode,
  capturePlatformData,
  capturePostedAt,
  captureRequiresSelection,
  captureSourceId,
  captureSourceUrl,
} from '../../platforms/capture';

type DataProvider = () => Promise<CapturedPostData | null>;

const SUBMIT_PHASE_MIN_VISIBLE_MS = 350;

interface SubmitQuoteOptions {
  linkToQuoteId?: number;
  userIntent?: 'sighting' | 'variant';
}

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
 * - Row 1: Tweet preview and control buttons
 * - Row 2 (expandable): Originator lookup/selection and submit
 */
export class OverlayBar {
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private hidden = false;
  private dataProvider: DataProvider;
  private currentPlatformLabel = 'Twitter';
  private currentData: CapturedPostData | null = null;
  private duplicateBadge: DuplicateBadge | null = null;
  private duplicateBadgeContainer: HTMLElement | null = null;
  private collectionPicker: CollectionPicker | null = null;
  private collectionPickerContainer: HTMLElement | null = null;
  private existingQuoteTarget: { quoteId: string } | null = null;
  private quotePreview: QuotePreview | null = null;
  private originatorLookup: OriginatorLookup | null = null;
  private actionButton: ActionButton | null = null;
  private progressIndicator: CaptureProgressIndicator | null = null;
  private firstRunNotice: FirstRunNotice | null = null;
  private accountMenu: AccountMenu | null = null;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private unsubscribeSettings: (() => void) | null = null;
  private selectionChangeHandler: (() => void) | null = null;
  private selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private duplicateCheckSequence = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
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
    this.loadSettings().finally(() => this.refresh().then(() => {
      if (this.currentData) {
        this.expandCapture();
      }
    }));
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

  isVisible(): boolean {
    return !!this.root && !this.hidden;
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
    this.shadow.innerHTML = buildOverlayMarkup(this.currentPlatformLabel);

    this.wireInteractions();
    this.refresh();
  }

  render(data: CapturedPostData | null): void {
    if (!this.shadow) return;
    const previewEl = this.shadow.getElementById('tweet-preview');
    const protectedBadge = this.shadow.getElementById('protected-badge');
    const platformBadge = this.shadow.getElementById('platform-badge');
    if (platformBadge) {
      platformBadge.textContent = this.currentPlatformLabel;
    }

    if (!previewEl) return;
    if (!data) {
      previewEl.textContent = 'No supported post detected on this page.';
      if (protectedBadge) protectedBadge.setAttribute('style', 'display:none;');
      return;
    }

    const platformData = capturePlatformData(data);
    const protectedText = data.isProtected || platformData.is_protected;
    if (protectedBadge) {
      protectedBadge.setAttribute('style', protectedText ? '' : 'display:none;');
    }

    const snippet = (data.text || '').trim();
    previewEl.textContent = snippet || 'Post text unavailable';
    this.syncSourcePreview();
  }

  /**
   * The expandable QuotePreview box (next to Submit) shows the full source when
   * there's no selection, so the always-visible top-bar copy would be a literal
   * duplicate. Hide it in that case; keep it when collapsed (pre-capture), when a
   * selection exists (top = full source, box = the selection), or on articles
   * that still require a selection (the box shows a prompt, not the source).
   */
  private syncSourcePreview(): void {
    const previewEl = this.shadow?.getElementById('tweet-preview');
    if (!previewEl) return;
    const boxShowsFullSource =
      this.captureState.expanded &&
      !this.captureState.selectedText &&
      !this.requiresSelection();
    previewEl.style.display = boxShowsFullSource ? 'none' : '';
  }

  private wireInteractions(): void {
    if (!this.shadow) return;
    const refreshBtn = this.shadow.getElementById('refresh-btn');
    const closeBtn = this.shadow.getElementById('close-btn');

    refreshBtn?.addEventListener('click', () => {
      void this.refreshFromTray();
    });
    closeBtn?.addEventListener('click', () => this.hide());

    // Escape dismisses the tray, mirroring the × button. Lower-risk than
    // click-outside, which would collide with selecting tweet/article text.
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.isVisible()) {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    this.subscribeSettings();
    this.mountAccountMenu();

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
    this.accountMenu?.setAuthState(stateData);

    // If we're showing login required and user just authenticated, retry capture
    if (
      stateData.state === AuthState.AUTHENTICATED &&
      this.captureState.expanded &&
      !this.captureState.originator
    ) {
      // User just logged in while overlay is showing login required. Re-attempt the capture flow,
      // but confirm auth has actually settled first (a fresh round-trip) so the re-fired originator
      // lookup doesn't race the just-completed login and get a partial response (bead v5e).
      void this.reattemptCaptureAfterAuth();
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

  /** Re-run the capture flow after a login, once auth is confirmed settled (bead v5e). */
  private async reattemptCaptureAfterAuth(): Promise<void> {
    const status = await this.checkAuthStatus();
    if (!status.isAuthenticated) return;
    // Brief settle before re-firing: AUTHENTICATED state can broadcast a moment before the
    // background's token is usable for the API call, which would flash a transient "Lookup failed"
    // before the retry succeeds (bead v5e follow-on). This closes that window.
    await new Promise((resolve) => setTimeout(resolve, 350));
    this.collapseCapture();
    this.expandCapture();
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = await getSettings();
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  private async refreshFromTray(): Promise<void> {
    await this.refresh();
    await this.collectionPicker?.refresh();

    if (
      this.captureState.expanded &&
      this.captureState.lookupResult === 'not_found'
    ) {
      const handle = this.currentData ? captureAuthorHandle(this.currentData) : null;
      if (handle) {
        await this.lookupOriginator(handle, true);
      }
      return;
    }

    if (
      this.captureState.expanded &&
      this.captureState.originator?.unique_id &&
      !this.requiresSelection()
    ) {
      await this.checkDuplicate(this.captureState.originator.unique_id);
    }
  }

  private subscribeSettings(): void {
    if (this.unsubscribeSettings) return;
    this.unsubscribeSettings = onSettingsChanged((next) => {
      this.settings = next;
      if (this.captureState.expanded && this.currentData) {
        if (next.privateMode && !this.captureState.originator) {
          this.showPrivateModePaused();
        }
      }
    });
  }

  private voidSettingsError(error: unknown): void {
    console.warn('Unable to initialize settings UI:', error);
  }

  private mountAccountMenu(): void {
    if (this.accountMenu) return;
    const container = this.shadow?.getElementById('account-menu-wrap') as HTMLElement | null;
    if (!container) return;

    this.accountMenu = new AccountMenu(container, message => this.sendMessage(message));
    void this.accountMenu.mount().catch(error => this.voidSettingsError(error));
  }

  private async expandCapture(): Promise<void> {
    if (!this.shadow || !this.currentData) return;

    // Check authentication FIRST before doing any API calls
    const authStatus = await this.checkAuthStatus();
    if (!authStatus.isAuthenticated) {
      this.showLoginRequired();
      return;
    }

    await this.loadSettings();

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
    await this.maybeShowFirstRunNotice();

    if (this.settings.privateMode) {
      this.showPrivateModePaused();
      return;
    }

    await this.mountNewCaptureCollectionPicker();

    // A new in-post selection can start another passage on any post type.
    this.startSelectionWatcher();

    // Start originator lookup by handle
    const handle = captureAuthorHandle(this.currentData);
    if (handle) {
      await this.lookupOriginator(handle);
    } else {
      this.setOriginatorHtml('<span class="badge error">!</span> <span>No author handle available</span>');
    }
  }

  private async maybeShowFirstRunNotice(): Promise<void> {
    if (this.settings.privateMode || this.settings.firstRunNoticeShown) {
      this.firstRunNotice?.hide();
      return;
    }

    const container = this.shadow?.getElementById('first-run-notice-container') as HTMLElement | null;
    if (!container) return;

    if (!this.firstRunNotice) {
      this.firstRunNotice = new FirstRunNotice(container, {
        onDismiss: () => {
          void updateSettings({ firstRunNoticeShown: true }).then(settings => {
            this.settings = settings;
          });
        },
      });
    }

    this.firstRunNotice.show();
    this.settings = await updateSettings({ firstRunNoticeShown: true });
  }

  private async mountNewCaptureCollectionPicker(): Promise<void> {
    const container = this.shadow?.getElementById('collection-picker-slot') as HTMLElement | null;
    if (!container) return;

    container.hidden = false;
    this.collectionPickerContainer = container;
    this.existingQuoteTarget = null;
    this.collectionPicker = new CollectionPicker(container, {
      label: 'Add to collections',
      loadCollections: (forceRefresh = false) => this.loadCollections(forceRefresh),
      onSelectionChange: () => {
        this.updateSubmitButton(!!this.captureState.originator);
        this.updateCollectionSummary();
      },
    });

    await this.collectionPicker.mount();
    const seeded = seedSelection(
      this.settings.lastUsedCollectionSlugs,
      this.settings.defaultCollectionSlug,
      this.settings.autoAddToCollection,
      this.collectionPicker.getAvailableCollections(),
    );
    this.collectionPicker.setSelectedSlugs(seeded);
  }

  private hideCollectionPicker(): void {
    this.collectionPicker = null;
    this.existingQuoteTarget = null;
    if (this.collectionPickerContainer) {
      this.collectionPickerContainer.hidden = true;
      this.collectionPickerContainer.innerHTML = '';
    }
    this.updateCollectionSummary();
  }

  /**
   * Reflect the picked collections in a one-line caption under the Submit button,
   * so the check-collections → submit relationship is explicit. Hidden when none.
   */
  private updateCollectionSummary(): void {
    const el = this.shadow?.getElementById('collection-summary');
    if (!el) return;
    const names = this.selectedCollections().map(collection => collection.name);
    const text = describeSelection(names);
    el.textContent = text;
    el.hidden = text.length === 0;
  }

  private async loadCollections(forceRefresh = false): Promise<Collection[]> {
    const response = await this.sendMessage({
      type: MessageType.LIST_COLLECTIONS,
      data: { forceRefresh },
    });

    if (!response.success) {
      throw new Error(response.error || 'Unable to load collections');
    }

    return response.collections || [];
  }

  private selectedCollections(): Collection[] {
    return this.collectionPicker?.getSelectedCollections() || [];
  }

  private fallbackCollectionFromSlug(slug: string): Collection {
    return {
      id: slug,
      slug,
      name: slug,
      description: '',
      is_default: false,
      quote_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  private async mountExistingQuoteCollectionPicker(
    match: DuplicateCheckResult['matches'][number],
  ): Promise<void> {
    const container = this.shadow?.getElementById('collection-picker-slot') as HTMLElement | null;
    if (!container || !match.quote_id) return;

    container.hidden = false;
    this.collectionPickerContainer = container;
    this.existingQuoteTarget = { quoteId: String(match.quote_id) };
    this.collectionPicker = new CollectionPicker(container, {
      label: 'Add existing quote to collections',
      alreadyIn: match.member_collections || [],
      loadCollections: (forceRefresh = false) => this.loadCollections(forceRefresh),
      onSelectionChange: (selected) => {
        this.updateSubmitButton(selected.size > 0, selected.size > 0 ? 'Add to Collections' : 'Choose collection');
        this.updateCollectionSummary();
      },
    });

    await this.collectionPicker.mount();
    this.updateSubmitButton(false, this.collectionPicker.getAvailableCollections().length > 0
      ? 'Choose collection'
      : 'No collections');
  }

  private matchForExistingCollectionAdd(
    result: DuplicateCheckResult,
  ): DuplicateCheckResult['matches'][number] | null {
    const currentText = this.captureState.selectedText || this.currentData?.text;
    const sightingState = classifyDuplicateSighting(result, currentText);
    if (sightingState === 'exact_sighting' || sightingState === 'same_platform_sighting') {
      return getMatchForDuplicateSightingState(result, sightingState) || null;
    }

    if (
      result.in_quotewise &&
      classifyMatchResolution(result, currentText) !== 'conflict' &&
      Array.isArray(result.matches) &&
      result.matches.length > 0
    ) {
      return result.matches[0];
    }

    return null;
  }

  private syncCollectionPickerWithDuplicateState(
    state: { checking: true } | { result: DuplicateCheckResult } | null,
  ): void {
    if (!state || 'checking' in state) {
      return;
    }

    const match = this.matchForExistingCollectionAdd(state.result);
    if (match?.quote_id) {
      void this.mountExistingQuoteCollectionPicker(match);
      return;
    }

    if (this.existingQuoteTarget) {
      void this.mountNewCaptureCollectionPicker();
    }
  }

  private showPrivateModePaused(): void {
    this.hideCollectionPicker();
    this.captureState.lookupResult = null;
    this.captureState.originator = null;
    this.captureState.createUrl = null;
    this.updateDuplicateInfo(null);
    this.updateSubmitButton(false, 'Check first');

    const infoEl = this.shadow?.getElementById('originator-info');
    if (!infoEl) return;

    infoEl.innerHTML = `
      <span class="badge info">⏸︎</span>
      <span>Private mode is on. Check this post only when you choose.</span>
      <button type="button" class="check-now" id="check-now-btn" aria-label="Check this post now">Check now</button>
    `;
    infoEl.querySelector('#check-now-btn')?.addEventListener('click', () => {
      void this.checkNow();
    });
  }

  private originatorFromPreflight(result: unknown): OriginatorSearchResult | null {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const value = result as PreflightOriginatorResult;
    if (!value.found || !value.originator) {
      return null;
    }

    const uniqueId = value.originator.unique_id ?? value.originator.slug;
    if (!uniqueId) {
      return null;
    }

    return {
      id: value.originator.id,
      unique_id: uniqueId,
      full_name: value.originator.full_name,
      sort_name_display: value.originator.full_name,
      confidence: value.confidence ?? 1,
    };
  }

  private async checkNow(): Promise<void> {
    if (!this.currentData) return;

    const handle = captureAuthorHandle(this.currentData);
    if (!handle) {
      this.setOriginatorHtml('<span class="badge error">!</span> <span>No author handle available</span>');
      return;
    }

    const progress = this.ensureProgressIndicator();
    progress.setPhase('checking');
    this.updateSubmitButton(false, 'Checking...');

    try {
      const response = await this.sendMessage({
        type: MessageType.CHECK_NOW,
        data: {
          sourceId: captureSourceId(this.currentData),
          handle,
          platform: capturePlatform(this.currentData),
          sourceUrl: captureSourceUrl(this.currentData),
          text: this.captureState.selectedText || this.currentData.text,
        },
      });

      if (!response.success) {
        throw new Error(response.error || 'Check failed');
      }

      const originator = this.originatorFromPreflight(response.originator);
      if (originator) {
        this.captureState.originator = originator;
        this.captureState.lookupResult = 'found';
        this.setOriginatorHtml(
          `<span class="badge success">✓</span>
           <span class="originator-name">${this.escapeHtml(originator.full_name)}</span>
           <span class="originator-handle">@${this.escapeHtml(handle)}</span>`
        );
        this.updateSubmitButton(true);
      } else {
        this.captureState.lookupResult = 'not_found';
        this.setOriginatorHtml(
          `<span class="badge warning">!</span>
           <span>No Quotewise originator found for @${this.escapeHtml(handle)}.</span>`
        );
        this.updateSubmitButton(false);
      }

      if (response.duplicate_check) {
        this.captureState.duplicateResult = response.duplicate_check;
        this.updateDuplicateInfo({ result: response.duplicate_check });
      }
      progress.setPhase('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Check failed';
      progress.setError(message);
      this.updateSubmitButton(false, 'Check first');
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
    this.hideCollectionPicker();
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
    return !!this.currentData && captureRequiresSelection(this.currentData) && !this.captureState.selectedText;
  }

  /**
   * Watch the page selection while the bar is open, so a quote
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
    this.recheckCurrentSelection();
  }

  private recheckCurrentSelection(): void {
    if (this.captureState.duplicateResult) {
      this.updateDuplicateInfo({ result: this.captureState.duplicateResult });
    } else {
      this.updateSubmitButton(!!this.captureState.originator);
    }

    const originatorSlug = this.captureState.originator?.unique_id;
    if (originatorSlug && !this.requiresSelection()) {
      void this.checkDuplicate(originatorSlug);
    }
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
          } else {
            this.recheckCurrentSelection();
          }
        },
      });
    }

    if (this.requiresSelection()) {
      this.quotePreview.showSelectionRequired();
      this.syncSourcePreview();
      return;
    }

    const textToSubmit = this.captureState.selectedText || this.currentData?.text || '';
    this.quotePreview.update(textToSubmit, this.captureState.selectedText);
    this.syncSourcePreview();
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
    this.duplicateCheckSequence += 1;
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
    this.progressIndicator?.reset();
    this.firstRunNotice?.hide();
    this.hideCollectionPicker();
    this.updateSubmitButton(false);
    this.updateDuplicateInfo(null);
    this.syncSourcePreview();
  }

  private async lookupOriginator(handle: string, forceRefresh = false): Promise<void> {
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
      const sourceUrl = this.currentData ? captureSourceUrl(this.currentData) : undefined;
      const platform = this.currentData ? capturePlatform(this.currentData) : 'twitter';
      const outcome = await this.originatorLookup.lookup(handle, sourceUrl, platform, forceRefresh);

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
            outcome.preloadedDuplicateCheck.url === sourceUrl &&
            (Date.now() - outcome.preloadedDuplicateCheck.timestamp) < 60000
          ) {
            const result = outcome.preloadedDuplicateCheck.result as DuplicateCheckResult;
            this.captureState.isCheckingDuplicate = false;
            this.captureState.duplicateResult = result;
            this.updateDuplicateInfo({ result });
            void this.checkDuplicate(outcome.originator.unique_id);
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

  private async submitQuote(opts: SubmitQuoteOptions = {}): Promise<void> {
    if (this.captureState.isSubmitting) return;
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
    const quoteText = this.captureState.selectedText || this.currentData.text;
    const matchResolution = classifyMatchResolution(duplicateResult, quoteText);
    if (matchResolution === 'couldnt_verify') {
      this.updateSubmitButton(false, "Couldn't Verify");
      return;
    }
    if (matchResolution === 'conflict') {
      this.updateSubmitButton(false, 'Resolve Attribution');
      return;
    }

    const sightingState = classifyDuplicateSighting(duplicateResult, quoteText);
    if (sightingState === 'exact_sighting') {
      // Submission should already be blocked via UI, but double-check here
      this.updateSubmitButton(false, 'Already Captured');
      return;
    }
    if (sightingState === 'same_platform_sighting') {
      this.updateSubmitButton(false, 'Earlier Saved');
      return;
    }

    // Articles require an explicit selection — never submit the full body.
    if (this.requiresSelection()) {
      this.updateSubmitButton(false);
      return;
    }

    this.captureState.isSubmitting = true;
    this.setSubmitProgressPhase('checking');
    this.updateSubmitButton(false, 'Submitting...');
    this.actionButton?.setBusy(true);

    const settingsLoad = this.loadSettings();
    await this.waitForVisibleSubmitPhase();
    await settingsLoad;
    let selectedCollections = this.selectedCollections();
    if (
      selectedCollections.length === 0 &&
      !this.collectionPicker &&
      this.settings.autoAddToCollection &&
      this.settings.defaultCollectionSlug
    ) {
      selectedCollections = [this.fallbackCollectionFromSlug(this.settings.defaultCollectionSlug)];
    }
    const decisionFields = this.decisionFieldsForSubmit(opts);

    try {
      this.setSubmitProgressPhase('submitting');
      const sourceUrl = captureSourceUrl(this.currentData);
      const likesCount = captureLikesCount(this.currentData);
      const response = await this.sendMessage({
        type: MessageType.SUBMIT_QUOTE,
        data: {
          text: quoteText,
          originator_slug: originatorSlug,
          source_url: sourceUrl,
          platform_code: capturePlatformCode(this.currentData),
          ...(likesCount !== undefined ? { likes_count: likesCount } : {}),
          quote_date: capturePostedAt(this.currentData) || undefined,
          attribution_type: 'DIRECT',
          platform_data: capturePlatformData(this.currentData),
          ...decisionFields
        }
      });

      if (response.success) {
        const submittedQuoteId = selectedCollections.length > 0
          ? this.resolveSubmittedQuoteIdForCollections(response)
          : { quoteId: response.quoteId || '' };
        const collectionResults = await this.addCollectionsAfterCapture(
          submittedQuoteId.quoteId,
          selectedCollections,
          submittedQuoteId.error,
        );
        const addSummary = summarizeAdds(collectionResults);
        const slugsToRemember = collectionResults
          .filter(result => result.success)
          .map(result => result.collectionSlug)
          .filter(slug => slug.trim().length > 0);
        if (slugsToRemember.length > 0) {
          await this.persistLastUsedSelection(slugsToRemember);
        }

        this.setSubmitProgressPhase('confirming');
        await this.waitForVisibleSubmitPhase();
        this.ensureProgressIndicator().setPhase('success');
        this.captureState.submitResult = 'success';
        this.captureState.isCheckingDuplicate = false;
        this.captureState.duplicateResult = null;

        // Update quote preview to show success
        this.updateQuotePreviewSuccess();

        // Clear duplicate badge and show success in originator row
        this.updateDuplicateInfo(null);
        const successMessage = this.successMessageForSubmit(response, opts.userIntent);
        const collectionMessage = this.collectionMessage(successMessage, addSummary);
        this.setOriginatorHtml(
          addSummary.failed.length > 0
            ? `<span class="badge warning">!</span>
               <span>${this.escapeHtml(collectionMessage)}</span>`
            : `<span class="badge success">✓</span>
               <span>${this.escapeHtml(collectionMessage)}</span>`
        );
        const hasCollectionSuccess = addSummary.succeeded.length > 0;
        if (addSummary.failed.length > 0) {
          this.existingQuoteTarget = submittedQuoteId.quoteId
            ? { quoteId: submittedQuoteId.quoteId }
            : null;
          this.collectionPicker?.setSelectedSlugs(addSummary.failed.map(result => result.collectionSlug));
          this.updateSubmitButton(!!this.existingQuoteTarget, 'Retry failed');
        } else {
          this.updateSubmitButton(false, 'Done!');
        }

        // Update badge based on whether quote was added to a collection.
        this.sendMessage({
          type: MessageType.UPDATE_COLLECTION_BADGE,
          data: {
            state: hasCollectionSuccess ? 'already_collected' : 'exists_not_collected',
            quoteText: quoteText,
            duplicateSightingState: 'exact_sighting'
          }
        }).catch(() => {
          // Badge update is non-critical
        });

        const clearDuplicateCache = this.clearPreloadedDuplicateCheckForCurrentUrl();

        // Auto-hide after full success; partial failures stay open for retry.
        if (addSummary.failed.length === 0) {
          setTimeout(() => this.hide(), 1000);
        }
        await clearDuplicateCache;
      } else {
        throw new Error(response.error || response.message || 'Submission failed');
      }
    } catch (error) {
      this.captureState.submitResult = 'error';
      this.captureState.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.ensureProgressIndicator().setError(this.captureState.errorMessage);
      this.setOriginatorHtml(
        `<span class="badge error">!</span>
         <span>Submit failed: ${this.escapeHtml(this.captureState.errorMessage || '')}</span>`
      );
      this.updateSubmitButton(true, 'Retry');
    } finally {
      this.captureState.isSubmitting = false;
      this.actionButton?.setBusy(false);
    }
  }

  private decisionFieldsForSubmit(opts: SubmitQuoteOptions): {
    link_to_quote_id?: number;
    user_intent?: 'sighting' | 'variant';
  } {
    if (
      typeof opts.linkToQuoteId === 'number' &&
      Number.isFinite(opts.linkToQuoteId) &&
      opts.userIntent
    ) {
      return {
        link_to_quote_id: opts.linkToQuoteId,
        user_intent: opts.userIntent,
      };
    }

    return {};
  }

  private successMessageForSubmit(
    response: { action?: 'created' | 'sighting_added' },
    userIntent?: 'sighting' | 'variant',
  ): string {
    if (response.action === 'sighting_added' || userIntent === 'sighting') {
      return 'Sighting added';
    }

    if (response.action === 'created' && userIntent === 'variant') {
      return 'Added as variant';
    }

    if (userIntent === 'variant') {
      return 'Added as variant';
    }

    return 'Quote added successfully!';
  }

  private async addCollectionsAfterCapture(
    quoteId: string,
    selectedCollections: Collection[],
    missingQuoteIdError = 'Quote ID missing after capture',
  ): Promise<CollectionAddOutcome[]> {
    if (selectedCollections.length === 0) {
      return [];
    }

    if (!quoteId) {
      return selectedCollections.map(collection => ({
        collectionSlug: collection.slug,
        collectionName: collection.name,
        success: false,
        error: missingQuoteIdError,
      }));
    }

    const results: CollectionAddOutcome[] = [];
    for (const collection of selectedCollections) {
      results.push(await this.addQuoteToCollection(collection, quoteId));
    }

    return results;
  }

  private async addQuoteToCollection(collection: Collection, quoteId: string): Promise<CollectionAddOutcome> {
    const targetCollection = await this.resolveCollectionForAdd(collection);
    const collectionSlug = targetCollection.slug.trim();
    if (!collectionSlug) {
      return {
        collectionSlug,
        collectionName: collection.name,
        success: false,
        error: 'Collection is missing an API slug. Refresh collections and try again.',
      };
    }

    const response = await this.sendMessage({
      type: MessageType.ADD_QUOTE_TO_COLLECTION,
      data: {
        collectionSlug,
        quoteId,
      },
    });

    return {
      collectionSlug,
      collectionName: targetCollection.name || collection.name,
      success: response.success === true,
      alreadyMember: response.alreadyMember,
      error: response.success ? undefined : response.error || 'Unable to add to collection',
    };
  }

  private async resolveCollectionForAdd(collection: Collection): Promise<Collection> {
    if (collection.slug.trim()) {
      return collection;
    }

    try {
      const freshCollections = await this.loadCollections(true);
      return freshCollections.find(candidate =>
        candidate.id === collection.id ||
        candidate.name === collection.name
      ) || collection;
    } catch {
      return collection;
    }
  }

  private collectionMessage(baseMessage: string, summary: ReturnType<typeof summarizeAdds>): string {
    if (summary.succeeded.length === 0 && summary.failed.length === 0) {
      return baseMessage;
    }

    const succeededNames = summary.succeeded.map(result => result.collectionName).join(', ');
    const failedNames = summary.failed
      .map(result => result.error
        ? `${result.collectionName}: ${result.error}`
        : result.collectionName)
      .join('; ');

    if (summary.failed.length === 0) {
      return `Quote added to ${succeededNames}.`;
    }

    if (summary.succeeded.length === 0) {
      return `${baseMessage} Could not add to ${failedNames}.`;
    }

    return `Quote added to ${succeededNames}. Could not add to ${failedNames}.`;
  }

  private async persistLastUsedSelection(slugs: string[]): Promise<void> {
    try {
      this.settings = await updateLastUsedCollectionSlugs(slugs);
    } catch {
      // Last-used selection is a convenience; capture correctness does not depend on it.
    }
  }

  private async addExistingQuoteToSelectedCollections(): Promise<void> {
    if (this.captureState.isSubmitting || !this.existingQuoteTarget) return;
    const selectedCollections = this.selectedCollections();
    if (selectedCollections.length === 0) {
      this.updateSubmitButton(false, 'Choose collection');
      return;
    }

    this.captureState.isSubmitting = true;
    this.setSubmitProgressPhase('submitting');
    this.updateSubmitButton(false, 'Adding...');
    this.actionButton?.setBusy(true);

    try {
      const results: CollectionAddOutcome[] = [];
      for (const collection of selectedCollections) {
        results.push(await this.addQuoteToCollection(collection, this.existingQuoteTarget.quoteId));
      }

      const summary = summarizeAdds(results);
      if (summary.succeeded.length > 0) {
        const slugsToRemember = summary.succeeded
          .map(result => result.collectionSlug)
          .filter(slug => slug.trim().length > 0);
        if (slugsToRemember.length > 0) {
          await this.persistLastUsedSelection(slugsToRemember);
        }
      }

      this.ensureProgressIndicator().setPhase(summary.failed.length > 0 ? 'checking' : 'success');
      const message = this.collectionMessage('Quote already exists.', summary);
      this.setOriginatorHtml(
        summary.failed.length > 0
          ? `<span class="badge warning">!</span><span>${this.escapeHtml(message)}</span>`
          : `<span class="badge success">✓</span><span>${this.escapeHtml(message)}</span>`
      );

      if (summary.succeeded.length > 0) {
        void this.sendMessage({
          type: MessageType.UPDATE_COLLECTION_BADGE,
          data: {
            state: 'already_collected',
            quoteText: this.captureState.selectedText || this.currentData?.text || '',
            duplicateSightingState: 'exact_sighting',
          },
        });
      }

      if (summary.failed.length > 0) {
        this.collectionPicker?.setSelectedSlugs(summary.failed.map(result => result.collectionSlug));
        this.updateSubmitButton(true, 'Retry failed');
      } else {
        this.updateSubmitButton(false, 'Added');
        setTimeout(() => this.hide(), 1000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add to collection';
      this.ensureProgressIndicator().setError(message);
      this.setOriginatorHtml(
        `<span class="badge error">!</span><span>${this.escapeHtml(message)}</span>`
      );
      this.updateSubmitButton(true, 'Retry');
    } finally {
      this.captureState.isSubmitting = false;
      this.actionButton?.setBusy(false);
    }
  }

  private resolveSubmittedQuoteIdForCollections(
    response: { quoteId?: string },
  ): { quoteId: string; error?: string } {
    const quoteId = response.quoteId?.trim();
    if (quoteId) {
      return { quoteId };
    }

    return {
      quoteId: '',
      error: 'API response omitted version_id.',
    };
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
      this.actionButton.showSubmit(false, 'Select text to submit');
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
      this.actionButton.showSubmit(false, 'Select text to submit');
      return;
    }
    this.actionButton.showSubmitWarning(enabled, text);
  }

  private updateViewQuoteButton(url: string, text: string): void {
    if (!this.actionButton) return;
    this.actionButton.showViewQuote(url, text);
  }

  private setSubmitProgressPhase(phase: 'checking' | 'submitting' | 'confirming'): void {
    this.ensureProgressIndicator().setPhase(phase, { immediate: true });
  }

  private async waitForVisibleSubmitPhase(): Promise<void> {
    if (!this.shadow || this.hidden) return;

    await new Promise(resolve => setTimeout(resolve, SUBMIT_PHASE_MIN_VISIBLE_MS));
  }

  /**
   * Lazily initializes the ActionButton component targeting the right section of the originator row
   */
  private ensureActionButton(): ActionButton {
    if (!this.actionButton) {
      const rightSection = this.shadow?.querySelector('.originator-row .section.right') as HTMLElement;
      this.actionButton = new ActionButton(rightSection, {
        onSubmit: () => {
          if (this.existingQuoteTarget) {
            void this.addExistingQuoteToSelectedCollections();
            return;
          }
          void this.submitQuote();
        },
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

  private ensureProgressIndicator(): CaptureProgressIndicator {
    if (!this.progressIndicator) {
      const container = this.shadow?.getElementById('progress-indicator') as HTMLElement | null
        ?? document.createElement('div');
      this.progressIndicator = new CaptureProgressIndicator(container, {
        onRetry: () => {
          void this.submitQuote();
        },
      });
    }
    return this.progressIndicator;
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

    const checkSequence = ++this.duplicateCheckSequence;
    const hasCurrentResult = this.captureState.duplicateResult !== null;
    this.captureState.isCheckingDuplicate = true;
    if (!hasCurrentResult) {
      this.updateDuplicateInfo({ checking: true });
    }

    const quoteText = this.captureState.selectedText || this.currentData.text;
    const sourceUrl = captureSourceUrl(this.currentData);
    const handle = captureAuthorHandle(this.currentData);

    try {
      const response = await this.sendMessage({
        type: MessageType.CHECK_DUPLICATE,
        data: {
          text: quoteText,
          originator_slug: originatorSlug,
          source_url: sourceUrl,
          social_handle: handle
        }
      });

      const currentText = this.captureState.selectedText || this.currentData?.text || '';
      const currentUrl = this.currentData ? captureSourceUrl(this.currentData) : '';
      if (checkSequence !== this.duplicateCheckSequence || quoteText !== currentText || sourceUrl !== currentUrl) {
        return;
      }

      if (response.success && response.result) {
        this.captureState.duplicateResult = response.result as DuplicateCheckResult;
        this.updateDuplicateInfo({ result: this.captureState.duplicateResult });
      } else {
        // Clear spinner even if no result
        this.updateDuplicateInfo(null);
      }
    } catch (error) {
      if (checkSequence !== this.duplicateCheckSequence) return;
      // Silently fail - duplicate check is informational only
      console.warn('Duplicate check failed:', error);
      this.updateDuplicateInfo(null);
    } finally {
      if (checkSequence === this.duplicateCheckSequence) {
        this.captureState.isCheckingDuplicate = false;
      }
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
      this.duplicateBadgeContainer = document.createElement('div');
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
        onResolveDecision: (decision) => {
          void this.submitQuote({
            linkToQuoteId: decision.quoteId,
            userIntent: decision.intent,
          });
        },
        onRetry: () => {
          const originatorSlug = this.captureState.originator?.unique_id;
          if (originatorSlug) {
            void this.checkDuplicate(originatorSlug);
          }
        },
        onResolveConflict: (existingQuoteUrl) => {
          if (existingQuoteUrl) {
            window.open(existingQuoteUrl, '_blank', 'noopener,noreferrer');
          }
        },
      });
    }

    this.duplicateBadge.update(
      state,
      this.captureState.selectedText || this.currentData?.text,
      this.currentData ? capturePostedAt(this.currentData) : null,
    );
    this.syncCollectionPickerWithDuplicateState(state);
  }

  private async clearPreloadedDuplicateCheckForCurrentUrl(): Promise<void> {
    if (!this.currentData) return;
    const sourceUrl = captureSourceUrl(this.currentData);
    if (!sourceUrl) return;

    try {
      const storage = await chrome.storage.local.get(['preloadedDuplicateCheck']);
      if (storage.preloadedDuplicateCheck?.url === sourceUrl) {
        await chrome.storage.local.remove(['preloadedDuplicateCheck']);
      }
    } catch {
      // Cache cleanup is best-effort; the next duplicate check can still recover.
    }
  }

  private sendMessage(message: { type: MessageType; data?: unknown }): Promise<{
    success: boolean;
    found?: boolean;
    originator?: OriginatorSearchResult | PreflightOriginatorResult;
    create_url?: string;
    error?: string;
    message?: string;
    collectionWarning?: string;
    action?: 'created' | 'sighting_added';
    id?: string;
    quoteId?: string;
    alreadyMember?: boolean;
    result?: DuplicateCheckResult;
    duplicate_check?: DuplicateCheckResult;
    collections?: Collection[];
    default_collection_id?: string | null;
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
