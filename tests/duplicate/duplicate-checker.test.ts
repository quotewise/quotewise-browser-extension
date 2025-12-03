/**
 * Unit tests for DuplicateChecker component
 */

import { DuplicateChecker, DuplicateState } from '../../src/duplicate/duplicate-checker';
import type { DuplicateCheckResult } from '../../src/types/api';
import { apiClient } from '../../src/api/quotewise-api';

// Mock the debounce utility
jest.mock('../../src/utils/debounce', () => ({
  debounce: jest.fn((fn) => fn)
}));

// Mock the API client
jest.mock('../../src/api/quotewise-api', () => ({
  apiClient: {
    checkQuoteDuplicate: jest.fn()
  }
}));

describe('DuplicateChecker', () => {
  let duplicateChecker: DuplicateChecker;
  let mockListener: jest.Mock;
  const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    duplicateChecker = new DuplicateChecker(100); // Short debounce for tests
    mockListener = jest.fn();
    duplicateChecker.addListener(mockListener);
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const state = duplicateChecker.getState();
      
      expect(state).toEqual({
        isChecking: false,
        hasChecked: false,
        result: null,
        userOverride: false,
        lastCheckText: '',
        lastCheckOriginator: '',
        lastCheckUrl: ''
      });
    });

    it('should notify listeners when state changes', () => {
      duplicateChecker.reset();
      
      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          isChecking: false,
          hasChecked: false,
          result: null
        })
      );
    });
  });

  describe('canSubmit', () => {
    it('should return false when no check has been performed', () => {
      expect(duplicateChecker.canSubmit()).toBe(false);
    });

    it('should return false when currently checking', () => {
      // Simulate checking state
      duplicateChecker['updateState']({ isChecking: true, hasChecked: false });
      
      expect(duplicateChecker.canSubmit()).toBe(false);
    });

    it('should return true for new_quote recommendation', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_quote',
        confidence: 0.9,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No similar quotes found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({
        hasChecked: true,
        result: mockResult,
        isChecking: false
      });

      expect(duplicateChecker.canSubmit()).toBe(true);
    });

    it('should return true for new_version recommendation', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Similar quote with different originator',
        search_metadata: {}
      };

      duplicateChecker['updateState']({
        hasChecked: true,
        result: mockResult,
        isChecking: false
      });

      expect(duplicateChecker.canSubmit()).toBe(true);
    });

    it('should return false for duplicate recommendation without override', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Exact duplicate found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({
        hasChecked: true,
        result: mockResult,
        isChecking: false,
        userOverride: false
      });

      expect(duplicateChecker.canSubmit()).toBe(false);
    });

    it('should return true for duplicate recommendation with override', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Exact duplicate found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({
        hasChecked: true,
        result: mockResult,
        isChecking: false,
        userOverride: true
      });

      expect(duplicateChecker.canSubmit()).toBe(true);
    });
  });

  describe('needsRecheck', () => {
    beforeEach(() => {
      duplicateChecker['updateState']({
        lastCheckText: 'original text',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://example.com'
      });
    });

    it('should return true when text changes', () => {
      expect(duplicateChecker.needsRecheck('new text', '123', 'https://example.com')).toBe(true);
    });

    it('should return true when originator changes', () => {
      expect(duplicateChecker.needsRecheck('original text', '456', 'https://example.com')).toBe(true);
    });

    it('should return true when URL changes', () => {
      expect(duplicateChecker.needsRecheck('original text', '123', 'https://different.com')).toBe(true);
    });

    it('should return false when nothing changes', () => {
      expect(duplicateChecker.needsRecheck('original text', '123', 'https://example.com')).toBe(false);
    });
  });

  describe('checkForDuplicates', () => {
    it('should perform immediate duplicate check', async () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_quote',
        confidence: 0.9,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No duplicates found',
        search_metadata: {}
      };

      mockApiClient.checkQuoteDuplicate.mockResolvedValue(mockResult);

      await duplicateChecker.checkForDuplicates('test quote', '123', 'https://test.com');

      expect(mockApiClient.checkQuoteDuplicate).toHaveBeenCalledWith(
        'test quote',
        '123',
        'https://test.com',
        undefined
      );

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          isChecking: false,
          hasChecked: true,
          result: mockResult,
          lastCheckText: 'test quote',
          lastCheckOriginator: '123',
          lastCheckUrl: 'https://test.com'
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      mockApiClient.checkQuoteDuplicate.mockRejectedValue(new Error('API Error'));

      await duplicateChecker.checkForDuplicates('test quote', '123', 'https://test.com');

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          isChecking: false,
          hasChecked: true,
          result: expect.objectContaining({
            recommendation: 'new_quote',
            confidence: 0.5,
            in_quotosaurus: false,
            reasoning: 'Error occurred during duplicate check, proceeding as new quote',
            search_metadata: { error: true }
          })
        })
      );
    });

    it('should skip check for empty text', async () => {
      await duplicateChecker.checkForDuplicates('', '123', 'https://test.com');

      expect(mockApiClient.checkQuoteDuplicate).not.toHaveBeenCalled();
    });
  });

  describe('checkForDuplicatesDebounced', () => {
    it('should reset user override when content changes', () => {
      duplicateChecker['updateState']({
        userOverride: true,
        lastCheckText: 'old text',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      });

      duplicateChecker.checkForDuplicatesDebounced('new text', '123', 'https://test.com');

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          userOverride: false,
          hasChecked: false
        })
      );
    });
  });

  describe('overrideRecommendation', () => {
    it('should set userOverride to true for duplicate recommendation', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Exact duplicate found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({
        result: mockResult,
        userOverride: false
      });

      duplicateChecker.overrideRecommendation();

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          userOverride: true
        })
      );
    });

    it('should not affect non-duplicate recommendations', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_quote',
        confidence: 0.9,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No duplicates found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({
        result: mockResult,
        userOverride: false
      });

      mockListener.mockClear(); // Clear the call from updateState

      duplicateChecker.overrideRecommendation();

      // Should not trigger additional state change
      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe('getRecommendationDisplay', () => {
    it('should return null when no result', () => {
      expect(duplicateChecker.getRecommendationDisplay()).toBeNull();
    });

    it('should return correct display for new_quote', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_quote',
        confidence: 0.9,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No duplicates found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({ result: mockResult });

      const display = duplicateChecker.getRecommendationDisplay();
      expect(display).toEqual({
        color: 'green',
        icon: '✅',
        text: 'New quote',
        allowSubmit: true
      });
    });

    it('should return correct display for new_version', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.8,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Similar quote with different originator',
        search_metadata: {}
      };

      duplicateChecker['updateState']({ result: mockResult });

      const display = duplicateChecker.getRecommendationDisplay();
      expect(display).toEqual({
        color: 'yellow',
        icon: '⚠️',
        text: 'New version',
        allowSubmit: true
      });
    });

    it('should return correct display for duplicate without override', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Exact duplicate found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({
        result: mockResult,
        userOverride: false
      });

      const display = duplicateChecker.getRecommendationDisplay();
      expect(display).toEqual({
        color: 'red',
        icon: '🚫',
        text: 'Duplicate',
        allowSubmit: false
      });
    });

    it('should return correct display for duplicate with override', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [],
        reasoning: 'Exact duplicate found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({
        result: mockResult,
        userOverride: true
      });

      const display = duplicateChecker.getRecommendationDisplay();
      expect(display).toEqual({
        color: 'red',
        icon: '🚫',
        text: 'Duplicate',
        allowSubmit: true
      });
    });
  });

  describe('getHighestSimilarity', () => {
    it('should return 0 when no matches', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_quote',
        confidence: 0.9,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No duplicates found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({ result: mockResult });

      expect(duplicateChecker.getHighestSimilarity()).toBe(0);
    });

    it('should return highest similarity from matches', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [
          {
            quote_id: '1',
            version_id: 1,
            text: 'Test quote',
            similarity: 0.8,
            match_type: 'semantic',
            in_user_collections: false,
            originator: { id: '1', full_name: 'Test Author', sort_name: null, birth_year: null, death_year: null },
            workflow_status: 'approved',
            likes_count: 10
          },
          {
            quote_id: '2',
            version_id: 2,
            text: 'Test quote exact',
            similarity: 0.95,
            match_type: 'exact',
            in_user_collections: true,
            originator: { id: '1', full_name: 'Test Author', sort_name: null, birth_year: null, death_year: null },
            workflow_status: 'approved',
            likes_count: 20
          }
        ],
        reasoning: 'High similarity matches found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({ result: mockResult });

      expect(duplicateChecker.getHighestSimilarity()).toBe(0.95);
    });
  });

  describe('getSimilarityDisplay', () => {
    it('should format exact similarity correctly', () => {
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
          in_user_collections: false,
          originator: { id: '1', full_name: 'Test Author', sort_name: null, birth_year: null, death_year: null },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Exact match found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({ result: mockResult });

      expect(duplicateChecker.getSimilarityDisplay()).toBe('97% (Exact)');
    });

    it('should format very similar correctly', () => {
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
          originator: { id: '2', full_name: 'Different Author', sort_name: null, birth_year: null, death_year: null },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Very similar match found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({ result: mockResult });

      expect(duplicateChecker.getSimilarityDisplay()).toBe('85% (Very similar)');
    });

    it('should format similar correctly', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_version',
        confidence: 0.7,
        in_quotosaurus: true,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: 'Test quote',
          similarity: 0.65,
          match_type: 'fuzzy',
          in_user_collections: false,
          originator: { id: '2', full_name: 'Different Author', sort_name: null, birth_year: null, death_year: null },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Similar match found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({ result: mockResult });

      expect(duplicateChecker.getSimilarityDisplay()).toBe('65% (Similar)');
    });

    it('should format low similarity correctly', () => {
      const mockResult: DuplicateCheckResult = {
        recommendation: 'new_quote',
        confidence: 0.3,
        in_quotosaurus: false,
        matches: [{
          quote_id: '1',
          version_id: 1,
          text: 'Test quote',
          similarity: 0.3,
          match_type: 'fuzzy',
          in_user_collections: false,
          originator: { id: '2', full_name: 'Different Author', sort_name: null, birth_year: null, death_year: null },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Low similarity match found',
        search_metadata: {}
      };

      duplicateChecker['updateState']({ result: mockResult });

      expect(duplicateChecker.getSimilarityDisplay()).toBe('30% (Low similarity)');
    });
  });

  describe('reset', () => {
    it('should reset state to initial values', () => {
      duplicateChecker['updateState']({
        isChecking: true,
        hasChecked: true,
        result: {} as any,
        userOverride: true,
        lastCheckText: 'test',
        lastCheckOriginator: '123',
        lastCheckUrl: 'https://test.com'
      });

      duplicateChecker.reset();

      const state = duplicateChecker.getState();
      expect(state).toEqual({
        isChecking: false,
        hasChecked: false,
        result: null,
        userOverride: false,
        lastCheckText: '',
        lastCheckOriginator: '',
        lastCheckUrl: ''
      });
    });
  });

  describe('listener management', () => {
    it('should remove listeners correctly', () => {
      const mockListener2 = jest.fn();
      const removeListener = duplicateChecker.addListener(mockListener2);

      duplicateChecker.reset();
      expect(mockListener2).toHaveBeenCalled();

      mockListener2.mockClear();
      removeListener();

      duplicateChecker.reset();
      expect(mockListener2).not.toHaveBeenCalled();
    });

    it('should handle errors in listeners gracefully', () => {
      const errorListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      duplicateChecker.addListener(errorListener);
      duplicateChecker.reset();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error in duplicate state listener:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });
});