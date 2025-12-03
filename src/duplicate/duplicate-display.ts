/**
 * Duplicate Display Component
 * Renders duplicate checking results with visual feedback and user interactions
 */

import type { DuplicateCheckResult } from '../types/api';
import type { DuplicateState } from './duplicate-checker';
import { debugLog } from '../config/environment';

export interface DuplicateDisplayOptions {
  container: HTMLElement;
  onOverride?: () => void;
  onEditQuote?: () => void;
  onChangeOriginator?: () => void;
}

export class DuplicateDisplay {
  private container: HTMLElement;
  private onOverride?: () => void;
  private onEditQuote?: () => void;
  private onChangeOriginator?: () => void;

  constructor(options: DuplicateDisplayOptions) {
    this.container = options.container;
    this.onOverride = options.onOverride;
    this.onEditQuote = options.onEditQuote;
    this.onChangeOriginator = options.onChangeOriginator;
  }

  /**
   * Update display based on duplicate checking state
   */
  updateDisplay(state: DuplicateState): void {
    if (state.isChecking) {
      this.renderChecking();
    } else if (state.hasChecked && state.result) {
      this.renderResults(state.result, state.userOverride);
    } else {
      this.renderEmpty();
    }
  }

  /**
   * Render checking state
   */
  private renderChecking(): void {
    this.container.innerHTML = `
      <div class="duplicate-checking">
        <div class="checking-spinner"></div>
        <span class="checking-text">Checking for duplicates...</span>
      </div>
    `;
    this.container.classList.remove('hidden');
  }

  /**
   * Render duplicate check results
   */
  private renderResults(result: DuplicateCheckResult, userOverride: boolean): void {
    const display = this.getRecommendationDisplay(result.recommendation);
    if (!display) {
      this.renderEmpty();
      return;
    }

    this.container.innerHTML = `
      <div class="duplicate-results ${display.cssClass}">
        <div class="recommendation-header">
          <span class="recommendation-icon">${display.icon}</span>
          <span class="recommendation-text">${display.text}</span>
          <span class="confidence-score">${Math.round(result.confidence * 100)}%</span>
        </div>
        
        ${result.reasoning ? `
          <div class="recommendation-reasoning">
            ${this.escapeHtml(result.reasoning)}
          </div>
        ` : ''}

        ${result.matches.length > 0 ? this.renderMatches(result.matches) : ''}
        
        ${this.renderActions(result.recommendation, userOverride)}
      </div>
    `;

    this.container.classList.remove('hidden');
    this.setupEventListeners();
  }

