/**
 * API type definitions and interfaces for Quotewise Chrome extension
 * Matches the Django backend API contract and popup expectations
 */

// Core API response interfaces matching popup expectations
export interface AuthStatusResult {
  authenticated: boolean;
  is_admin: boolean;
  user?: {
    id: number;
    username: string;
    email: string;
  };
  permissions: {
    can_submit_quotes: boolean;
    can_review_quotes: boolean;
  };
  sessionExpiry?: string; // ISO date string
}

export interface OriginatorSearchResult {
  id: number;                    // Django API returns numeric ID
  unique_id: string;             // Slug-style identifier (e.g., "albert-einstein")
  full_name: string;             // Display name (e.g., "Albert Einstein")
  sort_name_display: string;     // Formatted sort name (e.g., "Einstein, Albert")
  confidence: number | null;     // Search confidence score (0-10, from max_score)
}

export interface HandleLookupResult {
  found: boolean;
  originator?: OriginatorSearchResult;  // Present when found=true
  create_url?: string;                   // Present when found=false
  handle: string;
  platform: string;
  match_platform?: string;              // Platform where handle was matched
  confidence?: number;                   // Match confidence (1.0 for exact)
}

export interface DuplicateCheckResult {
  recommendation: 'duplicate' | 'new_version' | 'new_quote' | 'attribution_conflict' |
                  'new_quote_known_author' | 'duplicate_known_author' | 'new_version_known_author' | 'attribution_conflict_resolved';
  confidence: number;
  in_quotosaurus: boolean;
  social_originator?: {
    id: number;
    full_name: string;
    handle: string;
    platform: string;
    platform_name: string;
    match_confidence: number;
  };
  suggested_originator_id?: number;
  matches: Array<{
    quote_id: string;
    version_id: number;
    text: string;
    similarity: number;
    match_type: string;
    in_user_collections: boolean;
    originator: Originator;
    workflow_status: string;
    likes_count: number;
  }>;
  existing_sightings_for_url?: Array<{
    id: number;
    quote_id: string;
    source_url: string;
  }>;
  reasoning: string;
  search_metadata: {
    originator_scoped?: boolean;
    social_handle_checked?: boolean;
    social_handle_matched?: boolean;
    source_url_checked?: boolean;
    total_matches?: number;
    query_time_ms?: number;
    error?: boolean;
  };
}

export interface QuoteSubmissionResult {
  success: boolean;
  message: string;
  quoteId?: string;
  error?: string;
  id?: string; // For Django response format
}

// Legacy interfaces for backwards compatibility
export interface OriginatorSearchResponse {
  results: OriginatorSearchResult[];
}

export interface Originator {
  id: string;
  full_name: string;
  sort_name: string | null;
  birth_year: number | null;
  death_year: number | null;
  quote_count?: number;
}

export interface QuoteSubmissionRequest {
  text: string;
  originator_id?: number;
  originator_search?: string;
  source_url: string;
  platform_code: PlatformCode;
  likes_count?: number;
  quote_date?: string;
  attribution_type: AttributionType;
  context?: string;
  image_urls?: string[];
  platform_data?: PlatformData;
}

export interface QuoteSubmissionResponse {
  status: 'created' | 'sighting_added' | 'version_created';
  quote_id: string;
  version_id: number;
  sighting_id?: number;
  similarity?: number;
  message?: string;
}

export interface DuplicateCheckRequest {
  quote_text: string;
  originator_id?: number;
}

export interface DuplicateCheckResponse {
  is_duplicate: boolean;
  similarity: number;
  existing_quote?: {
    id: string;
    version_id: number;
    text: string;
    originator: Originator;
  };
}

// Platform Types
export type PlatformCode = 'TX' | 'GR' | 'WQ' | 'BQ' | 'QI' | 'UN';

export interface PlatformData {
  tweet_id?: string | null;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  view_count?: number;
  is_protected?: boolean; // Backend dependency: API should honor this flag for private/limited-scope collections (feature parity pending)
  thread_position?: number;
  has_media?: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

// Attribution Types
export type AttributionType = 
  | 'DIRECT'
  | 'MISATTRIBUTION'
  | 'POPULARIZED'
  | 'PARAPHRASED'
  | 'DISPUTED'
  | 'TRADITIONAL'
  | 'FAMILY_TRADITION'
  | 'COMMUNITY_TRADITION';

// Session configuration matching Django settings
export interface SessionConfig {
  cookieName: string;        // "sessionid" or "stagingsessionid" 
  maxAge: number;           // 1814400 seconds (3 weeks)
  secure: boolean;          // true in production, false in development
  httpOnly: boolean;        // true
}

// Environment configuration
export interface EnvironmentConfig {
  apiBaseUrl: string;
  webBaseUrl: string;
  sessionCookieName: string;
  secure: boolean;
}

// API client interface
export interface QuotewiseApiClient {
  baseUrl: string;
  searchOriginators(query: string, limit?: number): Promise<OriginatorSearchResult[]>;
  checkQuoteDuplicate(text: string, originatorId?: string, sourceUrl?: string, socialHandle?: string): Promise<DuplicateCheckResult>;
  submitQuote(quoteData: QuoteSubmissionRequest): Promise<QuoteSubmissionResult>;
  checkAuthStatus(): Promise<AuthStatusResult>;
  listCollections(): Promise<CollectionsListResponse>;
  lookupOriginatorByHandle(handle: string, platform?: string): Promise<HandleLookupResult>;
}

// Collections
export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_default: boolean;
  quote_count: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionsListResponse {
  collections: Collection[];
  default_collection_id: string | null;
}

// Error classes
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// Generic API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  results?: T; // For paginated responses
}

// Search response wrapper
export interface SearchResponse<T> {
  results: T[];
  count?: number;
  next?: string;
  previous?: string;
}

// API Error Response
export interface ApiErrorResponse {
  error: string;
  detail?: string;
  field_errors?: Record<string, string[]>;
}
