import type { DuplicateCheckResult } from '../../../types/api';

export interface SubmitStateDirective {
  enabled: boolean;
  text: string;
  style?: 'success' | 'warning';
}

export interface DuplicateBadgeCallbacks {
  onSubmitStateChange: (directive: SubmitStateDirective) => void;
}

export class DuplicateBadge {
  constructor(
    private container: HTMLElement,
    private callbacks: DuplicateBadgeCallbacks
  ) {}

  update(state: { checking: true } | { result: DuplicateCheckResult } | null): void {
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
    const firstMatch = result.matches?.[0];
    const sightingStatus = firstMatch?.sighting_status;

    if (sightingStatus === 'exact_url') {
      this.renderBadge('success', '🟢', 'Already captured', firstMatch?.url);
      this.container.title = 'This exact URL is already in Quotewise';
      this.callbacks.onSubmitStateChange({ enabled: false, text: 'Already Captured' });
    } else if (sightingStatus === 'has_platform_sighting') {
      this.renderBadge('warning', '🟡', 'Platform sighting exists', firstMatch?.url);
      this.container.title = 'A Twitter sighting exists for this quote - you can add another if needed';
      this.callbacks.onSubmitStateChange({ enabled: true, text: 'Add Another Sighting', style: 'warning' });
    } else if (sightingStatus === 'no_platform_sighting') {
      this.renderBadge('info', '🔵', 'Add sighting');
      this.container.title = 'Quote exists but no Twitter sighting yet - adding this will create one';
    } else if (result.recommendation === 'duplicate') {
      this.renderBadge('warning', '⚠️', 'Duplicate');
      this.container.title = result.reasoning || 'This quote may already exist';
    } else if (result.recommendation === 'new_version') {
      this.renderBadge('info', 'ℹ️', 'New version');
      this.container.title = result.reasoning || 'Similar quote exists - will create new version';
    } else if (result.in_quotewise) {
      this.renderBadge('success', '✓', 'In Quotewise');
      this.container.title = 'Quote already in collection';
    }
    // No badge for new_quote — that's the expected case
  }

  private renderBadge(cssClass: string, icon: string, text: string, linkUrl?: string): void {
    this.container.className = `duplicate-badge badge ${cssClass}`;
    this.container.style.marginLeft = '8px';

    if (linkUrl) {
      this.container.innerHTML = `<a href="${this.escapeHtml(linkUrl)}" target="_blank" style="color:inherit;text-decoration:none;">${icon} ${this.escapeHtml(text)} ↗</a>`;
    } else {
      this.container.innerHTML = `${icon} ${this.escapeHtml(text)}`;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
