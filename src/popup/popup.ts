/**
 * Popup interface for Quotewise Chrome extension
 */

import { 
  MessageType, 
  TwitterData, 
  ExtensionMessage,
  QuoteSubmissionRequest,
  AttributionType
} from '../types/index';

class QuotewisePopup {
  private tweetData: TwitterData | null = null;
  private selectedOriginator: any = null;
  private isDuplicateChecked = false;

  constructor() {
    this.init();
  }

  /**
   * Initialize the popup interface
   */
  private async init(): Promise<void> {
    console.log('Initializing Quotewise popup');
    
    this.setupEventListeners();
    await this.checkAuthStatus();
    await this.loadTweetData();
  }

  /**
   * Set up event listeners for UI interactions
   */
  private setupEventListeners(): void {
    // Login button
    const loginButton = document.getElementById('login-button');
    loginButton?.addEventListener('click', this.handleLogin.bind(this));

    // Originator search
    const originatorSearch = document.getElementById('originator-search') as HTMLInputElement;
    originatorSearch?.addEventListener('input', this.debounce(this.handleOriginatorSearch.bind(this), 300));

    // Duplicate check
    const checkDuplicateButton = document.getElementById('check-duplicate');
    checkDuplicateButton?.addEventListener('click', this.handleDuplicateCheck.bind(this));

    // Submit quote
    const submitButton = document.getElementById('submit-quote');
    submitButton?.addEventListener('click', this.handleSubmitQuote.bind(this));

    // Retry button
    const retryButton = document.getElementById('retry-button');
    retryButton?.addEventListener('click', this.init.bind(this));

    // Close button
    const closeButton = document.getElementById('close-button');
    closeButton?.addEventListener('click', () => window.close());

    // Quote text changes
    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    quoteTextArea?.addEventListener('input', this.handleQuoteTextChange.bind(this));
  }

  /**
   * Check authentication status
   */
  private async checkAuthStatus(): Promise<void> {
    try {
      this.showSection('loading-state');
      this.setLoadingMessage('Checking authentication...');

      const response = await this.sendMessage({
        type: MessageType.CHECK_AUTH_STATUS
      });

      if (response.isAuthenticated) {
        this.showSection('quote-capture');
      } else {
        this.showSection('auth-required');
      }

      this.setStatus('Ready', 'status-ready');
    } catch (error) {
      console.error('Error checking auth status:', error);
      this.showError('Failed to check authentication status');
    }
  }

  /**
   * Load tweet data from current tab
   */
  private async loadTweetData(): Promise<void> {
    try {
      const response = await this.sendMessage({
        type: MessageType.GET_TWEET_DATA
      });

      if (response.success && response.data) {
        this.tweetData = response.data;
        this.populateQuoteData();
      } else {
        this.showError('No tweet data found. Make sure you are on a tweet page.');
      }
    } catch (error) {
      console.error('Error loading tweet data:', error);
      this.showError('Failed to load tweet data');
    }
  }

  /**
   * Populate the form with tweet data
   */
  private populateQuoteData(): void {
    if (!this.tweetData) return;

    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    if (quoteTextArea) {
      quoteTextArea.value = this.tweetData.text;
    }

    // Pre-populate originator search with author info
    const originatorSearch = document.getElementById('originator-search') as HTMLInputElement;
    if (originatorSearch && this.tweetData.author?.displayName) {
      originatorSearch.placeholder = `Try: ${this.tweetData.author.displayName}`;
    }

    this.validateForm();
  }

  /**
   * Handle login button click
   */
  private handleLogin(): void {
    // Open Quotewise login page in new tab
    chrome.tabs.create({
      url: 'https://quotosaurus.com/accounts/login/',
      active: true
    });
  }

  /**
   * Handle originator search
   */
  private async handleOriginatorSearch(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const query = input.value.trim();

    if (query.length < 2) {
      this.hideOriginatorResults();
      return;
    }

    try {
      // This will be implemented when API client is ready
      console.log('Searching for originator:', query);
      
      // Mock results for now
      this.showOriginatorResults([
        {
          id: '1',
          full_name: 'Winston Churchill',
          sort_name: 'Churchill, Winston',
          birth_year: 1874,
          death_year: 1965,
          quote_count: 150
        }
      ]);
    } catch (error) {
      console.error('Error searching originators:', error);
    }
  }

  /**
   * Show originator search results
   */
  private showOriginatorResults(results: any[]): void {
    const resultsContainer = document.getElementById('originator-results');
    if (!resultsContainer) return;

    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="search-result">No originators found</div>';
      resultsContainer.classList.remove('hidden');
      return;
    }

    resultsContainer.innerHTML = results.map(originator => `
      <div class="search-result" data-id="${originator.id}">
        <div class="search-result-name">${originator.full_name}</div>
        <div class="search-result-details">
          ${originator.birth_year || '?'} - ${originator.death_year || 'present'}
          ${originator.quote_count ? ` • ${originator.quote_count} quotes` : ''}
        </div>
      </div>
    `).join('');

    // Add click listeners
    resultsContainer.querySelectorAll('.search-result').forEach(result => {
      result.addEventListener('click', () => {
        const id = result.getAttribute('data-id');
        const originator = results.find(o => o.id === id);
        if (originator) {
          this.selectOriginator(originator);
        }
      });
    });

