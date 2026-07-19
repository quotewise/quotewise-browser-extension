import type { DuplicateCheckResult, QuoteMatch } from '../types/api';
import { normalizeQuoteText } from './quote-text';

type SightingStatus = 'exact_url' | 'has_platform_sighting' | 'no_platform_sighting' | 'unknown';

export type QuoteStatus = 'None' | 'InCollection' | 'Conflict' | 'Exact' | 'Similar' | 'New';

export type MatchResolution = 'exact' | 'conflict' | 'similar' | 'couldnt_verify' | 'none';

export type DuplicateSightingState =
  | 'exact_sighting'
  | 'same_platform_sighting'
  | 'other_platform_sighting'
  | 'unknown';

export interface DuplicateSightingMatch {
  sighting_status?: SightingStatus;
  existing_sighting_for_this_url?: boolean;
  match_source?: 'url' | 'similarity';
  primary?: boolean;
  match_class?: 'exact' | 'conflict' | 'similar';
  different_originator?: boolean;
}

function isCrossOriginator(match: DuplicateSightingMatch): boolean {
  return match?.different_originator === true || match?.match_class === 'conflict';
}

/**
 * Since ADR-0009 every check returns cross-originator matches alongside
 * same-originator ones. Anything that reasons about *this* capture — is it
 * already recorded, already collected, already sighted on this platform — must
 * look only at matches under the originator being captured. Another
 * originator's quote answers a different question.
 */
function sameOriginatorMatches<T extends DuplicateSightingMatch>(matches?: T[]): T[] {
  if (!Array.isArray(matches)) return [];
  return matches.filter(match => !!match && !isCrossOriginator(match));
}

/**
 * The match that drives headline state.
 *
 * Since ADR-0009 `matches` is one distance-sorted list mixing same-originator
 * and cross-originator hits, so `matches[0]` is no longer a safe proxy — the
 * server flags the match it selected. The `?? [0]` fallback keeps pre-ADR-0009
 * server responses (and the synthesized matches in the service worker) working,
 * since those servers already sorted the intended match first.
 *
 * Do not reintroduce a positional or threshold-based rule on top of this.
 */
export function primaryMatch<T extends { primary?: boolean }>(matches?: T[]): T | undefined {
  if (!Array.isArray(matches)) return undefined;
  return matches.find(match => match?.primary === true) ?? matches[0];
}

export interface DuplicateSightingInput {
  existing_sightings_for_url?: unknown;
  matches?: DuplicateSightingMatch[];
}

export interface MatchedUrlSighting {
  text: string;
  short_code?: string | null;
  web_url?: string | null;
  [key: string]: unknown;
}

export function matchedSightingForText(
  result?: { existing_sightings_for_url?: unknown } | null,
  currentText?: string,
): MatchedUrlSighting | undefined {
  const normalizedText = typeof currentText === 'string' ? normalizeQuoteText(currentText) : '';
  if (!normalizedText || !Array.isArray(result?.existing_sightings_for_url)) return undefined;

  return result.existing_sightings_for_url.find((entry): entry is MatchedUrlSighting => (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { text?: unknown }).text === 'string' &&
    normalizeQuoteText((entry as { text: string }).text) === normalizedText
  ));
}

export function passageCountForUrl(result?: DuplicateCheckResult | null): number | 'unknown' {
  if (!result || typeof result !== 'object' || result.search_metadata?.error === true) {
    return 'unknown';
  }

  if (Object.prototype.hasOwnProperty.call(result, 'existing_sightings_total')) {
    return Number.isInteger(result.existing_sightings_total) && result.existing_sightings_total! >= 0
      ? result.existing_sightings_total!
      : 'unknown';
  }

  if (Object.prototype.hasOwnProperty.call(result, 'existing_sightings_for_url')) {
    return Array.isArray(result.existing_sightings_for_url) && result.existing_sightings_for_url.length < 50
      ? result.existing_sightings_for_url.length
      : 'unknown';
  }

  return 0;
}

