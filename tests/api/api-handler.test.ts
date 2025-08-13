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
    submitQuote: jest.fn()
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
  let messageListener: (message: any, sender: any, sendResponse: any) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Capture the message listener
    mockChrome.runtime.onMessage.addListener.mockImplementation((listener) => {
      messageListener = listener;
    });

    apiHandler = new ApiHandler();
    
    // Get the mocked API client instance
    mockApiClient = (QuotewiseApiClientImpl as jest.Mock).mock.results[0].value;
  });

  describe('Initialization', () => {
    test('initializes with correct environment', () => {
      expect(QuotewiseApiClientImpl).toHaveBeenCalledWith('http://localhost:8001');
      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalled();
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
        isAuthenticated: true,
        userInfo: { username: 'testuser', isAdmin: false }
      };
      mockApiClient.checkAuthStatus.mockResolvedValue(mockAuthResult);

      const message: ExtensionMessage = {
        type: 'CHECK_AUTH_STATUS' as MessageType
      };

      await messageListener(message, {}, mockSendResponse);

      expect(mockApiClient.checkAuthStatus).toHaveBeenCalled();
      expect(mockSendResponse).toHaveBeenCalledWith(mockAuthResult);
    });

    test('handles SEARCH_ORIGINATORS message', async () => {
      const mockResults = [
        { id: '1', full_name: 'Albert Einstein', sort_name: 'Einstein, Albert' }
      ];
      mockApiClient.searchOriginators.mockResolvedValue(mockResults);

      const message: ExtensionMessage = {
        type: 'SEARCH_ORIGINATORS' as MessageType,
        data: { query: 'Einstein', limit: 10 }
      };

      await messageListener(message, {}, mockSendResponse);

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

      await messageListener(message, {}, mockSendResponse);

      expect(mockApiClient.searchOriginators).not.toHaveBeenCalled();
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Search query is required'
      });
    });

    test('handles CHECK_DUPLICATE_QUOTE message', async () => {
      const mockDuplicateResult = {
        hasDuplicates: false,
        duplicates: [],
        similarityThreshold: 0.8
      };
      mockApiClient.checkQuoteDuplicate.mockResolvedValue(mockDuplicateResult);

      const message: ExtensionMessage = {
        type: 'CHECK_DUPLICATE' as MessageType,
        data: { text: 'Test quote', originatorId: '1' }
      };

      await messageListener(message, {}, mockSendResponse);

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

      await messageListener(message, {}, mockSendResponse);

      expect(mockApiClient.submitQuote).toHaveBeenCalledWith(quoteData);
      expect(mockSendResponse).toHaveBeenCalledWith(mockSubmissionResult);
    });

    test('handles GET_TWEET_DATA message', async () => {
      mockChrome.tabs.query.mockResolvedValue([{ id: 123 }]);
      mockChrome.tabs.sendMessage.mockResolvedValue({
        success: true,
        data: { text: 'Tweet text', url: 'https://twitter.com/test/status/123' }
      });

      const message: ExtensionMessage = {
        type: 'GET_TWEET_DATA' as MessageType
      };

      await messageListener(message, {}, mockSendResponse);

      expect(mockChrome.tabs.query).toHaveBeenCalledWith({
        active: true,
        currentWindow: true
      });
      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
        type: 'GET_TWEET_DATA'
      });
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: { text: 'Tweet text', url: 'https://twitter.com/test/status/123' }
      });
    });

    test('handles unknown message type', async () => {
      const message: ExtensionMessage = {
        type: 'UNKNOWN_MESSAGE' as MessageType
      };

      await messageListener(message, {}, mockSendResponse);

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

      await messageListener(message, {}, mockSendResponse);

      // checkAuthStatus catches errors and returns { isAuthenticated: false, error: ... }
      expect(mockSendResponse).toHaveBeenCalledWith({
        isAuthenticated: false,
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

      await messageListener(message, {}, mockSendResponse);

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

      await messageListener(message, {}, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Server error',
        hasDuplicates: false,
        duplicates: [],
        similarityThreshold: 0.8
      });
    });
  });

  describe('Tweet Data Handling', () => {
    let mockSendResponse: jest.Mock;

    beforeEach(() => {
      mockSendResponse = jest.fn();
    });

    test('handles no active tab', async () => {
      mockChrome.tabs.query.mockResolvedValue([]);

      const message: ExtensionMessage = {
        type: 'GET_TWEET_DATA' as MessageType
      };

      await messageListener(message, {}, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No active tab found',
        data: null
      });
    });

    test('handles content script errors', async () => {
      mockChrome.tabs.query.mockResolvedValue([{ id: 123 }]);
      mockChrome.tabs.sendMessage.mockResolvedValue({
        success: false,
        error: 'No tweet found'
      });

      const message: ExtensionMessage = {
        type: 'GET_TWEET_DATA' as MessageType
      };

      await messageListener(message, {}, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'No tweet found',
        data: null
      });
    });
  });
});