    resultsContainer.classList.remove('hidden');
  }

  /**
   * Hide originator search results
   */
  private hideOriginatorResults(): void {
    const resultsContainer = document.getElementById('originator-results');
    resultsContainer?.classList.add('hidden');
  }

  /**
   * Select an originator
   */
  private selectOriginator(originator: any): void {
    this.selectedOriginator = originator;
    
    // Hide search results
    this.hideOriginatorResults();
    
    // Show selected originator
    const selectedContainer = document.getElementById('selected-originator');
    if (selectedContainer) {
      selectedContainer.innerHTML = `
        <div class="selected-name">${originator.full_name}</div>
        <button class="selected-remove" type="button">&times;</button>
      `;
      
      selectedContainer.classList.remove('hidden');
      
      // Add remove listener
      const removeButton = selectedContainer.querySelector('.selected-remove');
      removeButton?.addEventListener('click', this.clearSelectedOriginator.bind(this));
    }
    
    // Clear search input
    const searchInput = document.getElementById('originator-search') as HTMLInputElement;
    if (searchInput) {
      searchInput.value = '';
    }
    
    this.validateForm();
  }

  /**
   * Clear selected originator
   */
  private clearSelectedOriginator(): void {
    this.selectedOriginator = null;
    
    const selectedContainer = document.getElementById('selected-originator');
    selectedContainer?.classList.add('hidden');
    
    this.validateForm();
  }

  /**
   * Handle duplicate check
   */
  private async handleDuplicateCheck(): Promise<void> {
    try {
      const quoteText = (document.getElementById('quote-text') as HTMLTextAreaElement)?.value;
      if (!quoteText) return;

      this.setLoadingMessage('Checking for duplicates...');
      this.showSection('loading-state');

      // This will be implemented when API client is ready
      console.log('Checking for duplicates:', {
        text: quoteText,
        originatorId: this.selectedOriginator?.id
      });

      // Mock response for now
      setTimeout(() => {
        this.isDuplicateChecked = true;
        this.showSection('quote-capture');
        this.validateForm();
      }, 1000);

    } catch (error) {
      console.error('Error checking duplicates:', error);
      this.showError('Failed to check for duplicates');
    }
  }

  /**
   * Handle quote submission
   */
  private async handleSubmitQuote(): Promise<void> {
    try {
      if (!this.tweetData) {
        this.showError('No tweet data available');
        return;
      }

      const quoteText = (document.getElementById('quote-text') as HTMLTextAreaElement)?.value;
      const attributionType = (document.getElementById('attribution-type') as HTMLSelectElement)?.value as AttributionType;

      if (!quoteText) {
        this.showError('Quote text is required');
        return;
      }

      this.setLoadingMessage('Submitting quote...');
      this.showSection('loading-state');

      const submissionData: QuoteSubmissionRequest = {
        quote_text: quoteText,
        originator_id: this.selectedOriginator?.id,
        sighting_url: this.tweetData.url,
        platform_code: 'TX',
        likes_count: this.tweetData.likes || 0,
        post_date: this.tweetData.date || undefined,
        attribution_type: attributionType,
        platform_data: this.tweetData.platform_data
      };

      const response = await this.sendMessage({
        type: MessageType.SUBMIT_QUOTE,
        data: submissionData
      });

      if (response.success) {
        this.showSuccess('Quote added successfully!');
      } else {
        this.showError(response.error || 'Failed to submit quote');
      }

    } catch (error) {
      console.error('Error submitting quote:', error);
      this.showError('Failed to submit quote');
    }
  }

  /**
   * Handle quote text changes
   */
  private handleQuoteTextChange(): void {
    this.isDuplicateChecked = false;
    this.validateForm();
  }

  /**
   * Validate form and update UI state
   */
  private validateForm(): void {
    const quoteText = (document.getElementById('quote-text') as HTMLTextAreaElement)?.value;
    const submitButton = document.getElementById('submit-quote') as HTMLButtonElement;
    const checkDuplicateButton = document.getElementById('check-duplicate') as HTMLButtonElement;

    const hasQuoteText = !!quoteText?.trim();
    const canSubmit = hasQuoteText && this.isDuplicateChecked;

    if (submitButton) {
      submitButton.disabled = !canSubmit;
    }

    if (checkDuplicateButton) {
      checkDuplicateButton.disabled = !hasQuoteText;
    }
  }

  /**
   * Show a specific section and hide others
   */
  private showSection(sectionId: string): void {
    const sections = ['auth-required', 'quote-capture', 'error-state', 'success-state', 'loading-state'];
    
    sections.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        if (id === sectionId) {
          element.classList.remove('hidden');
        } else {
          element.classList.add('hidden');
        }
      }
    });
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    const errorMessage = document.getElementById('error-message');
    if (errorMessage) {
      errorMessage.textContent = message;
    }
    this.showSection('error-state');
    this.setStatus('Error', 'status-error');
  }

  /**
   * Show success message
   */
  private showSuccess(message: string): void {
    const successMessage = document.getElementById('success-message');
    if (successMessage) {
      successMessage.textContent = message;
    }
    this.showSection('success-state');
    this.setStatus('Success', 'status-success');
  }

  /**
   * Set loading message
   */
  private setLoadingMessage(message: string): void {
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
      loadingMessage.textContent = message;
    }
  }

  /**
   * Set status indicator
   */
  private setStatus(text: string, className: string): void {
    const statusText = document.getElementById('status-text');
    const statusIndicator = document.getElementById('status-indicator');
    
    if (statusText) {
      statusText.textContent = text;
    }
    
    if (statusIndicator) {
      statusIndicator.className = `status ${className}`;
    }
  }

  /**
   * Send message to background script
   */
  private sendMessage(message: ExtensionMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  /**
   * Debounce utility function
   */
  private debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new QuotewisePopup();
});