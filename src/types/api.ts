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
  id?: number;                   // Numeric ID — OPTIONAL: /v1/originators/by-handle/ omits it, and
                                 // capture references originators by unique_id/slug, not this id.
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
  client_rtt_ms?: number;
}

/**
 * One entry of the duplicate-check `matches` list. Since ADR-0009 the backend
 * runs a pgvector sweep, so this list is a single distance-sorted mix of
 * same-originator and cross-originator hits — never assume it is homogeneous,
 * and never select from it by position (see `primaryMatch`).
 */
export interface QuoteMatch {
  quote_id: string;
  version_id?: number;   // Declared required historically; the server has never emitted it.
  text: string;
  similarity: number;    // 0-100, higher is better — including for semantic matches.
  /**
   * Free-form provenance label. `exact_different_originator` is the one value
   * the client keys on: it is claimed only on proven byte equality, so it can
   * hard-block submission without the client doing any similarity math.
   * Deliberately not a union — legacy values (`exact`, `near`, `fuzzy`,
   * `similar`, `exact_same_originator`) are still in circulation.
   */
  match_type: string;
  in_user_collections: boolean;
  member_collections: MemberCollection[];
  originator: Originator;
  workflow_status: string;
  likes_count: number;
  // Sighting status for platform awareness
  short_code?: string;
  url?: string;
  quote_date?: string;
  match_source?: 'url' | 'similarity';
  match_class?: 'exact' | 'conflict' | 'similar';
  existing_sighting_for_this_url?: boolean;
  sighting_status?: 'exact_url' | 'has_platform_sighting' | 'no_platform_sighting' | 'unknown';
  platform_sighting_url?: string | null;
  // ADR-0009 additions — optional so older server responses still typecheck.
  primary?: boolean;
  different_originator?: boolean;
  match_engine?: 'lexical' | 'semantic' | 'url';
  /**
   * Relation labels (ADR-0009). **Display hints only — never proof.**
   *
   * The unfiltered vector sweep routinely returns several members of one variant
   * group at once, and without these they read as independent duplicates. Group
   * by `canonical_quote_id || quote_id` and show one row per group.
   *
   * What each is worth, measured against production 2026-07-19:
   * - `canonical_quote_id` present — reliable (a real FK). Absence proves nothing.
   * - `has_relations: true` — reliable. `false` is NOT proof of "no relations";
   *   948 quotes have edges while reporting false.
   * - `quote_role` — a curator-set label that drifts from the relation graph;
   *   1,780 rows say "variant" with no backing edge.
   *
   * Never gate a write on these. Authoritative pairwise edges land in `qw-gqae3`;
   * until then, gate link decisions on the server's response to the link itself.
   */
  quote_role?: string;
  has_relations?: boolean;
  canonical_quote_id?: string | null;
  /**
   * Authoritative edges, read from the relation graph rather than denormalized,
   * so unlike the hints above they do not drift. Always present (`[]` when none).
   *
   * Scope is edges **between the matches in this response** — enough to answer
   * "are these two results already linked?", which is what grouping needs. Edges
   * to quotes outside the result set are not reported, so an empty array means
   * "not linked to anything else here", never "unlinked".
   *
   * This is the only relation signal allowed to gate a link action.
   */
  relations?: QuoteRelation[];
}

export interface QuoteRelation {
  other_quote_id: string;
  relation_type: string;   // variant | translation | disputed | nested | …
  direction: 'outgoing' | 'incoming';
}

