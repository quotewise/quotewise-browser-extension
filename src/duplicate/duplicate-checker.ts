/**
 * Duplicate Checker Component
 * Manages duplicate check state and API calls for quote submission
 */

import type { DuplicateCheckResult } from '../types/api';
import { apiClient } from '../api/quotewise-api';
import { debounce } from '../utils/debounce';

export interface DuplicateState {
  isChecking: boolean;
  hasChecked: boolean;
  result: DuplicateCheckResult | null;
  userOverride: boolean;
  lastCheckText: string;
  lastCheckOriginator: string;
  lastCheckUrl: string;
}

export type DuplicateStateListener = (state: DuplicateState) => void;

export class DuplicateChecker {
  private state: DuplicateState;
  private listeners: DuplicateStateListener[] = [];
  private debouncedCheck: (text: string, originatorId?: string, sourceUrl?: string, socialHandle?: string) => void;

  constructor(private debounceDelay: number = 1000) {
    this.state = {
      isChecking: false,
      hasChecked: false,
      result: null,
      userOverride: false,
      lastCheckText: '',
      lastCheckOriginator: '',
      lastCheckUrl: ''
    };

    // Create debounced check function for automatic checking
    this.debouncedCheck = debounce(
      this.performDuplicateCheck.bind(this),
      this.debounceDelay
    );
  }

