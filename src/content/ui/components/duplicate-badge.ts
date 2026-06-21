import type { DuplicateCheckResult } from '../../../types/api';
import { getWebBaseUrl } from '../../../config/environment';
import {
  classifyMatchResolution,
  classifyDuplicateSighting,
  getMatchForDuplicateSightingState
} from '../../../utils/duplicate-status';
import { buildSimilarMatchView, renderSimilarDiff, type ResolutionDecision } from './similar-diff';
import { safeHref, safeHttpsUrl } from './dom-utils';

interface SubmitDirective {
  type: 'submit';
  enabled: boolean;
  text: string;
  style?: 'success' | 'warning';
}

interface ViewQuoteDirective {
  type: 'view_quote';
  url: string;
  text: string;
}

export type SubmitStateDirective = SubmitDirective | ViewQuoteDirective;

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

  update(
    state: { checking: true } | { result: DuplicateCheckResult } | null,
    capturedText?: string,
    tweetDate?: string | null,
  ): void {
    this.container.innerHTML = '';
    this.container.className = 'duplicate-badge';
    this.container.style.marginLeft = '';
    this.container.title = '';
    this.container.removeAttribute('aria-live');

    if (!state) return;

    if ('checking' in state) {
      this.container.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div>';
      this.container.title = 'Checking for duplicates...';
      return;
    }

    const { result } = state;
    const resolution = classifyMatchResolution(result);

    if (resolution === 'couldnt_verify') {
      this.renderCouldntVerify();
      return;
    }

    if (resolution === 'exact') {
      const sightingState = classifyDuplicateSighting(result);
      const match = getMatchForDuplicateSightingState(result, sightingState);
      const quotePageUrl = this.getQuotePageUrl(match);

      this.renderBadge('success', '🟢', 'Already captured', quotePageUrl);
      this.container.title = 'This exact URL is already in Quotewise';
      if (quotePageUrl) {
        this.callbacks.onSubmitStateChange({ type: 'view_quote', url: quotePageUrl, text: 'View Quote' });
      } else {
        this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: 'Already Captured' });
      }
      return;
    }

    if (resolution === 'conflict') {
      const match = Array.isArray(result.matches) ? result.matches[0] : undefined;
      this.renderConflict(match, this.getSafeQuotePageUrl(match));
      return;
    }

    if (resolution === 'similar') {
      const similarView = capturedText
        ? buildSimilarMatchView(result, capturedText, tweetDate)
        : null;

      if (!similarView) {
        this.renderLegacyStatus(result);
        return;
      }

      renderSimilarDiff(this.container, similarView, {
        onResolve: (decision) => this.callbacks.onResolveDecision?.(decision),
      });
      this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: 'Choose Action' });
      return;
    }

    this.renderLegacyStatus(result);
  }

  private renderLegacyStatus(result: DuplicateCheckResult): void {
    const sightingState = classifyDuplicateSighting(result);
    const match = getMatchForDuplicateSightingState(result, sightingState);
    const quotePageUrl = this.getQuotePageUrl(match);

    if (sightingState === 'exact_sighting') {
      this.renderBadge('success', '🟢', 'Already captured', quotePageUrl);
      this.container.title = 'This exact URL is already in Quotewise';
      if (quotePageUrl) {
        this.callbacks.onSubmitStateChange({ type: 'view_quote', url: quotePageUrl, text: 'View Quote' });
      } else {
        this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: 'Already Captured' });
      }
    } else if (sightingState === 'same_platform_sighting') {
      this.renderBadge('warning', '🟡', 'Platform sighting exists', quotePageUrl);
      this.container.title = 'A Twitter sighting exists for this quote';
      if (quotePageUrl) {
        this.callbacks.onSubmitStateChange({ type: 'view_quote', url: quotePageUrl, text: 'View Quote' });
      } else {
        this.callbacks.onSubmitStateChange({ type: 'submit', enabled: false, text: 'Sighting Exists' });
      }
    } else if (sightingState === 'other_platform_sighting') {
      this.renderBadge('info', '🔵', 'Add Twitter sighting', quotePageUrl);
      this.container.title = 'Quote exists in Quotewise, but this Twitter sighting has not been captured';
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
    }
    // No badge for new_quote — that's the expected case
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
      this.container.appendChild(link);
    } else {
      this.container.textContent = `${icon} ${text}`;
    }
  }

  private getQuotePageUrl(match?: DuplicateCheckResult['matches'][number]): string | undefined {
    if (!match) return undefined;
    if (match.url) return match.url;
    if (!match.short_code) return undefined;

    const baseUrl = getWebBaseUrl().replace(/\/+$/, '');
    return `${baseUrl}/quotes/${encodeURIComponent(match.short_code)}`;
  }

  private getSafeQuotePageUrl(match?: DuplicateCheckResult['matches'][number]): string | null {
    const url = this.getQuotePageUrl(match);
    if (!url) return null;

    return safeHttpsUrl(url);
  }
}
