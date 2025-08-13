/**
 * API type definitions and interfaces for Quotewise Chrome extension
 * Matches the Django backend API contract and popup expectations
 */

// Core API response interfaces matching popup expectations
export interface AuthStatusResult {
  isAuthenticated: boolean;
  userInfo?: {
    username: string;
    isAdmin: boolean;
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

export interface DuplicateCheckResult {
  recommendation: 'duplicate' | 'new_version' | 'new_quote';
  confidence: number;
  matches: Array<{
    quote_id: string;
    version_id: number;
    text: string;
    similarity: number;
    match_type: string;
    originator: Originator;
    workflow_status: string;
    likes_count: number;
  }>;
  existing_sightings_for_url?: Array<any>;
  reasoning: string;
  search_metadata?: any;
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
  quote_text: string;
  originator_id?: number;
  originator_search?: string;
  sighting_url: string;
  platform_code: PlatformCode;
  likes_count: number;
  post_date?: string;
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
  is_protected?: boolean;
  thread_position?: number;
  [key: string]: any;
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
  sessionCookieName: string;
  secure: boolean;
}

// API client interface
export interface QuotewiseApiClient {
  baseUrl: string;
  searchOriginators(query: string, limit?: number): Promise<OriginatorSearchResult[]>;
  checkQuoteDuplicate(text: string, originatorId?: string, sourceUrl?: string): Promise<DuplicateCheckResult>;
  submitQuote(quoteData: QuoteSubmissionRequest): Promise<QuoteSubmissionResult>;
  checkAuthStatus(): Promise<AuthStatusResult>;
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
export interface ApiResponse<T = any> {
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