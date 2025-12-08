/**
 * Handle Lookup Display Component
 * Renders the status row for originator lookup by handle
 */

import type { HandleLookupState } from './handle-lookup';
import { debugLog } from '../config/environment';

export interface HandleLookupDisplayOptions {
  container: HTMLElement;
  onSelectOriginator?: () => void;
  onDismiss?: () => void;
}

/**
 * HandleLookupDisplay renders the UI for the handle lookup status row
 */
export class HandleLookupDisplay {
  private container: HTMLElement;
  private onSelectOriginator?: () => void;
  private onDismiss?: () => void;

  constructor(options: HandleLookupDisplayOptions) {
    this.container = options.container;
    this.onSelectOriginator = options.onSelectOriginator;
    this.onDismiss = options.onDismiss;
  }

  /**
   * Update display based on lookup state
   */
  updateDisplay(state: HandleLookupState): void {
    if (state.isLooking) {
      this.renderLooking(state.matchedHandle);
    } else if (state.hasLookedUp && state.result) {
      this.renderResult(state);
    } else {
      this.renderEmpty();
    }
  }

  /**
   * Render loading state
   */
  private renderLooking(handle: string | null): void {
    this.container.innerHTML = `
      <div class="handle-lookup-status looking">
        <div class="lookup-spinner"></div>
        <span class="lookup-text">Looking up @${this.escapeHtml(handle || '')}...</span>
      </div>
    `;
    this.container.classList.remove('hidden');
  }

  /**
   * Render lookup result
   */
  private renderResult(state: HandleLookupState): void {
    const { result, matchedOriginator, createUrl, matchedHandle, errorMessage } = state;

    let html = '';

    switch (result) {
      case 'found':
        html = `
          <div class="handle-lookup-status found">
            <div class="lookup-header">
              <span class="lookup-icon">&#10003;</span>
              <span class="lookup-text">Found: ${this.escapeHtml(matchedOriginator?.full_name || '')}</span>
            </div>
            <div class="lookup-details">
              <span class="handle-match">@${this.escapeHtml(matchedHandle || '')}</span>
              <span class="confidence">${this.escapeHtml(matchedOriginator?.sort_name_display || '')}</span>
            </div>
            <div class="lookup-actions">
              <button class="lookup-action-btn use-originator" data-action="use">
                Use This Originator
              </button>
              <button class="lookup-action-btn dismiss" data-action="dismiss">
                Search Manually
              </button>
            </div>
          </div>
        `;
        break;

      case 'not_found':
        html = `
          <div class="handle-lookup-status not-found">
            <div class="lookup-header">
              <span class="lookup-icon">&#9675;</span>
              <span class="lookup-text">No originator found for @${this.escapeHtml(matchedHandle || '')}</span>
            </div>
            <div class="lookup-actions">
              ${createUrl ? `
                <a href="${this.escapeHtml(createUrl)}" target="_blank" rel="noopener noreferrer" class="lookup-action-btn create-link">
                  Create on Quotosaurus
                </a>
              ` : ''}
              <button class="lookup-action-btn dismiss" data-action="dismiss">
                Search Manually
              </button>
            </div>
          </div>
        `;
        break;

      case 'error':
        html = `
          <div class="handle-lookup-status error">
            <div class="lookup-header">
              <span class="lookup-icon">&#9888;</span>
              <span class="lookup-text">Lookup failed${errorMessage ? `: ${this.escapeHtml(errorMessage)}` : ''}</span>
            </div>
            <div class="lookup-actions">
              <button class="lookup-action-btn dismiss" data-action="dismiss">
                Search Manually
              </button>
            </div>
          </div>
        `;
        break;

      default:
        this.renderEmpty();
        return;
    }

    this.container.innerHTML = html;
    this.container.classList.remove('hidden');
    this.setupEventListeners();
  }

  /**
   * Render empty state
   */
  private renderEmpty(): void {
    this.container.innerHTML = '';
    this.container.classList.add('hidden');
  }

  /**
   * Setup event listeners for action buttons
   */
  private setupEventListeners(): void {
    // Use originator button
    const useBtn = this.container.querySelector('[data-action="use"]');
    if (useBtn && this.onSelectOriginator) {
      useBtn.addEventListener('click', (e) => {
        e.preventDefault();
        debugLog('Use originator clicked');
        this.onSelectOriginator!();
      });
    }

    // Dismiss button(s)
    const dismissBtns = this.container.querySelectorAll('[data-action="dismiss"]');
    dismissBtns.forEach(btn => {
      if (this.onDismiss) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          debugLog('Dismiss lookup clicked');
          this.onDismiss!();
        });
      }
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Update container reference (for dynamic container creation)
   */
  setContainer(container: HTMLElement): void {
    this.container = container;
  }
}
