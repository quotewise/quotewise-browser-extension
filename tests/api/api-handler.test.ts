/**
 * Integration tests for ApiHandler
 * Tests service worker message handling and API client integration
 */

import { ApiHandler } from '../../src/background/api-handler';
import type { ExtensionMessage, MessageType } from '../../src/types/index';
import { QuotewiseApiClientImpl } from '../../src/api/quotewise-api';

// Mock the API client
jest.mock('../../src/api/quotewise-api', () => ({
  QuotewiseApiClientImpl: jest.fn().mockImplementation(() => ({
    baseUrl: 'http://api.quotewise.test:8000',
    checkAuthStatus: jest.fn(),
    searchOriginators: jest.fn(),
    checkQuoteDuplicate: jest.fn(),
    submitQuote: jest.fn(),
    preflightCheck: jest.fn(),
    listCollections: jest.fn(),
    addQuoteToCollection: jest.fn()
  }))
}));

// Mock environment detection
jest.mock('../../src/config/environment', () => ({
  detectEnvironment: jest.fn(() => 'development'),
  getEnvironmentConfig: jest.fn(() => ({
    apiBaseUrl: 'http://api.quotewise.test:8000',
    webBaseUrl: 'http://quotewise.test:8000',
    secure: false
  })),
  debugLog: jest.fn()
}));

// Mock Chrome APIs
const mockChrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn()
  }
};

(global as any).chrome = mockChrome;

