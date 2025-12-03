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
    baseUrl: 'http://localhost:8001',
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
    apiBaseUrl: 'http://localhost:8001',
    sessionCookieName: 'sessionid',
    secure: false
  }))
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
      expect(QuotewiseApiClientImpl).toHaveBeenCalledWith('http://localhost:8001');
    });

    test('provides environment info', () => {
      const envInfo = apiHandler.getEnvironmentInfo();
      expect(envInfo).toEqual({
        environment: 'development',
        baseUrl: 'http://localhost:8001'
      });
    });
  });

  describe('Message Handling', () => {
    let mockSendResponse: jest.Mock;

    beforeEach(() => {
      mockSendResponse = jest.fn();
    });

    test('handles CHECK_AUTH_STATUS message', async () => {
      const mockAuthResult = {
        authenticated: true,
        is_admin: false,
        user: { id: 1, username: 'testuser', email: 'test@example.com' },
        permissions: { can_submit_quotes: true, can_review_quotes: false }
      };
      mockApiClient.checkAuthStatus.mockResolvedValue(mockAuthResult);

      const message: ExtensionMessage = {
        type: 'CHECK_AUTH_STATUS' as MessageType
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.checkAuthStatus).toHaveBeenCalled();
      // ApiHandler transforms the response to match AuthChecker format
      expect(mockSendResponse).toHaveBeenCalledWith({
        isAuthenticated: true,
        isStaff: false,
        username: 'testuser'
      });
    });

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
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No duplicates found',
        search_metadata: {}
      };
      mockApiClient.checkQuoteDuplicate.mockResolvedValue(mockDuplicateResult);

      const message: ExtensionMessage = {
        type: 'CHECK_DUPLICATE' as MessageType,
        data: { text: 'Test quote', originatorId: '1' }
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      expect(mockApiClient.checkQuoteDuplicate).toHaveBeenCalledWith('Test quote', '1');
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
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
      mockApiClient.checkAuthStatus.mockRejectedValue(error);

      const message: ExtensionMessage = {
        type: 'CHECK_AUTH_STATUS' as MessageType
      };

      await apiHandler.handleMessage(message, {} as chrome.runtime.MessageSender, mockSendResponse);

      // ApiHandler.handleCheckAuthStatus catches errors and returns transformed error
      expect(mockSendResponse).toHaveBeenCalledWith({
        isAuthenticated: false,
        isStaff: false,
        error: 'API request failed'
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
        error: 'Authentication required',
        results: []
      });
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