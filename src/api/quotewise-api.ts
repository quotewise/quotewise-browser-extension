/**
 * Quotewise API client with OAuth 2.0 Bearer token authentication
 * Follows exact patterns from quotewise/rest_api.py and quote_collection.js
 */

import type {
  QuotewiseApiClient,
  OriginatorSearchResult,
  DuplicateCheckResult,
  QuoteSubmissionRequest,
  QuoteSubmissionResult,
  AddToCollectionResult,
  AuthStatusResult,
  CollectionsListResponse,
  HandleLookupResult,
  PreflightResult,
  QuoteMatch,
  AuthenticationError,
  ApiError
} from '../types/api';
import { getEnvironmentConfig, debugLog } from '../config/environment';
import { authBackend } from '../auth/auth-backend';

/** Max characters of quote text sent to the preflight endpoint (enough for duplicate matching). */
const MAX_PREFLIGHT_TEXT_LENGTH = 2000;

function normalizeMemberCollections(value: unknown): { slug: string; name: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is { slug: string; name: string } => (
      isRecord(item) &&
      typeof item.slug === 'string' &&
      item.slug.trim().length > 0 &&
      typeof item.name === 'string'
    ))
    .map(item => ({ slug: item.slug.trim(), name: item.name }));
}

function normalizeDuplicateCheckResult(result: DuplicateCheckResult): DuplicateCheckResult {
  return {
    ...result,
    matches: Array.isArray(result.matches)
      ? result.matches.map(match => ({
          ...match,
          member_collections: normalizeMemberCollections(
            (match as { member_collections?: unknown }).member_collections
          ),
        }))
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function coerceId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function extractSubmittedQuoteId(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  return coerceId(result.version_id);
}

function normalizeCollection(value: unknown): CollectionsListResponse['collections'][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  const name = value.name;
  const slug = value.slug;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof slug !== 'string' ||
    !slug.trim()
  ) {
    return null;
  }

  return {
    id,
    name,
    slug: slug.trim(),
    description: typeof value.description === 'string' ? value.description : '',
    is_default: value.is_default === true,
    quote_count: typeof value.quote_count === 'number' ? value.quote_count : 0,
    created_at: typeof value.created_at === 'string' ? value.created_at : '',
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : '',
  };
}

function normalizeCollectionsListResponse(result: unknown): CollectionsListResponse {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    return { collections: [], default_collection_id: null };
  }

  const collections = result.data
    .map(normalizeCollection)
    .filter((collection): collection is CollectionsListResponse['collections'][number] => collection !== null);

  return {
    collections,
    default_collection_id: collections.find(collection => collection.is_default)?.id || null,
  };
}

/**
 * Main API client implementation with OAuth 2.0 Bearer token support
 * Following patterns from quotewise/rest_api.py and quote_collection.js
 */