export interface DuplicateCheckResult {
  // `inconclusive_unscoped`: the check ran without an originator, so the server skipped the
  // trigram pass and is telling us it did not actually look. Never treat it as "not found" —
  // see ADR-0009, "Do not treat an empty result here as proof the quote is new".
  recommendation: 'duplicate' | 'new_version' | 'new_quote' | 'attribution_conflict' |
                  'new_quote_known_author' | 'duplicate_known_author' | 'new_version_known_author' |
                  'attribution_conflict_resolved' | 'inconclusive_unscoped';
  confidence: number;
  in_quotewise: boolean;
  social_originator?: {
    id: number;
    full_name: string;
    handle: string;
    platform: string;
    platform_name: string;
    match_confidence: number;
  };
  suggested_originator_id?: number;
  matches: QuoteMatch[];
  existing_sightings_for_url?: Array<{
    id: number;
    quote_id: string;
    source_url: string;
    text?: string;
    short_code?: string | null;
    web_url?: string | null;
  }>;
  existing_sightings_total?: number;
  reasoning: string;
  search_metadata: {
    originator_scoped?: boolean;
    social_handle_checked?: boolean;
    social_handle_matched?: boolean;
    source_url_checked?: boolean;
    total_matches?: number;
    query_time_ms?: number;
    client_rtt_ms?: number;
    error?: boolean;
    // ADR-0009 — informational. `vector_search_skipped_uncached` marks a
    // preflight that ran without an embedding, so its absence of matches is not
    // authoritative; the live check refines it.
    vector_search_used?: boolean;
    vector_search_skipped_uncached?: boolean;
    cross_originator_match_found?: boolean;
    /**
     * Set when the check ran without an `originator_slug`. That path skips the
     * lexical trigram pass, the only engine that catches punctuation-only
     * variants, so an empty result here is advisory — never proof the quote is
     * new. Re-check once an originator is chosen.
     */
    lexical_search_skipped_unscoped?: boolean;
  };
}

export interface QuoteSubmissionResult {
  success: boolean;
  message: string;
  quoteId?: string;
  error?: string;
  collectionWarning?: string;
  action?: 'created' | 'sighting_added';
  /**
   * Other originators already on record with this text (ADR-0009 §5).
   * Strictly advisory — the quote was created regardless, and this never
   * indicates failure. Empty when the text had no cached embedding, since
   * surfacing it must not add a Bedrock call to a write.
   */
  attributionConflicts?: QuoteMatch[];
}

export interface MemberCollection {
  slug: string;
  name: string;
}

export interface AddToCollectionRequest {
  quote_id: string;
}

export interface AddToCollectionResult {
  success: boolean;
  alreadyMember?: boolean;
  error?: string;
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
  originator_slug?: string;  // Public originator identifier (slug). Preferred reference for writes.
  originator_search?: string;
  source_url: string;
  platform_code: PlatformCode;
  likes_count?: number;
  quote_date?: string;
  attribution_type: AttributionType;
  context?: string;
  image_urls?: string[];
  platform_data?: PlatformData;
  link_to_quote_id?: number;
  user_intent?: 'sighting' | 'variant';
}

export interface QuoteSubmissionResponse {
  action: 'created' | 'sighting_added' | 'version_added';
  message: string;
  quote: {
    short_code?: string;
    web_url?: string | null;
  };
  version_id?: string | number | null;
  sighting_id?: number | null;
  similarity_score?: number;
  language_detection?: Record<string, unknown>;
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
export type PlatformCode = 'TX' | 'TH' | 'BS' | 'SS' | 'GR' | 'WQ' | 'BQ' | 'QI' | 'UN';

export interface PlatformData {
  source_id?: string | null;
  post_id?: string | null;
  note_id?: string | null;
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

// Environment configuration
export interface EnvironmentConfig {
  apiBaseUrl: string;
  webBaseUrl: string;
  secure: boolean;
}

// Preflight (combined originator lookup + duplicate check) types
export interface PreflightRequest {
  handle: string;
  platform: string;
  text: string;
  source_url: string;
}

export interface PreflightOriginatorResult {
  found: boolean;
  originator?: {
    id: number;
    full_name: string;
    slug?: string;
    unique_id?: string;
    social_handles?: Record<string, string>;
  };
  handle?: string;
  platform?: string;
  match_platform?: string;
  confidence?: number;
  create_url?: string;
}

export interface PreflightResult {
  originator: PreflightOriginatorResult;
  duplicate_check: DuplicateCheckResult;
}

// API client interface
export interface QuotewiseApiClient {
  baseUrl: string;
  searchOriginators(query: string, limit?: number): Promise<OriginatorSearchResult[]>;
  checkQuoteDuplicate(text: string, originatorSlug?: string, sourceUrl?: string, socialHandle?: string): Promise<DuplicateCheckResult>;
  submitQuote(quoteData: QuoteSubmissionRequest): Promise<QuoteSubmissionResult>;
  addQuoteToCollection(collectionSlug: string, quoteId: string): Promise<AddToCollectionResult>;
  checkAuthStatus(): Promise<AuthStatusResult>;
  listCollections(): Promise<CollectionsListResponse>;
  lookupOriginatorByHandle(handle: string, platform?: string): Promise<HandleLookupResult>;
  preflightCheck(handle: string, platform: string, text: string, sourceUrl: string): Promise<PreflightResult>;
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
