/**
 * Type definitions for Quotewise API
 */

// API Request/Response Types
export interface OriginatorSearchResponse {
  results: Originator[];
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
  originator_id?: string;
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
  originator_id?: string;
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

// API Error Response
export interface ApiErrorResponse {
  error: string;
  detail?: string;
  field_errors?: Record<string, string[]>;
}