export class QuotewiseApiClientImpl implements QuotewiseApiClient {
  public readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || getEnvironmentConfig().apiBaseUrl;
  }

  /**
   * Get headers for an authenticated API request. Fail-closed: if no token is available (signed
   * out, or on Safari a dropped/failed bridge response), THROW rather than send the request
   * unauthenticated — otherwise capture/preflight data would egress anonymously before the 401
   * (Constitution III; contracts/native-messaging.md, api-consumption.md). `forceRefresh` rotates
   * the token (used on the one 401 retry).
   */
  private async getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
    const accessToken = await authBackend.accessToken(forceRefresh);
    if (!accessToken) {
      const authError = new Error('Authentication required') as Error & { name: string };
      authError.name = 'AuthenticationError';
      throw authError as AuthenticationError;
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    };
  }

  /**
   * Make authenticated request to API using Bearer token
   * Automatically refreshes token on 401 and retries once
   * @param endpoint API endpoint path
   * @param options Fetch options
   * @param _requireCSRF Deprecated - kept for backwards compatibility
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    _requireCSRF: boolean = true,
    retried: boolean = false
  ): Promise<T> {
    try {
      const method = (options.method || 'GET').toUpperCase();

      // Bearer token (force-refreshed on the retry). Throws AuthenticationError if none — fail-closed.
      const headers = await this.getAuthHeaders(retried);

      const requestOptions: RequestInit = {
        headers: { ...headers, ...(options.headers || {}) },
        ...options
      };

      // Log full request details for debugging
      const bodyForLog = options.body ? JSON.parse(options.body as string) : 'None';
      debugLog(`Making ${method} request to ${endpoint}`, {
        hasAuth: !!headers['Authorization'],
        body: bodyForLog
      });

      const response = await fetch(`${this.baseUrl}${endpoint}`, requestOptions);

      debugLog(`API Response: ${response.status} for ${endpoint}`, {
        status: response.status,
        statusText: response.statusText
      });

      if (!response.ok) {
        // 401 → force ONE token refresh (Safari: the app rotates via the broker; Chrome: refresh
        // grant) and retry once. `retried` is threaded through this request's own recursion, not a
        // shared client flag, so concurrent requests don't suppress each other's recovery.
        if (response.status === 401) {
          if (!retried) {
            debugLog('Got 401, forcing token refresh and retrying once');
            return await this.makeRequest<T>(endpoint, options, _requireCSRF, true);
          }
          // Still 401 after a forced refresh → genuinely unauthenticated.
          const authError = new Error('Authentication required') as Error & { name: string };
          authError.name = 'AuthenticationError';
          throw authError as AuthenticationError;
        }

        if (response.status === 403) {
          console.error(`Authorization failed: ${response.status} ${response.statusText}`);
          const authError = new Error('Insufficient permissions') as Error & { name: string };
          authError.name = 'AuthenticationError';
          throw authError as AuthenticationError;
        }

        // Try to get error details from response
        let errorMessage = `API error: ${response.status}`;
        try {
          const errorData = await response.json();
          console.error('API error response:', JSON.stringify(errorData, null, 2));

          // Handle DRF validation errors (field-level errors)
          if (errorData.errors && typeof errorData.errors === 'object') {
            // Handle array of error objects or object with field keys
            if (Array.isArray(errorData.errors)) {
              errorMessage = errorData.errors
                .map((err: Record<string, unknown>) => {
                  if (typeof err === 'string') return err;
                  // Extract field and message from error object
                  const field = err.field || err.attr || 'error';
                  const msg = err.detail || err.message || JSON.stringify(err);
                  return `${field}: ${msg}`;
                })
                .join('; ');
            } else {
              const fieldErrors = Object.entries(errorData.errors)
                .map(([field, messages]) => {
                  if (Array.isArray(messages)) {
                    return `${field}: ${messages.map(m => typeof m === 'object' ? JSON.stringify(m) : m).join(', ')}`;
                  }
                  return `${field}: ${typeof messages === 'object' ? JSON.stringify(messages) : messages}`;
                })
                .join('; ');
              errorMessage = fieldErrors;
            }
          } else {
            errorMessage = errorData.error || errorData.detail || errorData.message || errorMessage;
          }
        } catch {
          // Ignore JSON parsing errors, use default message
        }

        const apiError = new Error(errorMessage) as Error & { name: string; statusCode?: number };
        apiError.name = 'ApiError';
        apiError.statusCode = response.status;
        throw apiError as ApiError;
      }

      return await response.json();
    } catch (error) {
      // Re-throw known error types
      if (error instanceof Error && (
        error.name === 'AuthenticationError' ||
        error.name === 'ApiError'
      )) {
        throw error;
      }

      // Handle network errors and other exceptions
      console.error('API request failed:', error);
      const apiError = new Error(
        error instanceof Error ? error.message : 'Network error occurred'
      ) as Error & { name: string };
      apiError.name = 'ApiError';
      throw apiError as ApiError;
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
        `/v1/originators/search/?${params}`
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
      const result = await this.makeRequest<AuthStatusResult>('/v1/auth/status/');
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
  async checkQuoteDuplicate(text: string, originatorSlug?: string, sourceUrl?: string, socialHandle?: string): Promise<DuplicateCheckResult> {
    if (!text.trim()) {
      return {
        recommendation: 'new_quote',
        confidence: 1.0,
        in_quotewise: false,
        matches: [],
        reasoning: 'No quote text provided',
        search_metadata: {}
      };
    }
    
    const requestStartedAt = Date.now();
    try {
      const payload = {
        text: text.trim(),
        originator_slug: originatorSlug || undefined,
        source_url: sourceUrl,
        social_handle: socialHandle
      };
      
      const result = await this.makeRequest<DuplicateCheckResult>(
        '/v1/quotes/check_duplicate/',
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );
      const clientRttMs = Date.now() - requestStartedAt;
      const normalized = normalizeDuplicateCheckResult(result);
      return {
        ...normalized,
        search_metadata: {
          ...normalized.search_metadata,
          client_rtt_ms: clientRttMs,
        },
      };
    } catch (error) {
      console.error('Error checking duplicates:', error);
      if (error instanceof Error && error.name === 'AuthenticationError') {
        throw error;
      }
      
      // Return a structured error state so the UI can block and offer Retry.
      return {
        recommendation: 'new_quote',
        confidence: 0,
        in_quotewise: false,
        matches: [],
        reasoning: "Couldn't verify duplicates",
        search_metadata: { error: true, client_rtt_ms: Date.now() - requestStartedAt }
      };
    }
  }

  /**
   * Submit quote to Django API
   */
  async submitQuote(quoteData: QuoteSubmissionRequest): Promise<QuoteSubmissionResult> {
    try {
      // Validate required fields
      if (!quoteData.text?.trim()) {
        return {
          success: false,
          message: 'Quote text is required',
          error: 'Quote text is required'
        };
      }

      if (!quoteData.source_url?.trim()) {
        return {
          success: false,
          message: 'Source URL is required',
          error: 'Source URL is required'
        };
      }

      const submitPayload = { ...quoteData } as Record<string, unknown>;
      delete submitPayload.collection_id;

      const result = await this.makeRequest<{
        version_id?: string | number | null;
        message?: string;
        collection_warning?: string;
        action?: QuoteSubmissionResult['action'];
        attribution_conflicts?: QuoteMatch[];
      }>(
        '/v1/quotes/',
        {
          method: 'POST',
          body: JSON.stringify(submitPayload)
        }
      );
      
      return {
        success: true,
        message: result.message || 'Quote submitted successfully',
        quoteId: extractSubmittedQuoteId(result),
        collectionWarning: result.collection_warning,
        action: result.action,
        // Present only when non-empty; omitted entirely rather than sent as []
        // so the overlay's "did anything come back" check stays a length check.
        ...(Array.isArray(result.attribution_conflicts) && result.attribution_conflicts.length > 0
          ? { attributionConflicts: result.attribution_conflicts }
          : {})
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
   * Add an existing quote to a user-owned collection by collection slug.
   */
  async addQuoteToCollection(collectionSlug: string, quoteId: string): Promise<AddToCollectionResult> {
    if (!collectionSlug.trim()) {
      return { success: false, error: 'Collection slug is required' };
    }

    if (!quoteId.trim()) {
      return { success: false, error: 'Quote ID is required' };
    }

    try {
      await this.makeRequest<unknown>(
        `/v1/collections/${encodeURIComponent(collectionSlug)}/quotes/`,
        {
          method: 'POST',
          body: JSON.stringify({ quote_id: quoteId })
        }
      );

      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.name === 'AuthenticationError') {
        throw error;
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to add quote to collection',
      };
    }
  }

  /**
   * List user's collections
   */
  async listCollections(): Promise<CollectionsListResponse> {
    try {
      const result = await this.makeRequest<unknown>(
        '/v1/collections/',
        { method: 'GET' }
      );

      return normalizeCollectionsListResponse(result);
    } catch (error) {
      console.error('Error listing collections:', error);

      // Return empty collections list on error
      return {
        collections: [],
        default_collection_id: null
      };
    }
  }

  /**
   * Lookup originator by social media handle
   * Uses /api/v1/originators/by-handle/ endpoint
   */
  async lookupOriginatorByHandle(
    handle: string,
    platform: string = 'twitter'
  ): Promise<HandleLookupResult> {
    // Handle empty input
    if (!handle?.trim()) {
      return {
        found: false,
        handle: handle || '',
        platform,
        create_url: undefined
      };
    }

    // Normalize handle - strip @ prefix if present
    const cleanHandle = handle.trim().replace(/^@/, '');
    const requestStartedAt = Date.now();

    try {
      const params = new URLSearchParams({
        handle: cleanHandle,
        platform
      });

      interface ByHandleApiResponse {
        found: boolean;
        originator?: {
          id: number;
          full_name: string;
          slug?: string;
          unique_id?: string;
          social_handles?: Record<string, string>;
        };
        match_platform?: string;
        confidence?: number;
        create_url?: string;
        handle?: string;
        platform?: string;
      }

      const result = await this.makeRequest<ByHandleApiResponse>(
        `/v1/originators/by-handle/?${params}`,
        { method: 'GET' },
        false  // No CSRF needed for GET
      );
      const clientRttMs = Date.now() - requestStartedAt;

      if (result.found && result.originator) {
        const uniqueId = result.originator.unique_id ?? result.originator.slug;
        if (!uniqueId) {
          return {
            found: false,
            handle: cleanHandle,
            platform,
            create_url: result.create_url,
            client_rtt_ms: clientRttMs
          };
        }

        // Transform API response to match OriginatorSearchResult format
        return {
          found: true,
          originator: {
            id: result.originator.id,
            unique_id: uniqueId,
            full_name: result.originator.full_name,
            sort_name_display: result.originator.full_name,  // API may not return sort_name
            confidence: result.confidence ?? 1.0
          },
          handle: cleanHandle,
          platform,
          match_platform: result.match_platform,
          confidence: result.confidence,
          client_rtt_ms: clientRttMs
        };
      } else {
        // Not found - return create URL
        return {
          found: false,
          handle: cleanHandle,
          platform,
          create_url: result.create_url,
          client_rtt_ms: clientRttMs
        };
      }
    } catch (error) {
      console.error('Error looking up originator by handle:', error);

      // Re-throw auth errors
      if (error instanceof Error && error.name === 'AuthenticationError') {
        throw error;
      }

      // Return not found for other errors to allow graceful degradation
      return {
        found: false,
        handle: cleanHandle,
        platform,
        create_url: undefined,
        client_rtt_ms: Date.now() - requestStartedAt
      };
    }
  }

  /**
   * Combined originator lookup + duplicate check (preflight)
   * Reduces round-trips from 2 API calls to 1 for faster feedback
   */
  async preflightCheck(
    handle: string,
    platform: string = 'twitter',
    text: string,
    sourceUrl: string
  ): Promise<PreflightResult> {
    // Normalize handle - strip @ prefix if present
    const cleanHandle = handle.trim().replace(/^@/, '');

    try {
      const result = await this.makeRequest<PreflightResult>(
        '/v1/quotes/preflight/',
        {
          method: 'POST',
          body: JSON.stringify({
            handle: cleanHandle,
            platform,
            // Cap the text: preflight only needs it for duplicate matching, and
            // sending a full long-form X Article body (~11k chars) can fail the
            // call, leaving the originator cache cold and forcing the by-handle
            // fallback. A short prefix is plenty for a quote match.
            text: text.slice(0, MAX_PREFLIGHT_TEXT_LENGTH),
            source_url: sourceUrl
          })
        }
      );

      debugLog('Preflight check result:', {
        originator_found: result.originator?.found,
        recommendation: result.duplicate_check?.recommendation
      });

      return {
        ...result,
        duplicate_check: result.duplicate_check
          ? normalizeDuplicateCheckResult(result.duplicate_check)
          : result.duplicate_check,
      };
    } catch (error) {
      console.error('Error in preflight check:', error);

      // Re-throw auth errors
      if (error instanceof Error && error.name === 'AuthenticationError') {
        throw error;
      }

      // Return default result for other errors to allow graceful degradation
      return {
        originator: {
          found: false,
          handle: cleanHandle,
          platform,
          create_url: undefined
        },
        duplicate_check: {
          recommendation: 'new_quote',
          confidence: 0.5,
          in_quotewise: false,
          matches: [],
          reasoning: 'Error occurred during preflight check',
          search_metadata: { error: true }
        }
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
