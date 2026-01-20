/**
 * Unit tests for QuotewiseApiClient
 * Tests OAuth 2.0 Bearer token authentication and API integration
 */

import { QuotewiseApiClientImpl } from '../../src/api/quotewise-api';
import type { QuoteSubmissionRequest } from '../../src/types/api';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Mock token-storage module
jest.mock('../../src/auth/token-storage', () => ({
  getAccessToken: jest.fn()
}));

// Mock token-refresh module
jest.mock('../../src/auth/token-refresh', () => ({
  attemptTokenRefresh: jest.fn()
}));

// Mock environment module
jest.mock('../../src/config/environment', () => ({
  getEnvironmentConfig: jest.fn(() => ({
    apiBaseUrl: 'http://api.quotewise.test:8000',
    webBaseUrl: 'http://quotewise.test:8000'
  })),
  debugLog: jest.fn()
}));

// Get references to mocked functions
const { getAccessToken } = require('../../src/auth/token-storage');
const { attemptTokenRefresh } = require('../../src/auth/token-refresh');

describe('QuotewiseApiClient', () => {
  let client: QuotewiseApiClientImpl;
  const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new QuotewiseApiClientImpl('http://api.quotewise.test:8000');

    // Default: authenticated with valid token
    getAccessToken.mockResolvedValue('test-access-token');
  });

  describe('Bearer Token Authentication', () => {
    test('includes Bearer token in request headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      } as Response);

      await client.searchOriginators('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token',
            'Content-Type': 'application/json'
          })
        })
      );
    });

    test('makes requests without Authorization header when no token', async () => {
      getAccessToken.mockResolvedValue(null);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      } as Response);

      await client.searchOriginators('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.any(String)
          })
        })
      );
    });

    test('does not include credentials (cookies) in requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      } as Response);

      await client.searchOriginators('test');

      // Should NOT have credentials: 'include' - we use Bearer tokens now
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          credentials: 'include'
        })
      );
    });
  });

  describe('Token Refresh on 401', () => {
    test('attempts token refresh on 401 and retries request', async () => {
      // First call returns 401
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized'
        } as Response)
        // Second call (after refresh) succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ results: [{ id: 1, full_name: 'Test' }] })
        } as Response);

      attemptTokenRefresh.mockResolvedValue({ success: true });
      getAccessToken
        .mockResolvedValueOnce('old-token')
        .mockResolvedValueOnce('new-token');

      const result = await client.searchOriginators('test');

      expect(attemptTokenRefresh).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
    });

    test('throws AuthenticationError when refresh fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as Response);

      attemptTokenRefresh.mockResolvedValue({ success: false, error: 'revoked' });

      await expect(client.checkQuoteDuplicate('test'))
        .rejects
        .toMatchObject({
          name: 'AuthenticationError',
          message: 'Authentication required'
        });
    });
  });

  describe('Error Handling', () => {
    test('throws AuthenticationError on 401 for searchOriginators', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      } as Response);

      attemptTokenRefresh.mockResolvedValue({ success: false });

      // searchOriginators now re-throws auth errors
      await expect(client.searchOriginators('test'))
        .rejects
        .toMatchObject({
          name: 'AuthenticationError'
        });
    });

    test('throws AuthenticationError on 403 for searchOriginators', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403
      } as Response);

      // searchOriginators now re-throws auth errors
      await expect(client.searchOriginators('test'))
        .rejects
        .toMatchObject({
          name: 'AuthenticationError'
        });
    });

    test('throws AuthenticationError on 401 for checkQuoteDuplicate', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as Response);

      attemptTokenRefresh.mockResolvedValue({ success: false });

      await expect(client.checkQuoteDuplicate('test'))
        .rejects
        .toMatchObject({
          name: 'AuthenticationError',
          message: 'Authentication required'
        });
    });

    test('handles network errors gracefully in auth check', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

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
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.quotewise.test:8000/v1/originators/search/?q=Einstein&limit=5',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token'
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
      expect(results).toEqual([]);
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
        'http://api.quotewise.test:8000/v1/auth/status/',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token'
          })
        })
      );
    });

    test('returns unauthenticated for auth errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      } as Response);

      attemptTokenRefresh.mockResolvedValue({ success: false });

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
        in_quotewise: true,
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
        'http://api.quotewise.test:8000/v1/quotes/check_duplicate/',
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
        in_quotewise: false,
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
        in_quotewise: false,
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
        'http://api.quotewise.test:8000/v1/quotes/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(validQuoteData),
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token'
          })
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

  describe('lookupOriginatorByHandle', () => {
    test('returns found originator for existing handle', async () => {
      const mockApiResponse = {
        found: true,
        originator: {
          id: 123,
          full_name: 'Test Person',
          slug: 'test-person'
        },
        confidence: 0.95,
        match_platform: 'twitter'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse)
      } as Response);

      const result = await client.lookupOriginatorByHandle('testhandle', 'twitter');

      expect(result.found).toBe(true);
      expect(result.originator).toBeDefined();
      expect(result.originator?.id).toBe(123);
      expect(result.originator?.full_name).toBe('Test Person');
    });

    test('strips @ prefix from handle', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ found: false })
      } as Response);

      await client.lookupOriginatorByHandle('@testhandle', 'twitter');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.quotewise.test:8000/v1/originators/by-handle/?handle=testhandle&platform=twitter',
        expect.any(Object)
      );
    });

    test('returns not found for empty handle', async () => {
      const result = await client.lookupOriginatorByHandle('', 'twitter');

      expect(result.found).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Environment Integration', () => {
    test('uses provided base URL', () => {
      const customClient = new QuotewiseApiClientImpl('https://custom.api.com');
      expect(customClient.baseUrl).toBe('https://custom.api.com');
    });

    test('falls back to environment config when no URL provided', () => {
      const defaultClient = new QuotewiseApiClientImpl();
      expect(defaultClient.baseUrl).toBeDefined();
    });
  });
});
