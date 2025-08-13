/**
 * Originator Search Component for Quotewise Chrome Extension
 * Handles real-time originator search with debouncing and selection management
 */

import type { OriginatorSearchResult } from '../types/api';
import { MessageType } from '../types/chrome';
import { debounce, DebouncedFunction } from '../utils/debounce';

export interface SearchHistoryItem {
  originator: OriginatorSearchResult;
  searchedAt: Date;
  useCount: number;
}

export interface OriginatorSearchOptions {
  minQueryLength?: number;
  debounceDelay?: number;
  maxResults?: number;
  maxHistoryItems?: number;
  storageKey?: string;
}

export interface SearchState {
  isSearching: boolean;
  query: string;
  results: OriginatorSearchResult[];
  selectedOriginator: OriginatorSearchResult | null;
  error: string | null;
  showResults: boolean;
  selectedIndex: number; // For keyboard navigation
}

/**
 * Originator Search Component
 * Provides real-time search functionality for originators with history tracking
 */
export class OriginatorSearch {
  private options: Required<OriginatorSearchOptions>;
  private state: SearchState;
  private searchHistory: SearchHistoryItem[] = [];
  private debouncedSearch: DebouncedFunction<(query: string) => void>;
  private listeners: Array<(state: SearchState) => void> = [];

  // DOM element references
  private searchInput: HTMLInputElement | null = null;
  private resultsContainer: HTMLElement | null = null;
  private selectedContainer: HTMLElement | null = null;
  private historyContainer: HTMLElement | null = null;
  private loadingIndicator: HTMLElement | null = null;

  constructor(options: OriginatorSearchOptions = {}) {
    this.options = {
      minQueryLength: options.minQueryLength ?? 2,
      debounceDelay: options.debounceDelay ?? 300,
      maxResults: options.maxResults ?? 10,
      maxHistoryItems: options.maxHistoryItems ?? 5,
      storageKey: options.storageKey ?? 'quotewise-originator-history'
    };

    this.state = {
      isSearching: false,
      query: '',
      results: [],
      selectedOriginator: null,
      error: null,
      showResults: false,
      selectedIndex: -1
    };

    // Create debounced search function
    this.debouncedSearch = debounce(
      this.performSearch.bind(this),
      this.options.debounceDelay
    );

    // Load search history from storage
    this.loadSearchHistory();
  }

  /**
   * Initialize the search component with DOM elements
   */
  initialize(elements: {
    searchInput: HTMLInputElement;
    resultsContainer: HTMLElement;
    selectedContainer: HTMLElement;
    historyContainer?: HTMLElement;
    loadingIndicator?: HTMLElement;
  }): void {
    this.searchInput = elements.searchInput;
    this.resultsContainer = elements.resultsContainer;
    this.selectedContainer = elements.selectedContainer;
    this.historyContainer = elements.historyContainer || null;
    this.loadingIndicator = elements.loadingIndicator || null;

    this.setupEventListeners();
    this.renderSearchHistory();
    this.updateUI();
  }

