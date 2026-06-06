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
    listCollections: jest.fn()
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

    apiHandler = new ApiHandler();

    // Get the mocked API client instance
    mockApiClient = (QuotewiseApiClientImpl as jest.Mock).mock.results[0].value;
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
        duplicates: [],
        similarityThreshold: 0.8
      });
    });
  });
});
