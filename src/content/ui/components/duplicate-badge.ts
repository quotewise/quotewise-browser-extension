import type { DuplicateCheckResult } from '../../../types/api';
import { getWebBaseUrl } from '../../../config/environment';
import {
  blockingExactConflict,
  classifyMatchResolution,
  classifyDuplicateSighting,
  getMatchForDuplicateSightingState,
  matchedSightingForText,
  passageCountForUrl,
  primaryMatch,
} from '../../../utils/duplicate-status';
import { buildSimilarMatchView, renderSimilarDiff, type ResolutionDecision } from './similar-diff';
import { safeHref, safeHttpsUrl } from './dom-utils';

interface DefaultSubmitDirective {
  type: 'submit';
  enabled: boolean;
  text?: string;
  style?: 'success';
}

interface WarningSubmitDirective {
  type: 'submit';
  enabled: boolean;
  text: string;
  style: 'warning';
}

interface ViewQuoteDirective {
  type: 'view_quote';
  url: string;
  text: string;
}

export type SubmitStateDirective = DefaultSubmitDirective | WarningSubmitDirective | ViewQuoteDirective;

export interface DuplicateBadgeCallbacks {
  onSubmitStateChange: (directive: SubmitStateDirective) => void;
  onResolveDecision?: (decision: ResolutionDecision) => void;
  onRetry?: () => void;
  onResolveConflict?: (existingQuoteUrl: string | null) => void;
}

export class DuplicateBadge {
  constructor(
    private container: HTMLElement,
    private callbacks: DuplicateBadgeCallbacks
  ) {}