describe('ApiHandler', () => {
  let apiHandler: ApiHandler;
  let mockApiClient: jest.Mocked<QuotewiseApiClientImpl>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockChrome.storage.local.get.mockResolvedValue({});
    mockChrome.storage.local.set.mockResolvedValue(undefined);
    mockChrome.storage.local.remove.mockResolvedValue(undefined);

    apiHandler = new ApiHandler();

    // Get the mocked API client instance
    mockApiClient = (QuotewiseApiClientImpl as jest.Mock).mock.results[0].value;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    test('initializes with correct environment', () => {
      expect(QuotewiseApiClientImpl).toHaveBeenCalledWith('http://api.quotewise.test:8000');
    });

    test('provides environment info', () => {
      const envInfo = apiHandler.getEnvironmentInfo();
      expect(envInfo).toEqual({
        environment: 'development',
        baseUrl: 'http://api.quotewise.test:8000'
      });
    });
  });

  describe('Message Handling', () => {
    let mockSendResponse: jest.Mock;

    beforeEach(() => {
      mockSendResponse = jest.fn();
    });

    // Note: CHECK_AUTH_STATUS is now handled by AuthStateManager, not ApiHandler

    test('handles SEARCH_ORIGINATORS message', async () => {
      const mockResults = [
        { id: 1, unique_id: 'albert-einstein', full_name: 'Albert Einstein', sort_name_display: 'Einstein, Albert', confidence: 10 }
      ];
      mockApiClient.searchOriginators.mockResolvedValue(mockResults);

      const message: ExtensionMessage = {
        type: 'SEARCH_ORIGINATORS' as MessageType,
        data: { query: 'Einstein', limit: 10 }
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.searchOriginators).toHaveBeenCalledWith('Einstein', 10);
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        results: mockResults
      });
    });

    test('handles SEARCH_ORIGINATORS with missing query', async () => {
      const message: ExtensionMessage = {
        type: 'SEARCH_ORIGINATORS' as MessageType,
        data: {}
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.searchOriginators).not.toHaveBeenCalled();
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Search query is required'
      });
    });

    test('handles CHECK_DUPLICATE_QUOTE message', async () => {
      const mockDuplicateResult = {
        recommendation: 'new_quote' as const,
        confidence: 0.9,
        in_quotewise: false,
        matches: [],
        reasoning: 'No duplicates found',
        search_metadata: {}
      };
      mockApiClient.checkQuoteDuplicate.mockResolvedValue(mockDuplicateResult);

      const message: ExtensionMessage = {
        type: 'CHECK_DUPLICATE' as MessageType,
        data: {
          text: 'Test quote',
          originator_slug: 'kpaxs',
          source_url: 'https://x.com/test/status/123'
        }
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.checkQuoteDuplicate).toHaveBeenCalledWith(
        'Test quote',
        'kpaxs',
        'https://x.com/test/status/123',
        undefined
      );
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        result: mockDuplicateResult,
        ...mockDuplicateResult
      });
    });

    test('uses source_url as the identifier-only automatic preflight probe', async () => {
      mockApiClient.preflightCheck.mockResolvedValue({
        originator: { found: false, handle: 'test', platform: 'twitter' },
        duplicate_check: {
          recommendation: 'new_quote',
          confidence: 1,
          in_quotewise: false,
          matches: [],
          reasoning: 'No match',
          search_metadata: {},
        },
      });
      const sourceUrl = 'https://x.com/test/status/123';

      await apiHandler.handleMessage({
        type: 'PREFLIGHT_CHECK' as MessageType,
        data: { handle: 'test', platform: 'twitter', source_url: sourceUrl },
      }, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.preflightCheck).toHaveBeenCalledWith(
        'test',
        'twitter',
        sourceUrl,
        sourceUrl,
      );
      expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('handles SUBMIT_QUOTE message', async () => {
      const mockSubmissionResult = {
        success: true,
        message: 'Quote submitted successfully',
        quoteId: 'quote-123'
      };
      mockApiClient.submitQuote.mockResolvedValue(mockSubmissionResult);

      const quoteData = {
        quote_text: 'Test quote',
        sighting_url: 'https://twitter.com/test/status/123',
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

      const message: ExtensionMessage = {
        type: 'SUBMIT_QUOTE' as MessageType,
        data: quoteData
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.submitQuote).toHaveBeenCalledWith(quoteData);
      expect(mockSendResponse).toHaveBeenCalledWith(mockSubmissionResult);
    });

    test('handles ADD_QUOTE_TO_COLLECTION message', async () => {
      mockApiClient.addQuoteToCollection.mockResolvedValue({ success: true });

      const message: ExtensionMessage = {
        type: 'ADD_QUOTE_TO_COLLECTION' as MessageType,
        data: { collectionSlug: 'favorites', quoteId: 'quote-123' }
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.addQuoteToCollection).toHaveBeenCalledWith('favorites', 'quote-123');
      expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('serves LIST_COLLECTIONS from fresh local cache', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      mockChrome.storage.local.get.mockResolvedValue({
        collectionsCache: {
          collections: [{ id: '1', slug: 'favorites', name: 'Favorites' }],
          default_collection_id: '1',
          ts: 1_000_000 - 60_000,
        },
      });

      const message: ExtensionMessage = {
        type: 'LIST_COLLECTIONS' as MessageType,
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.listCollections).not.toHaveBeenCalled();
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        collections: [{ id: '1', slug: 'favorites', name: 'Favorites' }],
        default_collection_id: '1',
        fromCache: true,
      });
    });

    test('does not serve LIST_COLLECTIONS from a fresh cache containing blank slugs', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_500_000);
      mockChrome.storage.local.get.mockResolvedValue({
        collectionsCache: {
          collections: [
            { id: '1', slug: 'favorites', name: 'Favorites' },
            { id: '2', slug: '', name: 'Stale Collection' },
          ],
          default_collection_id: '1',
          ts: 1_500_000 - 60_000,
        },
      });
      mockApiClient.listCollections.mockResolvedValue({
        collections: [{ id: '3', slug: 'fresh', name: 'Fresh' }],
        default_collection_id: '3',
      } as never);

      const message: ExtensionMessage = {
        type: 'LIST_COLLECTIONS' as MessageType,
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.listCollections).toHaveBeenCalledTimes(1);
      expect(mockChrome.storage.local.set).toHaveBeenCalledWith({
        collectionsCache: {
          collections: [{ id: '3', slug: 'fresh', name: 'Fresh' }],
          default_collection_id: '3',
          ts: 1_500_000,
        },
      });
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        collections: [{ id: '3', slug: 'fresh', name: 'Fresh' }],
        default_collection_id: '3',
        fromCache: false,
      });
    });

    test('bypasses LIST_COLLECTIONS cache when forceRefresh is true', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
      mockChrome.storage.local.get.mockResolvedValue({
        collectionsCache: {
          collections: [{ id: '1', slug: 'old', name: 'Old' }],
          default_collection_id: '1',
          ts: 2_000_000,
        },
      });
      mockApiClient.listCollections.mockResolvedValue({
        collections: [{ id: '2', slug: 'fresh', name: 'Fresh' }],
        default_collection_id: '2',
      } as never);

      const message: ExtensionMessage = {
        type: 'LIST_COLLECTIONS' as MessageType,
        data: { forceRefresh: true },
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.listCollections).toHaveBeenCalledTimes(1);
      expect(mockChrome.storage.local.set).toHaveBeenCalledWith({
        collectionsCache: {
          collections: [{ id: '2', slug: 'fresh', name: 'Fresh' }],
          default_collection_id: '2',
          ts: 2_000_000,
        },
      });
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        collections: [{ id: '2', slug: 'fresh', name: 'Fresh' }],
        default_collection_id: '2',
        fromCache: false,
      });
    });

    test('handles unknown message type', async () => {
      const message: ExtensionMessage = {
        type: 'UNKNOWN_MESSAGE' as MessageType
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Unknown message type: UNKNOWN_MESSAGE'
      });
    });

    test('handles API errors gracefully', async () => {
      const error = new Error('API request failed');
      mockApiClient.searchOriginators.mockRejectedValue(error);

      const message: ExtensionMessage = {
        type: 'SEARCH_ORIGINATORS' as MessageType,
        data: { query: 'test' }
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'API request failed',
        results: []
      });
    });
  });

  describe('Error Handling', () => {
    let mockSendResponse: jest.Mock;

    beforeEach(() => {
      mockSendResponse = jest.fn();
    });

    test('handles authentication errors in search', async () => {
      const authError = new Error('Authentication required');
      authError.name = 'AuthenticationError';
      mockApiClient.searchOriginators.mockRejectedValue(authError);

      const message: ExtensionMessage = {
        type: 'SEARCH_ORIGINATORS' as MessageType,
        data: { query: 'test' }
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        authRequired: true,
        authFailureType: 'session_expired',
        error: 'Authentication required',
        results: []
      });
    });

    test('marks insufficient privilege errors for service worker auth handling', async () => {
      const authError = new Error('Insufficient permissions');
      authError.name = 'AuthenticationError';
      mockApiClient.checkQuoteDuplicate.mockRejectedValue(authError);

      const message: ExtensionMessage = {
        type: 'CHECK_DUPLICATE' as MessageType,
        data: { text: 'test' }
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        authRequired: true,
        authFailureType: 'insufficient_privileges',
        error: 'Insufficient permissions',
      }));
    });

    test('provides fallback responses for duplicate check errors', async () => {
      mockApiClient.checkQuoteDuplicate.mockRejectedValue(new Error('Server error'));

      const message: ExtensionMessage = {
        type: 'CHECK_DUPLICATE' as MessageType,
        data: { text: 'test' }
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Server error',
        hasDuplicates: false,
        duplicates: []
      });
    });
  });
});
