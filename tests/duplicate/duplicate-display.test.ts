/**
 * Unit tests for DuplicateDisplay component
 */

import { DuplicateDisplay } from '../../src/duplicate/duplicate-display';
import type { DuplicateCheckResult } from '../../src/types/api';
import type { DuplicateState } from '../../src/duplicate/duplicate-checker';

// Mock window.confirm for override tests
Object.defineProperty(window, 'confirm', {
  writable: true,
  value: jest.fn(),
});

describe('DuplicateDisplay', () => {
  let container: HTMLElement;
  let duplicateDisplay: DuplicateDisplay;
  let mockCallbacks: {
    onOverride: jest.Mock;
    onEditQuote: jest.Mock;
    onChangeOriginator: jest.Mock;
  };

  beforeEach(() => {
    // Setup DOM container
    container = document.createElement('div');
    document.body.appendChild(container);

    // Setup mock callbacks
    mockCallbacks = {
      onOverride: jest.fn(),
      onEditQuote: jest.fn(),
      onChangeOriginator: jest.fn()
    };

    // Create display instance
    duplicateDisplay = new DuplicateDisplay({
      container,
      ...mockCallbacks
    });

    // Clear all mocks
    jest.clearAllMocks();
    (window.confirm as jest.Mock).mockClear();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('initialization', () => {
    it('should create instance with container and callbacks', () => {
      expect(duplicateDisplay).toBeInstanceOf(DuplicateDisplay);
      expect(container).toBeDefined();
    });
  });

  describe('updateDisplay', () => {
    it('should render checking state', () => {
      const state: DuplicateState = {
        isChecking: true,
        hasChecked: false,
        result: null,
        userOverride: false,
        lastCheckText: '',
        lastCheckOriginator: '',
        lastCheckUrl: ''
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.querySelector('.duplicate-checking')).toBeTruthy();
      expect(container.querySelector('.checking-spinner')).toBeTruthy();
      expect(container.textContent).toContain('Checking for duplicates...');
      expect(container.classList.contains('hidden')).toBe(false);
    });

    it('should render empty state when no check performed', () => {
      const state: DuplicateState = {
        isChecking: false,
        hasChecked: false,
        result: null,
        userOverride: false,
        lastCheckText: '',
        lastCheckOriginator: '',
        lastCheckUrl: ''
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.innerHTML).toBe('');
      expect(container.classList.contains('hidden')).toBe(true);
    });

    it('should render new_quote recommendation', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_quote',
        confidence: 0.9,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No similar quotes found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.querySelector('.recommendation-success')).toBeTruthy();
      expect(container.textContent).toContain('New quote');
      expect(container.textContent).toContain('90%'); // confidence
      expect(container.textContent).toContain('✅');
      expect(container.textContent).toContain('No similar quotes found');
    });

    it('should render new_version recommendation', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: 'Similar quote text',
          similarity: 0.75,
          match_type: 'semantic',
          in_user_collections: false,
          originator: {
            id: '2',
            full_name: 'Different Author',
            sort_name: 'Author, Different',
            birth_year: null,
            death_year: null
          },
          workflow_status: 'approved',
          likes_count: 15
        }],
        reasoning: 'Similar quote with different attribution',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.querySelector('.recommendation-warning')).toBeTruthy();
      expect(container.textContent).toContain('New version');
      expect(container.textContent).toContain('80%'); // confidence
      expect(container.textContent).toContain('⚠️');
      expect(container.textContent).toContain('Similar quote with different attribution');
      expect(container.textContent).toContain('1 similar quote found');
    });

    it('should render duplicate recommendation', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: 'Exact quote text',
          similarity: 0.96,
          match_type: 'exact',
          in_user_collections: true,
          originator: {
            id: '123',
            full_name: 'Same Author',
            sort_name: 'Author, Same',
            birth_year: null,
            death_year: null
          },
          workflow_status: 'approved',
          likes_count: 25
        }],
        reasoning: 'Exact duplicate found with same originator',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.querySelector('.recommendation-error')).toBeTruthy();
      expect(container.textContent).toContain('Duplicate');
      expect(container.textContent).toContain('95%'); // confidence
      expect(container.textContent).toContain('🚫');
      expect(container.textContent).toContain('Exact duplicate found with same originator');
      expect(container.textContent).toContain('Add Anyway');
    });
  });

  describe('match display', () => {
    it('should render match details correctly', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: 'This is a test quote that should be displayed in the match',
          similarity: 0.85,
          match_type: 'semantic',
          in_user_collections: false,
          originator: {
            id: '2',
            full_name: 'Test Author',
            sort_name: 'Author, Test',
            birth_year: 1950,
            death_year: null
          },
          workflow_status: 'approved',
          likes_count: 42
        }],
        reasoning: 'Similar quote found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      // Check similarity badge
      expect(container.textContent).toContain('85%');
      expect(container.querySelector('.similarity-high')).toBeTruthy();

      // Check match type
      expect(container.textContent).toContain('Semantic match');

      // Check workflow status
      expect(container.textContent).toContain('Approved');

      // Check quote text
      expect(container.textContent).toContain('This is a test quote that should be displayed');

      // Check originator
      expect(container.textContent).toContain('Test Author');

      // Check likes count
      expect(container.textContent).toContain('❤️ 42');

      // Check view details button
      expect(container.querySelector('[data-action="view-details"]')).toBeTruthy();
    });

    it('should limit displayed matches to 3', () => {
      const matches = Array.from({ length: 5 }, (_, i) => ({
        quote_id: `${i + 1}`,
        version_id: i + 1,
        text: `Test quote ${i + 1}`,
        similarity: 0.8 - (i * 0.1),
        match_type: 'semantic',
        in_user_collections: false,
        originator: {
          id: `${i + 1}`,
          full_name: `Author ${i + 1}`,
          sort_name: `Author ${i + 1}`,
          birth_year: null,
          death_year: null
        },
        workflow_status: 'approved',
        likes_count: 10
      }));

      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches,
        reasoning: 'Multiple similar quotes found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      // Should show first 3 matches
      expect(container.textContent).toContain('Test quote 1');
      expect(container.textContent).toContain('Test quote 2');
      expect(container.textContent).toContain('Test quote 3');

      // Should show "Show more" button
      expect(container.textContent).toContain('Show 2 more...');
      expect(container.querySelector('[data-action="show-more"]')).toBeTruthy();
    });
  });

  describe('action buttons', () => {
    it('should handle override button click with confirmation', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Duplicate found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      (window.confirm as jest.Mock).mockReturnValue(true);

      const overrideBtn = container.querySelector('[data-action="override"]') as HTMLButtonElement;
      expect(overrideBtn).toBeTruthy();

      overrideBtn.click();

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Are you sure you want to add this quote')
      );
      expect(mockCallbacks.onOverride).toHaveBeenCalled();
    });

    it('should not call override callback when confirmation is cancelled', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Duplicate found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      (window.confirm as jest.Mock).mockReturnValue(false);

      const overrideBtn = container.querySelector('[data-action="override"]') as HTMLButtonElement;
      overrideBtn.click();

      expect(mockCallbacks.onOverride).not.toHaveBeenCalled();
    });

    it('should handle edit quote button click', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Similar quote found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      const editBtn = container.querySelector('[data-action="edit-quote"]') as HTMLButtonElement;
      expect(editBtn).toBeTruthy();

      editBtn.click();

      expect(mockCallbacks.onEditQuote).toHaveBeenCalled();
    });

    it('should handle change originator button click', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.9,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Duplicate found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      const changeOriginatorBtn = container.querySelector('[data-action="change-originator"]') as HTMLButtonElement;
      expect(changeOriginatorBtn).toBeTruthy();

      changeOriginatorBtn.click();

      expect(mockCallbacks.onChangeOriginator).toHaveBeenCalled();
    });

    it('should handle view details button click', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches: [{
          quote_id: 'test-quote-id',
          version_id: 1,
          text: 'Test quote',
          similarity: 0.8,
          match_type: 'semantic',
          in_user_collections: false,
          originator: {
            id: '1',
            full_name: 'Test Author',
            sort_name: 'Author, Test',
            birth_year: null,
            death_year: null
          },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Similar quote found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      const viewDetailsBtn = container.querySelector('[data-action="view-details"]') as HTMLButtonElement;
      expect(viewDetailsBtn).toBeTruthy();

      viewDetailsBtn.click();

      expect(consoleSpy).toHaveBeenCalledWith('View details clicked for quote:', 'test-quote-id');

      consoleSpy.mockRestore();
    });

    it('should handle show more button click', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const matches = Array.from({ length: 5 }, (_, i) => ({
        quote_id: `${i + 1}`,
        version_id: i + 1,
        text: `Test quote ${i + 1}`,
        similarity: 0.8,
        match_type: 'semantic',
        in_user_collections: false,
        originator: {
          id: `${i + 1}`,
          full_name: `Author ${i + 1}`,
          sort_name: `Author ${i + 1}`,
          birth_year: null,
          death_year: null
        },
        workflow_status: 'approved',
        likes_count: 10
      }));

      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches,
        reasoning: 'Multiple matches found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      const showMoreBtn = container.querySelector('[data-action="show-more"]') as HTMLButtonElement;
      expect(showMoreBtn).toBeTruthy();

      showMoreBtn.click();

      expect(consoleSpy).toHaveBeenCalledWith('Show more matches clicked');

      consoleSpy.mockRestore();
    });
  });

  describe('similarity display', () => {
    it('should show correct similarity class for exact match', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: 'Test quote',
          similarity: 0.97,
          match_type: 'exact',
          in_user_collections: true,
          originator: {
            id: '1',
            full_name: 'Test Author',
            sort_name: 'Author, Test',
            birth_year: null,
            death_year: null
          },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Exact match',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.querySelector('.similarity-exact')).toBeTruthy();
      expect(container.textContent).toContain('97%');
    });

    it('should show correct similarity class for high similarity', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.85,
        in_quotosaurus: true,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: 'Test quote',
          similarity: 0.85,
          match_type: 'semantic',
          in_user_collections: false,
          originator: {
            id: '1',
            full_name: 'Test Author',
            sort_name: 'Author, Test',
            birth_year: null,
            death_year: null
          },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'High similarity',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.querySelector('.similarity-high')).toBeTruthy();
      expect(container.textContent).toContain('85%');
    });
  });

  describe('text truncation', () => {
    it('should truncate long quote text in matches', () => {
      const longText = 'This is a very long quote text that should be truncated when displayed in the match results because it exceeds the maximum length limit that we have set for display purposes in the UI';

      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: longText,
          similarity: 0.8,
          match_type: 'semantic',
          in_user_collections: false,
          originator: {
            id: '1',
            full_name: 'Test Author',
            sort_name: 'Author, Test',
            birth_year: null,
            death_year: null
          },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Similar quote found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.textContent).toContain('...');
      expect(container.textContent).not.toContain(longText);
    });
  });

  describe('HTML escaping', () => {
    it('should escape HTML in quote text', () => {
      const htmlText = 'Quote with <script>alert("xss")</script> content';

      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: htmlText,
          similarity: 0.8,
          match_type: 'semantic',
          in_user_collections: false,
          originator: {
            id: '1',
            full_name: 'Test <b>Author</b>',
            sort_name: 'Author, Test',
            birth_year: null,
            death_year: null
          },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Similar quote with HTML found',
        search_metadata: {}
      };

      const state: DuplicateState = {
        isChecking: false,
        hasChecked: true,
        result: mockResult,
        userOverride: false,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      };

      duplicateDisplay.updateDisplay(state);

      expect(container.innerHTML).toContain('&lt;script&gt;');
      expect(container.innerHTML).toContain('&lt;b&gt;Author&lt;/b&gt;');
      expect(container.innerHTML).not.toContain('<script>');
      expect(container.innerHTML).not.toContain('<b>Author</b>');
    });
  });
});