  /**
   * `options.hasOriginator` reports whether the capture has a resolved
   * originator. The badge reasons about the quote; only the caller knows
   * whether there is anyone to attribute it to, and without one no link
   * decision can be carried out. Defaults to true — the sole production caller
   * always supplies it, and the default keeps focused unit tests terse.
   */
  update(
    state: { checking: true } | { result: DuplicateCheckResult } | null,
    capturedText?: string,
    postDate?: string | null,
    options: { hasOriginator?: boolean } = {},
  ): void {
    const hasOriginator = options.hasOriginator !== false;
    this.container.innerHTML = '';
    this.container.className = 'duplicate-badge';
    this.container.style.marginLeft = '';
    this.container.title = '';
    this.container.removeAttribute('aria-live');

    if (!state) return;

    if ('checking' in state) {
      this.container.innerHTML = '<div class="spinner" style="width:12px;height:12px;" role="status" aria-label="Checking Quotewise for duplicates" title="Checking Quotewise for duplicates…"></div>';
      this.container.title = 'Checking Quotewise for duplicates…';
      return;
    }

    const { result } = state;
    const resolution = classifyMatchResolution(result, capturedText);

    if (resolution === 'couldnt_verify') {
      this.renderCouldntVerify();
      this.renderPassagesPanel(result);
      return;
    }

    if (resolution === 'exact') {
      const matchedSighting = matchedSightingForText(result, capturedText);
      const matchedQuoteId = matchedSighting?.quote_id;
      const match = Array.isArray(result.matches)
        ? result.matches.find(candidate => candidate.quote_id === matchedQuoteId)
        : undefined;
      this.renderExactSighting(matchedSighting?.web_url
        ? safeHref(matchedSighting.web_url) ?? undefined
        : undefined, match);
      this.renderPassagesPanel(result);
      return;
    }

    if (resolution === 'conflict') {
      const match = primaryMatch(result.matches);
      this.renderConflict(match, this.getSafeQuotePageUrl(match));
      this.renderPassagesPanel(result);
      return;
    }

    if (resolution === 'similar') {
      const similarView = capturedText
        ? buildSimilarMatchView(result, capturedText, postDate)
        : null;

      if (!similarView) {
        this.renderLegacyStatus(result);
        this.renderPassagesPanel(result);
        return;
      }

      // Two reasons a link decision cannot be carried out. Offering the buttons
      // anyway puts something on screen whose handler returns in silence:
      // `blockingExactConflict` is refused by the submit gate, and with no
      // originator `submitQuote` bails at its `!originator` guard. The diff
      // itself stays — comparing the two texts is the useful part either way.
      const conflicted = !!blockingExactConflict(result);
      const decisionable = hasOriginator && !conflicted;

      renderSimilarDiff(
        this.container,
        decisionable
          ? similarView
          : { ...similarView, sightingAvailable: false, variantAvailable: false },
        { onResolve: (decision) => this.callbacks.onResolveDecision?.(decision) },
      );

      if (!hasOriginator) {
        this.callbacks.onSubmitStateChange({
          type: 'submit',
          enabled: false,
          text: 'Add originator first',
        });
      } else if (conflicted) {
        this.callbacks.onSubmitStateChange({
          type: 'submit',
          enabled: false,
          text: 'Resolve Attribution',
          style: 'warning',
        });
      } else {
        this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: 'Choose Action' });
      }
      this.renderPassagesPanel(result);
      return;
    }

    if (Array.isArray(result.existing_sightings_for_url) && result.existing_sightings_for_url.length > 0) {
      this.renderBadge('info', 'ℹ️', 'This post already has a captured quote');
      this.container.title = 'This post already has a captured quote; this passage is new';
      this.callbacks.onSubmitStateChange({
        type: 'submit',
        enabled: true,
        text: 'Capture another passage',
      });
      this.renderPassagesPanel(result);
      return;
    }

    this.renderLegacyStatus(result, capturedText);
    this.renderPassagesPanel(result);
  }

  private renderPassagesPanel(result: DuplicateCheckResult): void {
    const count = passageCountForUrl(result);
    // null is "the check told us nothing" — render no panel rather than assert
    // captures. This path runs on the couldnt_verify branch too.
    if (count === 0 || count === null) return;

    this.container.classList.add('has-passages');

    const panel = document.createElement('section');
    panel.className = 'passages-panel';
    panel.setAttribute('aria-label', 'Captured passages from this post');

    const heading = document.createElement('div');
    heading.className = 'passages-heading';
    heading.setAttribute('role', 'heading');
    heading.setAttribute('aria-level', '2');
    heading.textContent = count === 'unknown'
      ? 'This post already has captures'
      : `${count} ${count === 1 ? 'passage' : 'passages'} captured from this post`;
    panel.appendChild(heading);

    const sightings = Array.isArray(result.existing_sightings_for_url)
      ? result.existing_sightings_for_url
      : [];
    const displayableSightings = sightings
      .filter((sighting): sighting is typeof sighting & { text: string } => (
        typeof sighting === 'object' && sighting !== null && typeof sighting.text === 'string'
      ))
      .slice(0, 5);

    if (displayableSightings.length > 0) {
      const list = document.createElement('ul');
      list.className = 'passages-list';

      displayableSightings.forEach((sighting) => {
        const item = document.createElement('li');
        const snippet = sighting.text.length > 100
          ? `${sighting.text.slice(0, 100)}…`
          : sighting.text;
        const passageUrl = typeof sighting.web_url === 'string' ? safeHref(sighting.web_url) : null;

        if (passageUrl) {
          const link = document.createElement('a');
          link.href = passageUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = snippet;
          link.setAttribute('aria-label', `View captured passage: ${snippet} (opens in a new tab)`);
          item.appendChild(link);
        } else {
          const text = document.createElement('span');
          text.textContent = snippet;
          item.appendChild(text);
        }

        list.appendChild(item);
      });

      panel.appendChild(list);
    }

    if (count !== 'unknown' && count > displayableSightings.length) {
      const more = document.createElement('div');
      more.className = 'passages-more';
      more.textContent = `+${count - displayableSightings.length} more`;
      panel.appendChild(more);
    }

    this.container.appendChild(panel);
  }

  private renderLegacyStatus(result: DuplicateCheckResult, capturedText?: string): void {
    const sightingState = classifyDuplicateSighting(result, capturedText);
    const match = getMatchForDuplicateSightingState(result, sightingState);
    const quotePageUrl = this.getQuotePageUrl(match);

    if (sightingState === 'exact_sighting') {
      this.renderExactSighting(quotePageUrl, match);
    } else if (sightingState === 'same_platform_sighting') {
      this.renderEarlierSighting(quotePageUrl, match);
    } else if (sightingState === 'other_platform_sighting') {
      this.renderBadge('info', '🔵', 'Add sighting', quotePageUrl);
      this.container.title = 'Quote exists in Quotewise, but this sighting has not been captured';
      this.callbacks.onSubmitStateChange({ type: 'submit', enabled: true, text: 'Add Sighting' });
    } else if (result.recommendation === 'duplicate') {
      this.renderBadge('warning', '⚠️', 'Duplicate', quotePageUrl);
      this.container.title = result.reasoning || 'This quote may already exist';
      if (quotePageUrl) {
        this.callbacks.onSubmitStateChange({ type: 'view_quote', url: quotePageUrl, text: 'View Quote' });
      }
    } else if (result.recommendation === 'new_version') {
      this.renderBadge('info', 'ℹ️', 'New version', quotePageUrl);
      this.container.title = result.reasoning || 'Similar quote exists - will create new version';
      if (quotePageUrl) {
        this.callbacks.onSubmitStateChange({ type: 'view_quote', url: quotePageUrl, text: 'View Quote' });
      }
    } else if (result.in_quotewise) {
      this.renderBadge('success', '✓', 'In Quotewise', quotePageUrl);
      this.container.title = 'Quote already in collection';
      if (quotePageUrl) {
        this.callbacks.onSubmitStateChange({ type: 'view_quote', url: quotePageUrl, text: 'View Quote' });
      }
    } else if (result.recommendation === 'new_quote') {
      this.callbacks.onSubmitStateChange({ type: 'submit', enabled: true });
    }
    // No badge for new_quote — that's the expected case
  }

  /**
   * Small spinner appended NEXT TO the currently displayed badge while the live
   * duplicate check refines a preloaded result. Tooltip-only explanation — the
   * action is trainable, so it earns no permanent text. Any subsequent update()
   * re-render clears it implicitly.
   */
  setRefining(refining: boolean): void {
    const existing = this.container.querySelector('.refine-spinner');
    if (!refining) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const spinner = document.createElement('div');
    spinner.className = 'spinner refine-spinner';
    spinner.style.width = '12px';
    spinner.style.height = '12px';
    spinner.style.flexShrink = '0';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Verifying against the full Quotewise library');
    spinner.title = 'Verifying against the full Quotewise library…';
    this.container.appendChild(spinner);
  }

  private renderCouldntVerify(): void {
    this.container.className = 'duplicate-badge badge warning';
    this.container.style.marginLeft = '8px';
    this.container.setAttribute('aria-live', 'polite');
    this.container.title = "Couldn't verify duplicate status";

    const status = document.createElement('span');
    status.textContent = "⚠️ Couldn't verify duplicates";
    this.container.appendChild(status);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'duplicate-retry';
    retry.textContent = 'Retry';
    retry.setAttribute('aria-label', 'Retry duplicate check');
    retry.addEventListener('click', () => this.callbacks.onRetry?.());
    this.container.appendChild(retry);

    this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: "Couldn't Verify" });
  }

  private renderExactSighting(
    quotePageUrl?: string,
    match?: DuplicateCheckResult['matches'][number],
  ): void {
    this.renderBadge('success', '✓', this.membershipText(match) || 'Already captured this passage', quotePageUrl);
    this.container.title = this.membershipText(match) || 'This passage is already in Quotewise';
    if (quotePageUrl) {
      this.callbacks.onSubmitStateChange({ type: 'view_quote', url: quotePageUrl, text: 'View Quote' });
    } else {
      this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: 'Already captured this passage' });
    }
  }

  private renderEarlierSighting(
    quotePageUrl?: string,
    match?: DuplicateCheckResult['matches'][number],
  ): void {
    this.renderBadge('success', '🟢', this.membershipText(match) || 'Earlier Sighting saved', quotePageUrl);
    this.container.title = this.membershipText(match) ||
      'An earlier Sighting for this quote is already in Quotewise. We keep the earliest known source.';
    if (quotePageUrl) {
      this.callbacks.onSubmitStateChange({ type: 'view_quote', url: quotePageUrl, text: 'View Sighting' });
    } else {
      this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: 'Earlier Saved' });
    }
  }

  private renderConflict(
    match: DuplicateCheckResult['matches'][number] | undefined,
    quotePageUrl: string | null,
  ): void {
    this.container.className = 'duplicate-badge badge warning';
    this.container.style.marginLeft = '8px';
    this.container.setAttribute('aria-live', 'polite');

    const originatorName = match?.originator?.full_name || 'another originator';
    const status = document.createElement('span');
    status.textContent = `⚠️ Already attributed to ${originatorName}`;
    this.container.appendChild(status);

    if (quotePageUrl) {
      const link = document.createElement('a');
      link.href = quotePageUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Resolve in Quotewise';
      link.setAttribute('aria-label', 'Resolve attribution conflict in Quotewise');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        this.callbacks.onResolveConflict?.(quotePageUrl);
      });
      this.container.appendChild(link);
    }

    this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: 'Resolve Attribution' });
  }

  private renderBadge(cssClass: string, icon: string, text: string, linkUrl?: string): void {
    this.container.className = `duplicate-badge badge ${cssClass}`;
    this.container.style.marginLeft = '8px';

    const safeLinkUrl = linkUrl ? safeHref(linkUrl) : null;
    if (safeLinkUrl) {
      const link = document.createElement('a');
      link.href = safeLinkUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.color = 'inherit';
      link.style.textDecoration = 'none';
      link.textContent = `${icon} ${text} ↗`;
      link.setAttribute('aria-label', `${text} (opens in a new tab)`);
      this.container.appendChild(link);
    } else {
      this.container.textContent = `${icon} ${text}`;
    }
  }

  private membershipText(match?: DuplicateCheckResult['matches'][number]): string | null {
    const memberCollections = match?.member_collections || [];
    if (memberCollections.length === 0) {
      return null;
    }

    return `In your collection: ${memberCollections.map(collection => collection.name).join(', ')}`;
  }

  private getQuotePageUrl(match?: DuplicateCheckResult['matches'][number]): string | undefined {
    if (!match) return undefined;

    let raw = match.url;
    if (!raw) {
      if (!match.short_code) return undefined;
      const baseUrl = getWebBaseUrl().replace(/\/+$/, '');
      raw = `${baseUrl}/quotes/${encodeURIComponent(match.short_code)}`;
    }

    // This URL reaches both badge links and the View Quote button
    // (window.open). The match URL is API-provided, so validate the scheme
    // (http/https only) — a javascript:/data: URL must never be navigable.
    return safeHref(raw) ?? undefined;
  }

  private getSafeQuotePageUrl(match?: DuplicateCheckResult['matches'][number]): string | null {
    const url = this.getQuotePageUrl(match);
    if (!url) return null;

    return safeHttpsUrl(url);
  }
}
