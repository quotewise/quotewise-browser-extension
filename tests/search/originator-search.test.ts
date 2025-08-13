/**
 * Unit tests for OriginatorSearch component
 * Tests search functionality, debouncing, selection, and history management
 */

import { OriginatorSearch, SearchState } from '../../src/search/originator-search';
import type { OriginatorSearchResult } from '../../src/types/api';

// Mock Chrome APIs
const mockChrome = {
  runtime: {
    sendMessage: jest.fn(),
    lastError: null as any
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  }
};

(global as any).chrome = mockChrome;

// Mock debounce utility
jest.mock('../../src/utils/debounce', () => ({
  debounce: jest.fn((fn, delay) => {
    // Return a version that calls immediately for testing but with async behavior
    const debounced = (...args: any[]) => {
      // Use setTimeout to simulate debounce behavior in tests
      setTimeout(() => fn(...args), 0);
    };
    debounced.cancel = jest.fn();
    debounced.flush = jest.fn();
    return debounced;
  })
}));

// Mock DOM elements
const createMockElement = (id: string, tagName = 'div') => {
  const element = document.createElement(tagName);
  element.id = id;
  return element;
};

const createMockInput = (id: string) => {
  const input = document.createElement('input') as HTMLInputElement;
  input.id = id;
  return input;
};

