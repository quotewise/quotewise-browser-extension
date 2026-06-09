import type { DuplicateCheckResult } from '../../../types/api';
import { getWebBaseUrl } from '../../../config/environment';
import {
  classifyDuplicateSighting,
  getMatchForDuplicateSightingState
} from '../../../utils/duplicate-status';
import { buildSimilarMatchView, renderSimilarDiff } from './similar-diff';

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

    if (!state) return;

    if ('checking' in state) {
      this.container.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div>';
      this.container.title = 'Checking for duplicates...';
      return;
    }

    const { result } = state;
    const similarView = capturedText
      ? buildSimilarMatchView(result, capturedText, tweetDate)
      : null;
    if (similarView?.diff) {
      renderSimilarDiff(this.container, similarView);
      if (similarView.existingQuoteUrl) {
        this.callbacks.onSubmitStateChange({
          type: 'view_quote',
          url: similarView.existingQuoteUrl,
          text: 'View Quote',
        });
      }
      return;
    }

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

  private renderBadge(cssClass: string, icon: string, text: string, linkUrl?: string): void {
    this.container.className = `duplicate-badge badge ${cssClass}`;
    this.container.style.marginLeft = '8px';

    if (linkUrl) {
      this.container.innerHTML = `<a href="${this.escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">${icon} ${this.escapeHtml(text)} ↗</a>`;
    } else {
      this.container.innerHTML = `${icon} ${this.escapeHtml(text)}`;
    }
  }

  private getQuotePageUrl(match?: DuplicateCheckResult['matches'][number]): string | undefined {
    if (!match) return undefined;
    if (match.url) return match.url;
    if (!match.short_code) return undefined;

    const baseUrl = getWebBaseUrl().replace(/\/+$/, '');
    return `${baseUrl}/quotes/${encodeURIComponent(match.short_code)}`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