  /**
   * Setup event listeners for search interactions
   */
  private setupEventListeners(): void {
    if (!this.searchInput) return;

    // Input event for real-time search
    this.searchInput.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value.trim();
      this.handleSearchInput(query);
    });

    // Keyboard navigation
    this.searchInput.addEventListener('keydown', (e) => {
      this.handleKeyNavigation(e);
    });

    // Focus events
    this.searchInput.addEventListener('focus', () => {
      if (this.state.results.length > 0 || this.searchHistory.length > 0) {
        this.setState({ showResults: true });
      }
    });

    // Click outside to close results
    document.addEventListener('click', (e) => {
      if (!this.isElementInSearch(e.target as HTMLElement)) {
        this.setState({ showResults: false, selectedIndex: -1 });
      }
    });
  }

  /**
   * Handle search input with debouncing
   */
  private handleSearchInput(query: string): void {
    this.setState({ 
      query, 
      error: null, 
      selectedIndex: -1 
    });

    if (query.length >= this.options.minQueryLength) {
      this.setState({ showResults: true });
      this.debouncedSearch(query);
    } else {
      this.setState({ 
        results: [], 
        isSearching: false,
        showResults: this.searchHistory.length > 0 // Show history if no query
      });
    }
  }

  /**
   * Handle keyboard navigation in search results
   */
  private handleKeyNavigation(e: KeyboardEvent): void {
    const { results, showResults, selectedIndex } = this.state;
    
    if (!showResults) return;

    const totalItems = results.length + (this.searchHistory.length > 0 && this.state.query.length < this.options.minQueryLength ? this.searchHistory.length : 0);
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.setState({ 
          selectedIndex: selectedIndex < totalItems - 1 ? selectedIndex + 1 : 0
        });
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        this.setState({ 
          selectedIndex: selectedIndex > 0 ? selectedIndex - 1 : totalItems - 1
        });
        break;
        
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          if (this.state.query.length >= this.options.minQueryLength) {
            // Select from search results
            const selected = results[selectedIndex];
            if (selected) {
              this.selectOriginator(selected);
            }
          } else {
            // Select from history
            const historyItem = this.searchHistory[selectedIndex];
            if (historyItem) {
              this.selectOriginator(historyItem.originator);
            }
          }
        }
        break;
        
      case 'Escape':
        e.preventDefault();
        this.setState({ showResults: false, selectedIndex: -1 });
        this.searchInput?.blur();
        break;
    }
  }

  /**
   * Perform the actual search via Chrome runtime messaging
   */
  private async performSearch(query: string): Promise<void> {
    this.setState({ isSearching: true, error: null });

    try {
      const response = await new Promise<{ results?: OriginatorSearchResult[]; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({
          type: MessageType.SEARCH_ORIGINATORS,
          data: { query, limit: this.options.maxResults }
        }, resolve);
      });

      if (response.error) {
        this.setState({ 
          error: response.error, 
          results: [], 
          isSearching: false 
        });
      } else {
        this.setState({ 
          results: response.results || [], 
          isSearching: false 
        });
      }
    } catch (error) {
      console.error('Search error:', error);
      this.setState({ 
        error: 'Search failed. Please try again.',
        results: [], 
        isSearching: false 
      });
    }
  }

  /**
   * Select an originator from search results or history
   */
  public selectOriginator(originator: OriginatorSearchResult): void {
    this.setState({ 
      selectedOriginator: originator,
      showResults: false,
      selectedIndex: -1,
      query: originator.full_name
    });

    // Update search input
    if (this.searchInput) {
      this.searchInput.value = originator.full_name;
    }

    // Add to history
    this.addToHistory(originator);

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Clear the selected originator
   */
  public clearSelection(): void {
    this.setState({ 
      selectedOriginator: null,
      query: ''
    });

    if (this.searchInput) {
      this.searchInput.value = '';
      this.searchInput.focus();
    }

    this.notifyListeners();
  }

  /**
   * Add originator to search history
   */
  private addToHistory(originator: OriginatorSearchResult): void {
    // Check if already in history
    const existingIndex = this.searchHistory.findIndex(
      item => item.originator.id === originator.id
    );

    if (existingIndex >= 0) {
      // Move to front and increment use count
      const existing = this.searchHistory[existingIndex];
      existing.useCount++;
      existing.searchedAt = new Date();
      this.searchHistory.splice(existingIndex, 1);
      this.searchHistory.unshift(existing);
    } else {
      // Add new item to front
      this.searchHistory.unshift({
        originator,
        searchedAt: new Date(),
        useCount: 1
      });
    }

    // Limit history size
    this.searchHistory = this.searchHistory.slice(0, this.options.maxHistoryItems);

    // Save to storage
    this.saveSearchHistory();
    this.renderSearchHistory();
  }

  /**
   * Load search history from Chrome storage
   */
  private async loadSearchHistory(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([this.options.storageKey]);
      const stored = result[this.options.storageKey];
      
      if (stored && Array.isArray(stored)) {
        this.searchHistory = stored.map(item => ({
          ...item,
          searchedAt: new Date(item.searchedAt)
        }));
      }
    } catch (error) {
      console.error('Failed to load search history:', error);
    }
  }

  /**
   * Save search history to Chrome storage
   */
  private async saveSearchHistory(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [this.options.storageKey]: this.searchHistory
      });
    } catch (error) {
      console.error('Failed to save search history:', error);
    }
  }

  /**
   * Update component state and trigger UI update
   */
  private setState(updates: Partial<SearchState>): void {
    this.state = { ...this.state, ...updates };
    this.updateUI();
  }

  /**
   * Update the UI based on current state
   */
  private updateUI(): void {
    this.renderResults();
    this.renderSelectedOriginator();
    this.renderLoadingState();
  }

  /**
   * Render search results
   */
  private renderResults(): void {
    if (!this.resultsContainer) return;

    const { results, showResults, isSearching, error, selectedIndex, query } = this.state;

    if (!showResults) {
      this.resultsContainer.classList.add('hidden');
      return;
    }

    this.resultsContainer.classList.remove('hidden');

    let html = '';

    if (isSearching) {
      html = '<div class="search-loading">Searching...</div>';
    } else if (error) {
      html = `<div class="search-error">${error}</div>`;
    } else if (query.length >= this.options.minQueryLength) {
      // Show search results
      if (results.length === 0) {
        html = '<div class="no-results">No originators found</div>';
      } else {
        html = results.map((originator, index) => {
          const confidence = originator.confidence ? `(${originator.confidence.toFixed(1)})` : '';
          const isSelected = index === selectedIndex;
          
          return `
            <div class="search-result ${isSelected ? 'selected' : ''}" data-originator-id="${originator.id}">
              <div class="originator-name">${this.escapeHtml(originator.full_name)}</div>
              <div class="originator-details">
                <span class="sort-name">${this.escapeHtml(originator.sort_name_display)}</span>
                ${confidence ? `<span class="confidence">${confidence}</span>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
    } else if (this.searchHistory.length > 0) {
      // Show search history
      html = '<div class="history-header">Recent selections:</div>' +
        this.searchHistory.map((item, index) => {
          const isSelected = index === selectedIndex;
          
          return `
            <div class="search-result history-item ${isSelected ? 'selected' : ''}" data-originator-id="${item.originator.id}">
              <div class="originator-name">${this.escapeHtml(item.originator.full_name)}</div>
              <div class="originator-details">
                <span class="sort-name">${this.escapeHtml(item.originator.sort_name_display)}</span>
                <span class="use-count">Used ${item.useCount} time${item.useCount !== 1 ? 's' : ''}</span>
              </div>
            </div>
          `;
        }).join('');
    }

    this.resultsContainer.innerHTML = html;

    // Add click handlers
    this.resultsContainer.querySelectorAll('.search-result').forEach((element) => {
      element.addEventListener('click', () => {
        const originatorId = parseInt((element as HTMLElement).dataset.originatorId!);
        
        let originator: OriginatorSearchResult | undefined;
        
        if (query.length >= this.options.minQueryLength) {
          originator = results.find(o => o.id === originatorId);
        } else {
          const historyItem = this.searchHistory.find(h => h.originator.id === originatorId);
          originator = historyItem?.originator;
        }
        
        if (originator) {
          this.selectOriginator(originator);
        }
      });
    });
  }

  /**
   * Render the selected originator display
   */
  private renderSelectedOriginator(): void {
    if (!this.selectedContainer) return;

    const { selectedOriginator } = this.state;

    if (!selectedOriginator) {
      this.selectedContainer.classList.add('hidden');
      return;
    }

    this.selectedContainer.classList.remove('hidden');
    
    const confidence = selectedOriginator.confidence ? 
      `<span class="confidence-score">Confidence: ${selectedOriginator.confidence.toFixed(1)}/10</span>` : '';

    this.selectedContainer.innerHTML = `
      <div class="selected-originator">
        <div class="originator-info">
          <div class="originator-name">${this.escapeHtml(selectedOriginator.full_name)}</div>
          <div class="originator-details">
            <span class="sort-name">${this.escapeHtml(selectedOriginator.sort_name_display)}</span>
            ${confidence}
          </div>
        </div>
        <button type="button" class="clear-selection" title="Clear selection">
          <span class="clear-icon">×</span>
        </button>
      </div>
    `;

    // Add clear button handler
    const clearButton = this.selectedContainer.querySelector('.clear-selection');
    if (clearButton) {
      clearButton.addEventListener('click', () => {
        this.clearSelection();
      });
    }
  }

  /**
   * Render search history in dedicated container
   */
  private renderSearchHistory(): void {
    if (!this.historyContainer || this.searchHistory.length === 0) {
      this.historyContainer?.classList.add('hidden');
      return;
    }

    this.historyContainer.classList.remove('hidden');
    
    const html = this.searchHistory.map(item => `
      <button type="button" class="history-item" data-originator-id="${item.originator.id}">
        <span class="originator-name">${this.escapeHtml(item.originator.full_name)}</span>
        <span class="use-count">${item.useCount}</span>
      </button>
    `).join('');

    this.historyContainer.innerHTML = `
      <div class="history-label">Recent selections:</div>
      <div class="history-items">${html}</div>
    `;

    // Add click handlers
    this.historyContainer.querySelectorAll('.history-item').forEach(button => {
      button.addEventListener('click', () => {
        const originatorId = parseInt((button as HTMLElement).dataset.originatorId!);
        const historyItem = this.searchHistory.find(h => h.originator.id === originatorId);
        
        if (historyItem) {
          this.selectOriginator(historyItem.originator);
        }
      });
    });
  }

  /**
   * Render loading state
   */
  private renderLoadingState(): void {
    if (!this.loadingIndicator) return;

    if (this.state.isSearching) {
      this.loadingIndicator.classList.remove('hidden');
    } else {
      this.loadingIndicator.classList.add('hidden');
    }
  }

  /**
   * Check if an element is part of the search component
   */
  private isElementInSearch(element: HTMLElement): boolean {
    const searchElements = [
      this.searchInput,
      this.resultsContainer,
      this.selectedContainer,
      this.historyContainer
    ].filter(Boolean);

    return searchElements.some(el => 
      el === element || el?.contains(element)
    );
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
   * Add state change listener
   */
  public addListener(listener: (state: SearchState) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove state change listener
   */
  public removeListener(listener: (state: SearchState) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('Error in search listener:', error);
      }
    });
  }

  /**
   * Get current state
   */
  public getState(): SearchState {
    return { ...this.state };
  }

  /**
   * Get selected originator
   */
  public getSelectedOriginator(): OriginatorSearchResult | null {
    return this.state.selectedOriginator;
  }

  /**
   * Check if component is valid for form submission
   */
  public isValid(): boolean {
    return this.state.selectedOriginator !== null;
  }

  /**
   * Destroy the component and clean up
   */
  public destroy(): void {
    if (this.debouncedSearch) {
      this.debouncedSearch.cancel();
    }
    
    this.listeners.length = 0;
  }
}