describe('OriginatorSearch', () => {
  let originatorSearch: OriginatorSearch;
  let mockSearchInput: HTMLInputElement;
  let mockResultsContainer: HTMLElement;
  let mockSelectedContainer: HTMLElement;
  let mockHistoryContainer: HTMLElement;
  let mockLoadingIndicator: HTMLElement;

  const mockOriginators: OriginatorSearchResult[] = [
    {
      id: 1,
      unique_id: 'albert-einstein',
      full_name: 'Albert Einstein',
      sort_name_display: 'Einstein, Albert',
      confidence: 9.5
    },
    {
      id: 2,
      unique_id: 'marie-curie',
      full_name: 'Marie Curie',
      sort_name_display: 'Curie, Marie',
      confidence: 8.7
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup DOM elements
    mockSearchInput = createMockInput('originator-search');
    mockResultsContainer = createMockElement('originator-results');
    mockSelectedContainer = createMockElement('selected-originator');
    mockHistoryContainer = createMockElement('search-history');
    mockLoadingIndicator = createMockElement('search-loading');

    // Mock storage returns
    mockChrome.storage.local.get.mockResolvedValue({});
    mockChrome.storage.local.set.mockResolvedValue(undefined);

    // Create search instance
    originatorSearch = new OriginatorSearch({
      minQueryLength: 2,
      debounceDelay: 300,
      maxResults: 10
    });

    // Initialize with DOM elements
    originatorSearch.initialize({
      searchInput: mockSearchInput,
      resultsContainer: mockResultsContainer,
      selectedContainer: mockSelectedContainer,
      historyContainer: mockHistoryContainer,
      loadingIndicator: mockLoadingIndicator
    });
  });

  afterEach(() => {
    originatorSearch.destroy();
  });

  describe('initialization', () => {
    test('creates instance with default options', () => {
      expect(originatorSearch).toBeInstanceOf(OriginatorSearch);
      expect(originatorSearch.getState().query).toBe('');
      expect(originatorSearch.getState().selectedOriginator).toBeNull();
    });

    test('creates instance with custom options', () => {
      const customSearch = new OriginatorSearch({
        minQueryLength: 3,
        debounceDelay: 500,
        maxResults: 5,
        maxHistoryItems: 3
      });

      expect(customSearch).toBeInstanceOf(OriginatorSearch);
      customSearch.destroy();
    });

    test('loads search history from storage', async () => {
      const historyData = [{
        originator: mockOriginators[0],
        searchedAt: new Date().toISOString(),
        useCount: 1
      }];

      mockChrome.storage.local.get.mockResolvedValue({
        'quotewise-originator-history': historyData
      });

      const searchWithHistory = new OriginatorSearch();
      
      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockChrome.storage.local.get).toHaveBeenCalledWith(['quotewise-originator-history']);
    });
  });

  describe('search functionality', () => {
    test('triggers search when query is long enough', async () => {
      mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
        callback({ results: mockOriginators });
      });

      // Simulate input event
      mockSearchInput.value = 'Einstein';
      mockSearchInput.dispatchEvent(new Event('input'));

      // Wait for debounced function to execute
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEARCH_ORIGINATORS',
          data: { query: 'Einstein', limit: 10 }
        }),
        expect.any(Function)
      );
    });

    test('does not trigger search for short queries', () => {
      // Simulate short input
      mockSearchInput.value = 'A';
      mockSearchInput.dispatchEvent(new Event('input'));

      expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('handles search results correctly', async () => {
      mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
        callback({ results: mockOriginators });
      });

      // Trigger search
      mockSearchInput.value = 'Einstein';
      mockSearchInput.dispatchEvent(new Event('input'));

      // Wait for debounced function to execute
      await new Promise(resolve => setTimeout(resolve, 10));

      // Check state directly
      const state = originatorSearch.getState();
      expect(state.results).toEqual(mockOriginators);
      expect(state.query).toBe('Einstein');
    });

    test('handles search errors gracefully', async () => {
      mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
        callback({ error: 'Search failed' });
      });

      // Trigger search
      mockSearchInput.value = 'Einstein';
      mockSearchInput.dispatchEvent(new Event('input'));

      // Wait for debounced function to execute
      await new Promise(resolve => setTimeout(resolve, 10));

      // Check state directly
      const state = originatorSearch.getState();
      expect(state.error).toBe('Search failed');
      expect(state.results).toEqual([]);
    });
  });

  describe('selection functionality', () => {
    test('selects originator correctly', () => {
      const listener = jest.fn();
      originatorSearch.addListener(listener);

      originatorSearch.selectOriginator(mockOriginators[0]);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedOriginator: mockOriginators[0],
          query: mockOriginators[0].full_name
        })
      );

      expect(mockSearchInput.value).toBe(mockOriginators[0].full_name);
    });

    test('clears selection correctly', () => {
      const listener = jest.fn();
      originatorSearch.addListener(listener);

      // First select an originator
      originatorSearch.selectOriginator(mockOriginators[0]);
      
      // Then clear selection
      originatorSearch.clearSelection();

      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedOriginator: null,
          query: ''
        })
      );

      expect(mockSearchInput.value).toBe('');
    });

    test('adds selected originator to history', async () => {
      originatorSearch.selectOriginator(mockOriginators[0]);

      // Wait for async storage operation
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockChrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'quotewise-originator-history': expect.arrayContaining([
            expect.objectContaining({
              originator: mockOriginators[0],
              useCount: 1
            })
          ])
        })
      );
    });

    test('increments use count for repeated selections', () => {
      // Select same originator twice
      originatorSearch.selectOriginator(mockOriginators[0]);
      originatorSearch.selectOriginator(mockOriginators[0]);

      // Use count should be incremented in latest call
      expect(mockChrome.storage.local.set).toHaveBeenLastCalledWith(
        expect.objectContaining({
          'quotewise-originator-history': expect.arrayContaining([
            expect.objectContaining({
              originator: mockOriginators[0],
              useCount: 2
            })
          ])
        })
      );
    });
  });

  describe('keyboard navigation', () => {
    beforeEach(async () => {
      // Setup search results
      mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
        callback({ results: mockOriginators });
      });

      mockSearchInput.value = 'Einstein';
      mockSearchInput.dispatchEvent(new Event('input'));
      
      // Wait for search to complete
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    test('navigates down with arrow key', () => {
      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      mockSearchInput.dispatchEvent(downEvent);

      const state = originatorSearch.getState();
      expect(state.selectedIndex).toBe(0);
    });

    test('navigates up with arrow key', () => {
      // Start at -1, go up should wrap to last item (index 1 for 2 items)
      const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      mockSearchInput.dispatchEvent(upEvent);

      const state = originatorSearch.getState();
      expect(state.selectedIndex).toBe(1); // Should wrap to last item
    });

    test('selects item with Enter key', () => {
      // Navigate to first item
      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      mockSearchInput.dispatchEvent(downEvent);

      // Select with Enter
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      mockSearchInput.dispatchEvent(enterEvent);

      // Check that originator was selected
      const state = originatorSearch.getState();
      expect(state.selectedOriginator).toEqual(mockOriginators[0]);
    });

    test('closes results with Escape key', () => {
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      mockSearchInput.dispatchEvent(escapeEvent);

      const state = originatorSearch.getState();
      expect(state.showResults).toBe(false);
    });
  });

  describe('UI rendering', () => {
    test('shows loading state during search', async () => {
      mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
        // Don't call callback immediately to keep in loading state
        setTimeout(() => callback({ results: mockOriginators }), 50);
      });
      
      // Start a search
      mockSearchInput.value = 'Einstein';
      mockSearchInput.dispatchEvent(new Event('input'));
      
      // Wait for debounced search to start
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should now be in searching state
      const state = originatorSearch.getState();
      expect(state.isSearching).toBe(true);
    });

    test('hides loading state after search completes', async () => {
      mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
        callback({ results: mockOriginators });
      });

      mockSearchInput.value = 'Einstein';
      mockSearchInput.dispatchEvent(new Event('input'));

      // Wait for debounced function to execute
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLoadingIndicator.classList.contains('hidden')).toBe(true);
    });

    test('renders search results correctly', async () => {
      mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
        callback({ results: mockOriginators });
      });

      mockSearchInput.value = 'Einstein';
      mockSearchInput.dispatchEvent(new Event('input'));

      // Wait for debounced function to execute
      await new Promise(resolve => setTimeout(resolve, 0));

      // Check that results container is visible and has content
      expect(mockResultsContainer.classList.contains('hidden')).toBe(false);
      expect(mockResultsContainer.innerHTML).toContain('Albert Einstein');
      expect(mockResultsContainer.innerHTML).toContain('Einstein, Albert');
      expect(mockResultsContainer.innerHTML).toContain('9.5');
    });

    test('renders selected originator correctly', () => {
      originatorSearch.selectOriginator(mockOriginators[0]);

      expect(mockSelectedContainer.classList.contains('hidden')).toBe(false);
      expect(mockSelectedContainer.innerHTML).toContain('Albert Einstein');
      expect(mockSelectedContainer.innerHTML).toContain('clear-selection');
    });

    test('shows no results message when search returns empty', async () => {
      mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
        callback({ results: [] });
      });

      mockSearchInput.value = 'NonExistentPerson';
      mockSearchInput.dispatchEvent(new Event('input'));

      // Wait for debounced function to execute
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockResultsContainer.innerHTML).toContain('No originators found');
    });
  });

  describe('validation', () => {
    test('isValid returns false when no originator selected', () => {
      expect(originatorSearch.isValid()).toBe(false);
    });

    test('isValid returns true when originator is selected', () => {
      originatorSearch.selectOriginator(mockOriginators[0]);
      expect(originatorSearch.isValid()).toBe(true);
    });

    test('getSelectedOriginator returns null initially', () => {
      expect(originatorSearch.getSelectedOriginator()).toBeNull();
    });

    test('getSelectedOriginator returns selected originator', () => {
      originatorSearch.selectOriginator(mockOriginators[0]);
      expect(originatorSearch.getSelectedOriginator()).toEqual(mockOriginators[0]);
    });
  });

  describe('cleanup', () => {
    test('removes listeners on destroy', () => {
      const listener = jest.fn();
      originatorSearch.addListener(listener);

      originatorSearch.destroy();

      // Trigger an event that would normally call listener
      originatorSearch.selectOriginator(mockOriginators[0]);

      // Listener should not be called after destroy
      expect(listener).not.toHaveBeenCalled();
    });

    test('cancels debounced operations on destroy', () => {
      const { debounce } = require('../../src/utils/debounce');
      const mockCancel = jest.fn();
      
      debounce.mockReturnValue({ cancel: mockCancel });

      const testSearch = new OriginatorSearch();
      testSearch.destroy();

      expect(mockCancel).toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    test('handles focus events on search input', () => {
      const focusEvent = new Event('focus');
      mockSearchInput.dispatchEvent(focusEvent);

      // Should not crash and should maintain state
      const state = originatorSearch.getState();
      expect(state).toBeDefined();
    });

    test('handles escape key to close results', () => {
      // First set showResults to true
      originatorSearch.selectOriginator(mockOriginators[0]);
      originatorSearch.clearSelection();
      
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      mockSearchInput.dispatchEvent(escapeEvent);

      const state = originatorSearch.getState();
      expect(state.showResults).toBe(false);
    });
  });
});