  /**
   * Render matches section
   */
  private renderMatches(matches: DuplicateCheckResult['matches']): string {
    const maxDisplayMatches = 3;
    const displayMatches = matches.slice(0, maxDisplayMatches);
    const hasMore = matches.length > maxDisplayMatches;

    return `
      <div class="duplicate-matches">
        <div class="matches-header">
          <span class="matches-count">${matches.length} similar quote${matches.length !== 1 ? 's' : ''} found:</span>
        </div>
        <div class="matches-list">
          ${displayMatches.map(match => this.renderMatch(match)).join('')}
          ${hasMore ? `
            <div class="matches-more">
              <button class="show-more-btn" data-action="show-more">
                Show ${matches.length - maxDisplayMatches} more...
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Render individual match
   */
  private renderMatch(match: DuplicateCheckResult['matches'][0]): string {
    const similarityPercentage = Math.round(match.similarity * 100);
    const similarityClass = this.getSimilarityClass(similarityPercentage);

    return `
      <div class="duplicate-match">
        <div class="match-header">
          <span class="similarity-badge ${similarityClass}">
            ${similarityPercentage}%
          </span>
          <span class="match-type">${this.formatMatchType(match.match_type)}</span>
          <span class="workflow-status ${match.workflow_status.toLowerCase()}">
            ${this.formatWorkflowStatus(match.workflow_status)}
          </span>
        </div>
        
        <div class="match-content">
          <div class="match-text">
            "${this.escapeHtml(this.truncateText(match.text, 150))}"
          </div>
          <div class="match-attribution">
            <span class="originator-name">— ${this.escapeHtml(match.originator.full_name)}</span>
            ${match.likes_count > 0 ? `
              <span class="likes-count">❤️ ${match.likes_count}</span>
            ` : ''}
          </div>
        </div>
        
        <div class="match-actions">
          <button class="view-details-btn" data-action="view-details" data-quote-id="${match.quote_id}">
            View Details
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render action buttons based on recommendation
   */
  private renderActions(recommendation: string, userOverride: boolean): string {
    switch (recommendation) {
      case 'new_quote':
        return `
          <div class="duplicate-actions success">
            <div class="action-message">
              ✅ This appears to be a new quote. You can proceed with submission.
            </div>
          </div>
        `;

      case 'new_version':
        return `
          <div class="duplicate-actions warning">
            <div class="action-message">
              ⚠️ Similar quote found with different attribution. Review recommended.
            </div>
            <div class="action-buttons">
              <button class="edit-quote-btn" data-action="edit-quote">
                Edit Quote
              </button>
              <button class="change-originator-btn" data-action="change-originator">
                Change Originator
              </button>
            </div>
          </div>
        `;

      case 'duplicate':
        if (userOverride) {
          return `
            <div class="duplicate-actions override">
              <div class="action-message">
                ⚠️ You've chosen to proceed despite the duplicate warning.
              </div>
            </div>
          `;
        } else {
          return `
            <div class="duplicate-actions error">
              <div class="action-message">
                🚫 Duplicate quote detected. Submission not recommended.
              </div>
              <div class="action-buttons">
                <button class="edit-quote-btn" data-action="edit-quote">
                  Edit Quote
                </button>
                <button class="change-originator-btn" data-action="change-originator">
                  Change Originator
                </button>
                <button class="override-btn" data-action="override">
                  Add Anyway
                </button>
              </div>
            </div>
          `;
        }

      default:
        return '';
    }
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
    // Override button
    const overrideBtn = this.container.querySelector('[data-action="override"]');
    if (overrideBtn && this.onOverride) {
      overrideBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.confirmOverride()) {
          this.onOverride!();
        }
      });
    }

    // Edit quote button
    const editBtn = this.container.querySelector('[data-action="edit-quote"]');
    if (editBtn && this.onEditQuote) {
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onEditQuote!();
      });
    }

    // Change originator button
    const changeOriginatorBtn = this.container.querySelector('[data-action="change-originator"]');
    if (changeOriginatorBtn && this.onChangeOriginator) {
      changeOriginatorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onChangeOriginator!();
      });
    }

    // Show more button
    const showMoreBtn = this.container.querySelector('[data-action="show-more"]');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // Expand/collapse functionality: toggle visibility of all matches
        const matchesList = this.container.querySelector('.matches-list');
        if (matchesList) {
          matchesList.classList.toggle('expanded');
          showMoreBtn.textContent = matchesList.classList.contains('expanded') ? 'Show less' : 'Show more';
        }
        debugLog('Show more matches clicked');
      });
    }

    // View details buttons
    this.container.querySelectorAll('[data-action="view-details"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const quoteId = (btn as HTMLElement).dataset.quoteId;
        if (quoteId) {
          // Open quote detail on quotosaurus.com in new tab
          const quoteUrl = `https://quotosaurus.com/quotes/${quoteId}/`;
          window.open(quoteUrl, '_blank');
          debugLog('View details clicked for quote:', quoteId);
        }
      });
    });
  }

  /**
   * Show confirmation dialog for override action
   */
  private confirmOverride(): boolean {
    return confirm(
      'Are you sure you want to add this quote even though it appears to be a duplicate? ' +
      'This may create redundant entries in the database.'
    );
  }

  /**
   * Get recommendation display properties
   */
  private getRecommendationDisplay(recommendation: string): {
    icon: string;
    text: string;
    cssClass: string;
  } | null {
    switch (recommendation) {
      case 'new_quote':
        return {
          icon: '✅',
          text: 'New quote',
          cssClass: 'recommendation-success'
        };
      case 'new_version':
        return {
          icon: '⚠️',
          text: 'New version',
          cssClass: 'recommendation-warning'
        };
      case 'duplicate':
        return {
          icon: '🚫',
          text: 'Duplicate',
          cssClass: 'recommendation-error'
        };
      default:
        return null;
    }
  }

  /**
   * Get CSS class for similarity percentage
   */
  private getSimilarityClass(percentage: number): string {
    if (percentage >= 95) {
      return 'similarity-exact';
    } else if (percentage >= 80) {
      return 'similarity-high';
    } else if (percentage >= 60) {
      return 'similarity-medium';
    } else {
      return 'similarity-low';
    }
  }

  /**
   * Format match type for display
   */
  private formatMatchType(matchType: string): string {
    switch (matchType.toLowerCase()) {
      case 'exact':
        return 'Exact match';
      case 'semantic':
        return 'Semantic match';
      case 'fuzzy':
        return 'Fuzzy match';
      default:
        return matchType;
    }
  }

  /**
   * Format workflow status for display
   */
  private formatWorkflowStatus(status: string): string {
    switch (status.toLowerCase()) {
      case 'approved':
        return 'Approved';
      case 'pending':
        return 'Pending';
      case 'rejected':
        return 'Rejected';
      case 'admin_reviewed':
        return 'Admin Reviewed';
      default:
        return status;
    }
  }

  /**
   * Truncate text with ellipsis
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}