export function classifyDuplicateSighting(
  result?: DuplicateSightingInput | null,
  currentText?: string,
): DuplicateSightingState {
  if (!result) return 'unknown';

  if (matchedSightingForText(result, currentText)) {
    return 'exact_sighting';
  }

  const matches = sameOriginatorMatches(result.matches);

  if (matches.some(match => match.sighting_status === 'has_platform_sighting')) {
    return 'same_platform_sighting';
  }

  if (matches.some(match => match.sighting_status === 'no_platform_sighting')) {
    return 'other_platform_sighting';
  }

  return 'unknown';
}

export function getMatchForDuplicateSightingState<T extends DuplicateSightingMatch>(
  result: { matches?: T[] },
  state: DuplicateSightingState
): T | undefined {
  const matches = sameOriginatorMatches(result.matches);

  switch (state) {
    case 'exact_sighting':
      return matches.find(match => match.sighting_status === 'exact_url') || primaryMatch(matches);
    case 'same_platform_sighting':
      return matches.find(match => match.sighting_status === 'has_platform_sighting') || primaryMatch(matches);
    case 'other_platform_sighting':
      return matches.find(match => match.sighting_status === 'no_platform_sighting') || primaryMatch(matches);
    case 'unknown':
    default:
      return primaryMatch(matches);
  }
}

/**
 * The one `match_type` the client keys on. Per ADR-0009 the backend claims it
 * only on proven byte equality with the candidate text — never inferred from
 * vector distance, not even distance 0.0 — so treating it as grounds to block
 * submission keeps the client free of similarity math.
 */
export const EXACT_CONFLICT_MATCH_TYPE = 'exact_different_originator';

/**
 * A match asserting this exact text is already on record under a *different*
 * originator. Submitting over it would fork an attribution, so the capture is
 * blocked until a human resolves it in Quotewise.
 *
 * Scans every match, not just the primary: the server ranks same-originator
 * matches first, so an exact cross-originator hit can sit behind a weaker
 * same-originator one.
 */
export function blockingExactConflict(
  result?: DuplicateCheckResult | null,
): QuoteMatch | undefined {
  if (!result || result.search_metadata?.error === true) return undefined;
  if (!Array.isArray(result.matches)) return undefined;

  return result.matches.find(match => match?.match_type === EXACT_CONFLICT_MATCH_TYPE);
}

/**
 * Cross-originator matches other than the primary — what the similar-quotes
 * panel lists. The primary is excluded because the duplicate badge already
 * renders it as the headline state; including it would say the same thing twice.
 */
export function secondaryConflicts(result?: DuplicateCheckResult | null): QuoteMatch[] {
  if (!result || result.search_metadata?.error === true) return [];
  if (!Array.isArray(result.matches)) return [];

  const primary = primaryMatch(result.matches);
  return result.matches.filter(match => (
    !!match && match !== primary && isCrossOriginator(match)
  ));
}

export function classifyMatchResolution(
  result?: DuplicateCheckResult | null,
  currentText?: string,
): MatchResolution {
  if (!result) return 'none';

  if (result.search_metadata?.error === true) {
    return 'couldnt_verify';
  }

  const match = primaryMatch(result.matches);

  if (matchedSightingForText(result, currentText)) {
    return 'exact';
  }

  if (match?.match_class === 'conflict') {
    return 'conflict';
  }

  if (match?.match_class === 'similar') {
    return 'similar';
  }

  if (
    match?.match_class == null &&
    (result.recommendation === 'new_version' || result.recommendation === 'new_version_known_author')
  ) {
    return 'similar';
  }

  return 'none';
}

export function mapRecommendationToQuoteStatus(result: DuplicateCheckResult | null): QuoteStatus {
  if (!result || result.search_metadata?.error) {
    return 'None';
  }

  if (sameOriginatorMatches(result.matches).some(match => (
    match.in_user_collections === true ||
    (Array.isArray(match.member_collections) && match.member_collections.length > 0)
  ))) {
    return 'InCollection';
  }

  switch (result.recommendation) {
    case 'attribution_conflict':
    case 'attribution_conflict_resolved':
      return 'Conflict';
    case 'duplicate':
    case 'duplicate_known_author':
      return 'Exact';
    case 'new_version':
    case 'new_version_known_author':
      return 'Similar';
    case 'new_quote':
    case 'new_quote_known_author':
      return 'New';
    default:
      return 'New';
  }
}
