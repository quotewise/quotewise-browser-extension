/**
 * Quotewise API client with Django session authentication
 * Follows exact patterns from quotewise/rest_api.py and quote_collection.js
 */

import type {
  QuotewiseApiClient,
  OriginatorSearchResult,
  DuplicateCheckResult,
  QuoteSubmissionRequest,
  QuoteSubmissionResult,
  AuthStatusResult,
  CollectionsListResponse,
  AuthenticationError,
  ApiError
} from '../types/api';
import { getDefaultHeaders, getReadOnlyHeaders, CSRFTokenError } from './csrf-utils';
import { getEnvironmentConfig, debugLog } from '../config/environment';

/**
 * Main API client implementation with Django session support
 * Following patterns from quotewise/rest_api.py and quote_collection.js
 */
export class QuotewiseApiClientImpl implements QuotewiseApiClient {
  public readonly baseUrl: string;
  
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || getEnvironmentConfig().apiBaseUrl;
  }

  /**
   * Make authenticated request to Django API
   * Includes CSRF tokens and session cookies automatically
   * @param endpoint API endpoint path
   * @param options Fetch options
   * @param requireCSRF Whether CSRF token is required (default: true for POST/PUT/DELETE)
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    requireCSRF: boolean = true
  ): Promise<T> {
    try {
      // Determine if CSRF is required based on method
      const method = (options.method || 'GET').toUpperCase();
      const needsCSRF = requireCSRF && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

      // Get headers - use read-only headers for GET requests, default headers for others
      const headers = needsCSRF
        ? await getDefaultHeaders(this.baseUrl)
        : await getReadOnlyHeaders(this.baseUrl);

      const requestOptions: RequestInit = {
        credentials: 'include',  // Include session cookies
        headers: { ...headers, ...(options.headers || {}) },
        ...options
      };

      debugLog(`Making ${method} request to ${endpoint}`, {
        headers: requestOptions.headers,
        body: options.body || 'None'
      });

      const response = await fetch(`${this.baseUrl}${endpoint}`, requestOptions);

      debugLog(`API Response: ${response.status} for ${endpoint}`, {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          console.error(`Authentication failed: ${response.status} ${response.statusText}`);

          // Try to get the error response body for more details
          try {
            const errorText = await response.text();
            console.error('Error response body:', errorText);
          } catch (e) {
            console.error('Could not read error response body');
          }

          const authError: AuthenticationError = new Error('Authentication required') as any;
          authError.name = 'AuthenticationError';
          throw authError;
        }

        // Try to get error details from response
        let errorMessage = `API error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.detail || errorMessage;
        } catch {
          // Ignore JSON parsing errors, use default message
        }

        const apiError: ApiError = new Error(errorMessage) as any;
        apiError.name = 'ApiError';
        apiError.statusCode = response.status;
        throw apiError;
      }

      return await response.json();
    } catch (error) {
      // Re-throw known error types
      if (error instanceof Error && (
        error.name === 'AuthenticationError' ||
        error.name === 'ApiError' ||
        error.name === 'CSRFTokenError'
      )) {
        throw error;
      }

      // Handle CSRF token errors specifically
      if (error instanceof CSRFTokenError) {
        const authError: AuthenticationError = new Error(error.message) as any;
        authError.name = 'AuthenticationError';
        throw authError;
      }

      // Handle network errors and other exceptions
      console.error('API request failed:', error);
      const apiError: ApiError = new Error(
        error instanceof Error ? error.message : 'Network error occurred'
      ) as any;
      apiError.name = 'ApiError';
      throw apiError;
    }
  }

  /**
   * Search originators using existing endpoint
   * Uses existing endpoint from quotewise/rest_api.py:894-975
   */
  async searchOriginators(query: string, limit = 10): Promise<OriginatorSearchResult[]> {
    if (!query.trim()) {
      return [];
    }
    
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        limit: limit.toString()
      });
      
      const result = await this.makeRequest<{results: OriginatorSearchResult[]}>(
        `/api/v1/originators/search/?${params}`
      );
      
      return result.results || [];
    } catch (error) {
      console.error('Error searching originators:', error);
      if (error instanceof Error && error.name === 'AuthenticationError') {
        throw error;
      }
      // Return empty array for other errors to allow graceful degradation
      return [];
    }
  }

  /**
   * Check authentication status
   */
  async checkAuthStatus(): Promise<AuthStatusResult> {
    try {
      const result = await this.makeRequest<AuthStatusResult>('/api/v1/auth/status/');
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AuthenticationError') {
        return { 
          authenticated: false, 
          is_admin: false, 
          permissions: { can_submit_quotes: false, can_review_quotes: false } 
        };
      }
      
      // For other errors, assume not authenticated
      console.error('Error checking auth status:', error);
      return { 
        authenticated: false, 
        is_admin: false, 
        permissions: { can_submit_quotes: false, can_review_quotes: false } 
      };
    }
  }

  /**
   * Check for duplicate quotes
   */
  async checkQuoteDuplicate(text: string, originatorId?: string, sourceUrl?: string, socialHandle?: string): Promise<DuplicateCheckResult> {
    if (!text.trim()) {
      return {
        recommendation: 'new_quote',
        confidence: 1.0,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'No quote text provided',
        search_metadata: {}
      };
    }
    
    try {
      const payload = {
        text: text.trim(),
        originator_id: originatorId ? parseInt(originatorId) : undefined,
        source_url: sourceUrl,
        social_handle: socialHandle
      };
      
      const result = await this.makeRequest<DuplicateCheckResult>(
        '/api/v1/quotes/check_duplicate/',
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );
      
      return result;
    } catch (error) {
      console.error('Error checking duplicates:', error);
      if (error instanceof Error && error.name === 'AuthenticationError') {
        throw error;
      }
      
      // Return no duplicates for other errors to allow submission
      return {
        recommendation: 'new_quote',
        confidence: 0.5,
        in_quotosaurus: false,
        matches: [],
        reasoning: 'Error occurred during duplicate check, proceeding as new quote',
        search_metadata: { error: true }
      };
    }
  }

  /**
   * Submit quote to Django API
   */
  async submitQuote(quoteData: QuoteSubmissionRequest): Promise<QuoteSubmissionResult> {
    try {
      // Validate required fields
      if (!quoteData.quote_text?.trim()) {
        return {
          success: false,
          message: 'Quote text is required',
          error: 'Quote text is required'
        };
      }
      
      if (!quoteData.sighting_url?.trim()) {
        return {
          success: false,
          message: 'Sighting URL is required',
          error: 'Sighting URL is required'
        };
      }
      
      const result = await this.makeRequest<{ id: string; message?: string }>(
        '/api/v1/quotes/',
        {
          method: 'POST',
          body: JSON.stringify(quoteData)
        }
      );
      
      return {
        success: true,
        message: result.message || 'Quote submitted successfully',
        quoteId: result.id
      };
    } catch (error) {
      console.error('Error submitting quote:', error);
      
      let errorMessage = 'Failed to submit quote';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return {
        success: false,
        message: errorMessage,
        error: errorMessage
      };
    }
  }

  /**
   * List user's collections
   */
  async listCollections(): Promise<CollectionsListResponse> {
    try {
      const result = await this.makeRequest<CollectionsListResponse>(
        '/api/v1/collections/',
        { method: 'GET' }
      );
      
      return result;
    } catch (error) {
      console.error('Error listing collections:', error);
      
      // Return empty collections list on error
      return {
        collections: [],
        default_collection_id: null
      };
    }
  }
}

/**
 * Create API client instance with environment detection
 */
export function createApiClient(environment?: string): QuotewiseApiClient {
  const config = getEnvironmentConfig(environment);
  return new QuotewiseApiClientImpl(config.apiBaseUrl);
}

/**
 * Default API client instance
 */
export const apiClient = createApiClient();

// Backwards compatibility
export const quotewiseApi = apiClient;