  /**
   * Add state change listener
   */
  addListener(listener: DuplicateStateListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get current duplicate checking state
   */
  getState(): DuplicateState {
    return { ...this.state };
  }

  /**
   * Check if submission should be allowed based on current state
   */
  canSubmit(): boolean {
    if (!this.state.hasChecked) {
      return false;
    }

    if (!this.state.result) {
      return false;
    }

    // Check sighting status on top match (if any)
    const topMatch = this.state.result.matches[0];
    if (topMatch) {
      // Block entirely if exact URL already captured
      if (topMatch.sighting_status === 'exact_url') {
        return false;
      }

      // Require confirmation if platform sighting exists
      if (topMatch.sighting_status === 'has_platform_sighting' && !this.state.userOverride) {
        return false;
      }
    }

    // Allow submission for new_quote and new_version
    if (this.state.result.recommendation === 'new_quote' ||
        this.state.result.recommendation === 'new_version') {
      return true;
    }

    // Allow submission for duplicate if user has overridden
    if (this.state.result.recommendation === 'duplicate' && this.state.userOverride) {
      return true;
    }

    return false;
  }

  /**
   * Get the sighting status of the top match (if any)
   */
  getTopMatchSightingStatus(): string | undefined {
    return this.state.result?.matches[0]?.sighting_status;
  }

  /**
   * Check if the top match blocks submission due to exact URL
   */
  isExactUrlMatch(): boolean {
    return this.getTopMatchSightingStatus() === 'exact_url';
  }

  /**
   * Check if the top match requires confirmation due to platform sighting
   */
  requiresPlatformConfirmation(): boolean {
    return this.getTopMatchSightingStatus() === 'has_platform_sighting' && !this.state.userOverride;
  }

  /**
   * Check if we need to re-check duplicates (content has changed)
   */
  needsRecheck(quoteText: string, originatorId?: string, sourceUrl?: string): boolean {
    return (
      this.state.lastCheckText !== quoteText ||
      this.state.lastCheckOriginator !== (originatorId || '') ||
      this.state.lastCheckUrl !== (sourceUrl || '')
    );
  }

  /**
   * Perform immediate duplicate check (for manual trigger)
   */
  async checkForDuplicates(
    quoteText: string, 
    originatorId?: string, 
    sourceUrl?: string,
    socialHandle?: string
  ): Promise<void> {
    await this.performDuplicateCheck(quoteText, originatorId, sourceUrl, socialHandle);
  }

  /**
   * Trigger automatic duplicate check with debouncing
   */
  checkForDuplicatesDebounced(
    quoteText: string, 
    originatorId?: string, 
    sourceUrl?: string,
    socialHandle?: string
  ): void {
    // Reset user override when content changes
    if (this.needsRecheck(quoteText, originatorId, sourceUrl)) {
      this.updateState({
        userOverride: false,
        hasChecked: false
      });
    }

    this.debouncedCheck(quoteText, originatorId, sourceUrl, socialHandle);
  }

  /**
   * Allow user to override duplicate warning
   */
  overrideRecommendation(): void {
    if (this.state.result?.recommendation === 'duplicate') {
      this.updateState({
        userOverride: true
      });
    }
  }

  /**
   * Reset duplicate checking state
   */
  reset(): void {
    this.state = {
      isChecking: false,
      hasChecked: false,
      result: null,
      userOverride: false,
      lastCheckText: '',
      lastCheckOriginator: '',
      lastCheckUrl: ''
    };
    this.notifyListeners();
  }

  /**
   * Get recommendation display properties
   */
  getRecommendationDisplay(): {
    color: 'green' | 'yellow' | 'red';
    icon: string;
    text: string;
    allowSubmit: boolean;
  } | null {
    if (!this.state.result) {
      return null;
    }

    switch (this.state.result.recommendation) {
      case 'new_quote':
        return {
          color: 'green',
          icon: '✅',
          text: 'New quote',
          allowSubmit: true
        };
      case 'new_version':
        return {
          color: 'yellow',
          icon: '⚠️',
          text: 'New version',
          allowSubmit: true
        };
      case 'duplicate':
        return {
          color: 'red',
          icon: '🚫',
          text: 'Duplicate',
          allowSubmit: this.state.userOverride
        };
      default:
        return null;
    }
  }

  /**
   * Get similarity percentage for display
   */
  getHighestSimilarity(): number {
    if (!this.state.result?.matches.length) {
      return 0;
    }

    return Math.max(...this.state.result.matches.map(match => match.similarity));
  }

  /**
   * Get formatted similarity display
   */
  getSimilarityDisplay(): string {
    const similarity = this.getHighestSimilarity();
    const percentage = Math.round(similarity * 100);
    
    if (percentage >= 95) {
      return `${percentage}% (Exact)`;
    } else if (percentage >= 80) {
      return `${percentage}% (Very similar)`;
    } else if (percentage >= 60) {
      return `${percentage}% (Similar)`;
    } else {
      return `${percentage}% (Low similarity)`;
    }
  }

  /**
   * Core duplicate check implementation
   */
  private async performDuplicateCheck(
    quoteText: string, 
    originatorId?: string, 
    sourceUrl?: string,
    socialHandle?: string
  ): Promise<void> {
    if (!quoteText.trim()) {
      return;
    }

    // Skip if we already checked this exact combination
    if (!this.needsRecheck(quoteText, originatorId, sourceUrl) && this.state.hasChecked) {
      return;
    }

    this.updateState({
      isChecking: true,
      userOverride: false
    });

    try {
      const result = await apiClient.checkQuoteDuplicate(
        quoteText.trim(),
        originatorId,
        sourceUrl,
        socialHandle
      );

      this.updateState({
        isChecking: false,
        hasChecked: true,
        result,
        lastCheckText: quoteText,
        lastCheckOriginator: originatorId || '',
        lastCheckUrl: sourceUrl || ''
      });

    } catch (error) {
      console.error('Error checking duplicates:', error);
      
      // Set a default "new_quote" result on error to allow submission
      this.updateState({
        isChecking: false,
        hasChecked: true,
        result: {
          recommendation: 'new_quote',
          confidence: 0.5,
          in_quotewise: false,
          matches: [],
          reasoning: 'Error occurred during duplicate check, proceeding as new quote',
          search_metadata: { error: true }
        },
        lastCheckText: quoteText,
        lastCheckOriginator: originatorId || '',
        lastCheckUrl: sourceUrl || ''
      });
    }
  }

  /**
   * Update state and notify listeners
   */
  private updateState(updates: Partial<DuplicateState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('Error in duplicate state listener:', error);
      }
    });
  }
}