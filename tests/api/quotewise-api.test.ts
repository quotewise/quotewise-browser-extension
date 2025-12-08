/**
 * Unit tests for QuotewiseApiClient
 * Tests CSRF token handling, session authentication, and API integration
 */

import { QuotewiseApiClientImpl } from '../../src/api/quotewise-api';
import * as csrfUtils from '../../src/api/csrf-utils';
import type { QuoteSubmissionRequest } from '../../src/types/api';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Mock CSRF utilities
jest.mock('../../src/api/csrf-utils', () => ({
  getDefaultHeaders: jest.fn(),
  getReadOnlyHeaders: jest.fn(),
  getCookie: jest.fn(),
  getCSRFToken: jest.fn(),
  CSRFTokenError: class CSRFTokenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'CSRFTokenError';
    }
  }
}));

describe('QuotewiseApiClient', () => {
  let client: QuotewiseApiClientImpl;
  const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
  const mockGetDefaultHeaders = csrfUtils.getDefaultHeaders as jest.MockedFunction<typeof csrfUtils.getDefaultHeaders>;
  const mockGetReadOnlyHeaders = (csrfUtils as any).getReadOnlyHeaders as jest.MockedFunction<typeof csrfUtils.getDefaultHeaders>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new QuotewiseApiClientImpl('http://localhost:8001');

    // Mock for POST/PUT/DELETE requests (with CSRF)
    mockGetDefaultHeaders.mockResolvedValue({
      'Content-Type': 'application/json',
      'X-CSRFToken': 'test-csrf-token',
      'X-Requested-With': 'XMLHttpRequest'
    });

    // Mock for GET requests (no CSRF required)
    mockGetReadOnlyHeaders.mockResolvedValue({
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    });
  });

  describe('CSRF Token Handling', () => {
    test('includes CSRF token in POST requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recommendation: 'new_quote', confidence: 1.0, matches: [], in_quotosaurus: false, reasoning: '', search_metadata: {} })
      } as Response);

      await client.checkQuoteDuplicate('test quote');

      // POST requests should use getDefaultHeaders which includes CSRF
      expect(mockGetDefaultHeaders).toHaveBeenCalledWith('http://localhost:8001');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-CSRFToken': 'test-csrf-token'
          })
        })
      );
    });

    test('uses read-only headers for GET requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      } as Response);

      await client.searchOriginators('test');

      // GET requests should use getReadOnlyHeaders (no CSRF required)
      expect(mockGetReadOnlyHeaders).toHaveBeenCalledWith('http://localhost:8001');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });

    test('includes credentials for session cookies', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      } as Response);

      await client.searchOriginators('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'include'
        })
      );
    });
  });

  describe('Error Handling', () => {
    test('returns empty array on 401 response for searchOriginators', async () => {
      // searchOriginators gracefully handles auth errors by returning empty array
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      } as Response);

      const result = await client.searchOriginators('test');
      expect(result).toEqual([]);
    });

    test('returns empty array on 403 response for searchOriginators', async () => {
      // searchOriginators gracefully handles auth errors by returning empty array
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403
      } as Response);

      const result = await client.searchOriginators('test');
      expect(result).toEqual([]);
    });

    test('throws AuthenticationError on 401 for checkQuoteDuplicate', async () => {
      // checkQuoteDuplicate re-throws auth errors (unlike searchOriginators which returns empty array)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Unauthorized'),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      await expect(client.checkQuoteDuplicate('test'))
        .rejects
        .toMatchObject({
          name: 'AuthenticationError',
          message: 'Authentication required'
        });
    });

    test('handles network errors gracefully in auth check', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      // checkAuthStatus catches errors and returns unauthenticated with full structure
      const result = await client.checkAuthStatus();
      expect(result).toEqual({
        authenticated: false,
        is_admin: false,
        permissions: { can_submit_quotes: false, can_review_quotes: false }
      });
    });
  });

  describe('searchOriginators', () => {
    test('searches originators successfully', async () => {
      const mockResults = [
        {
          id: 1,
          unique_id: 'albert-einstein',
          full_name: 'Albert Einstein',
          sort_name_display: 'Einstein, Albert',
          confidence: 10
        }
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: mockResults }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const results = await client.searchOriginators('Einstein', 5);

      expect(results).toEqual(mockResults);
      // GET requests use read-only headers (no CSRF required)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/api/v1/originators/search/?q=Einstein&limit=5',
        expect.objectContaining({
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });

    test('returns empty array for empty query', async () => {
      const results = await client.searchOriginators('');
      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('gracefully handles search errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500
      } as Response);

      const results = await client.searchOriginators('test');
      expect(results).toEqual([]); // Should return empty array, not throw
    });
  });

  describe('checkAuthStatus', () => {
    test('returns authentication status successfully', async () => {
      const mockAuthResult = {
        authenticated: true,
        is_admin: true,
        user: {
          id: 1,
          username: 'testuser',
          email: 'test@example.com'
        },
        permissions: {
          can_submit_quotes: true,
          can_review_quotes: true
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAuthResult),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.checkAuthStatus();

      expect(result).toEqual(mockAuthResult);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/api/v1/auth/status/',
        expect.objectContaining({
          credentials: 'include'
        })
      );
    });

    test('returns unauthenticated for auth errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      } as Response);

      const result = await client.checkAuthStatus();

      expect(result).toEqual({
        authenticated: false,
        is_admin: false,
        permissions: { can_submit_quotes: false, can_review_quotes: false }
      });
    });
  });

  describe('checkQuoteDuplicate', () => {
    test('checks for duplicates successfully', async () => {
      const mockDuplicateResult = {
        recommendation: 'duplicate',
        confidence: 0.95,
        in_quotosaurus: true,
        matches: [{
          quote_id: '123',
          version_id: 1,
          text: 'Similar quote',
          similarity: 0.9,
          match_type: 'exact',
          in_user_collections: false,
          originator: {
            id: '1',
            full_name: 'Einstein',
            sort_name: 'Einstein, Albert',
            birth_year: 1879,
            death_year: 1955
          },
          workflow_status: 'approved',
          likes_count: 10
        }],
        reasoning: 'Exact duplicate found',
        search_metadata: { total_matches: 1 }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDuplicateResult),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.checkQuoteDuplicate('Test quote', '1');

      expect(result).toEqual(mockDuplicateResult);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/api/v1/quotes/check_duplicate/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            text: 'Test quote',
            originator_id: 1
          })
        })
      );
    });

    test('returns no duplicates for empty text', async () => {
      const result = await client.checkQuoteDuplicate('');

      expect(result).toEqual({
        recommendation: 'new_quote',
        confidence: 1.0,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No quote text provided',
        search_metadata: {}
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('gracefully handles duplicate check errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500
      } as Response);

      const result = await client.checkQuoteDuplicate('test');

      expect(result).toEqual({
        recommendation: 'new_quote',
        confidence: 0.5,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'Error occurred during duplicate check, proceeding as new quote',
        search_metadata: { error: true }
      });
    });
  });

  describe('submitQuote', () => {
    const validQuoteData: QuoteSubmissionRequest = {
      text: 'Test quote',
      source_url: 'https://twitter.com/user/status/123',
      platform_code: 'TX',
      likes_count: 42,
      attribution_type: 'DIRECT',
      platform_data: {
        tweet_id: '123',
        reply_count: 1,
        retweet_count: 5,
        quote_count: 2,
        bookmark_count: 8,
        view_count: 1000,
        is_protected: false,
        has_media: false
      }
    };

    test('submits quote successfully', async () => {
      const mockResponse = {
        id: 'quote-123',
        message: 'Quote created successfully'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.submitQuote(validQuoteData);

      expect(result).toEqual({
        success: true,
        message: 'Quote created successfully',
        quoteId: 'quote-123'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/api/v1/quotes/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(validQuoteData)
        })
      );
    });

    test('validates required fields', async () => {
      const invalidData = { ...validQuoteData, text: '' };
      
      const result = await client.submitQuote(invalidData);

      expect(result).toEqual({
        success: false,
        message: 'Quote text is required',
        error: 'Quote text is required'
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('handles submission errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Validation error' }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.submitQuote(validQuoteData);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Environment Integration', () => {
    test('uses provided base URL', () => {
      const customClient = new QuotewiseApiClientImpl('https://custom.api.com');
      expect(customClient.baseUrl).toBe('https://custom.api.com');
    });

    test('falls back to environment config when no URL provided', () => {
      // The constructor should use getEnvironmentConfig() when no baseUrl provided
      const defaultClient = new QuotewiseApiClientImpl();
      expect(defaultClient.baseUrl).toBeDefined();
    });
  });
});