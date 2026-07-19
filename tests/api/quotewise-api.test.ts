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

    test('fails closed (throws, sends nothing) when there is no token', async () => {
      // Fail-closed: with no token we must NOT send the request unauthenticated —
      // capture/preflight data would otherwise egress anonymously before the 401.
      getAccessToken.mockResolvedValue(null);

      await expect(client.searchOriginators('test')).rejects.toThrow('Authentication required');
      expect(mockFetch).not.toHaveBeenCalled();
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
          member_collections: [{ slug: 'favorites', name: 'Favorites' }],
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
        search_metadata: { total_matches: 1, query_time_ms: 96 }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDuplicateResult),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.checkQuoteDuplicate('Test quote', 'kpaxs');

      expect(result).toEqual({
        ...mockDuplicateResult,
        search_metadata: {
          ...mockDuplicateResult.search_metadata,
          client_rtt_ms: expect.any(Number),
        },
      });
      expect(result.search_metadata.query_time_ms).toBe(96);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.quotewise.test:8000/v1/quotes/check_duplicate/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            text: 'Test quote',
            originator_slug: 'kpaxs'
          })
        })
      );
    });

    test('normalizes absent member_collections to an empty array for older responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
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
        }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.checkQuoteDuplicate('Test quote');

      expect(result.matches[0].member_collections).toEqual([]);
    });

    test('drops membership rows that do not match the canonical slug/name shape', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          recommendation: 'duplicate',
          confidence: 0.95,
          in_quotewise: true,
          matches: [{
            quote_id: '123',
            version_id: 1,
            text: 'Similar quote',
            similarity: 0.9,
            match_type: 'exact',
            in_user_collections: true,
            member_collections: [{ id: 'collection-uuid', name: 'Favorites' }],
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
        }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.checkQuoteDuplicate('Test quote');

      expect(result.matches[0].member_collections).toEqual([]);
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

    test('returns a couldnt-verify result for duplicate check non-2xx failures', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500
      } as Response);

      const result = await client.checkQuoteDuplicate('test');

      expect(result.search_metadata.error).toBe(true);
      expect(result.reasoning).toBe("Couldn't verify duplicates");
      expect(result.confidence).toBe(0);
      expect(result.matches).toEqual([]);
    });

    test('returns a couldnt-verify result for duplicate check network failures', async () => {
      mockFetch.mockRejectedValue(new Error('offline'));

      const result = await client.checkQuoteDuplicate('test');

      expect(result.search_metadata.error).toBe(true);
      expect(result.reasoning).toBe("Couldn't verify duplicates");
      expect(result.confidence).toBe(0);
      expect(result.matches).toEqual([]);
    });
  });

  describe('preflightCheck', () => {
    const okPreflight = () => ({
      ok: true,
      json: () => Promise.resolve({ originator: { found: false }, duplicate_check: {} }),
      headers: new Headers({ 'content-type': 'application/json' })
    } as Response);

    test('caps the text sent to preflight so huge article bodies do not break the call', async () => {
      mockFetch.mockResolvedValue(okPreflight());

      await client.preflightCheck('kpaxs', 'twitter', 'a'.repeat(5000), 'https://x.com/kpaxs/status/1');

      const call = mockFetch.mock.calls.find(c => String(c[0]).includes('/v1/quotes/preflight/'));
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.handle).toBe('kpaxs');
      expect(body.text.length).toBe(2000);
    });

    test('leaves short text unchanged', async () => {
      mockFetch.mockResolvedValue(okPreflight());

      await client.preflightCheck('kpaxs', 'twitter', 'short quote', 'https://x.com/kpaxs/status/1');

      const call = mockFetch.mock.calls.find(c => String(c[0]).includes('/v1/quotes/preflight/'));
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.text).toBe('short quote');
    });

    test('normalizes canonical member_collections inside the preflight duplicate result', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          originator: { found: true },
          duplicate_check: {
            recommendation: 'duplicate',
            confidence: 0.95,
            in_quotewise: true,
            matches: [{
              quote_id: '123',
              version_id: 1,
              text: 'Known quote',
              similarity: 0.9,
              match_type: 'exact',
              in_user_collections: false,
              member_collections: [{ slug: 'favorites', name: 'Favorites' }],
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
          }
        }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.preflightCheck(
        'kpaxs',
        'twitter',
        'Known quote',
        'https://x.com/kpaxs/status/1'
      );

      expect(result.duplicate_check.matches[0].member_collections).toEqual([
        { slug: 'favorites', name: 'Favorites' },
      ]);
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
        quote: { short_code: 'abc123' },
        version_id: 'quote-123',
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

    test('extracts the submitted quote id from canonical version_id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          quote: { short_code: 'abc123', url: 'https://quotewise.io/q/abc123/' },
          version_id: 482932,
          message: 'Quote created successfully',
        }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.submitQuote(validQuoteData);

      expect(result.quoteId).toBe('482932');
    });

    test('does not treat quote.id as the submitted quote id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          quote: { id: 482932, short_code: 'abc123' },
          message: 'Quote created successfully',
        }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.submitQuote(validQuoteData);

      expect(result.quoteId).toBeUndefined();
    });

    test('threads sighting/variant decision fields and surfaces response action', async () => {
      const mockResponse = {
        quote: { short_code: 'abc123' },
        version_id: 'quote-123',
        message: 'Sighting added',
        action: 'sighting_added'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      const result = await client.submitQuote({
        ...validQuoteData,
        link_to_quote_id: 101,
        user_intent: 'sighting'
      });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.link_to_quote_id).toBe(101);
      expect(body.user_intent).toBe('sighting');
      expect(result.action).toBe('sighting_added');
    });

    test('omits sighting/variant decision fields when not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          quote: { short_code: 'abc123' },
          version_id: 'quote-123',
          message: 'Quote created successfully',
        }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      await client.submitQuote(validQuoteData);

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body).not.toHaveProperty('link_to_quote_id');
      expect(body).not.toHaveProperty('user_intent');
    });

    test('strips legacy collection_id before posting a quote', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          quote: { short_code: 'abc123' },
          version_id: 'quote-123',
          message: 'Quote created successfully',
        }),
        headers: new Headers({ 'content-type': 'application/json' })
      } as Response);

      await client.submitQuote({
        ...validQuoteData,
        collection_id: 'emojislug',
      } as QuoteSubmissionRequest & { collection_id: string });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body).not.toHaveProperty('collection_id');
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

  describe('addQuoteToCollection', () => {
    test.each([201, 200])('treats %i as a successful idempotent add', async (status) => {
      mockFetch.mockResolvedValue({
        ok: true,
        status,
        json: () => Promise.resolve({ success: true })
      } as Response);

      const result = await client.addQuoteToCollection('favorites', 'quote-123');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.quotewise.test:8000/v1/collections/favorites/quotes/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ quote_id: 'quote-123' }),
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token'
          })
        })
      );
    });

    test('maps collection membership failures into non-throwing result objects', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ detail: 'Not found.' })
      } as Response);

      await expect(client.addQuoteToCollection('missing', 'quote-123')).resolves.toEqual({
        success: false,
        error: 'Not found.',
      });
    });
  });

  describe('listCollections', () => {
    test('normalizes the deployed collections response envelope', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [{
            id: 'default-id',
            name: "Chris's Default Collection",
            slug: 'chriss-default-collection',
            description: '',
            quote_count: 531,
            is_default: true,
            created_at: '2026-06-22T00:00:00Z',
            updated_at: '2026-06-22T00:00:00Z',
          }],
          meta: { request_id: 'request-123' },
          links: { next: null, previous: null },
        })
      } as Response);

      await expect(client.listCollections()).resolves.toEqual({
        collections: [{
          id: 'default-id',
          name: "Chris's Default Collection",
          slug: 'chriss-default-collection',
          description: '',
          quote_count: 531,
          is_default: true,
          created_at: '2026-06-22T00:00:00Z',
          updated_at: '2026-06-22T00:00:00Z',
        }],
        default_collection_id: 'default-id',
      });
    });

    test('does not accept top-level collections payloads at the API boundary', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          collections: [{
            id: 'top-level-id',
            name: 'Top Level',
            slug: 'top-level',
            is_default: true,
          }],
          default_collection_id: 'top-level-id',
        })
      } as Response);

      await expect(client.listCollections()).resolves.toEqual({
        collections: [],
        default_collection_id: null,
      });
    });

    test('requires usable slugs while preserving emoji-named collections with canonical slugs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              id: 'emoji-id',
              name: '😀😍🎉🌈🐶🍕🚀🎸🌺🦄',
              slug: ' emojislug ',
              description: '',
              quote_count: 3,
              is_default: false,
              created_at: '2026-06-22T00:00:00Z',
              updated_at: '2026-06-22T00:00:00Z',
            },
            {
              id: 'bad-id',
              name: 'Missing Slug',
              slug: '   ',
              description: '',
              quote_count: 0,
              is_default: false,
              created_at: '2026-06-22T00:00:00Z',
              updated_at: '2026-06-22T00:00:00Z',
            },
          ],
          meta: { request_id: 'request-123' },
          links: { next: null, previous: null },
        })
      } as Response);

      await expect(client.listCollections()).resolves.toEqual({
        collections: [{
          id: 'emoji-id',
          name: '😀😍🎉🌈🐶🍕🚀🎸🌺🦄',
          slug: 'emojislug',
          description: '',
          quote_count: 3,
          is_default: false,
          created_at: '2026-06-22T00:00:00Z',
          updated_at: '2026-06-22T00:00:00Z',
        }],
        default_collection_id: null,
      });
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
      expect(result.client_rtt_ms).toEqual(expect.any(Number));
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
