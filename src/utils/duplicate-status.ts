import type { DuplicateCheckResult } from '../types/api';
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

  const matches = Array.isArray(result.matches) ? result.matches : [];

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
  const matches = result.matches || [];

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

  // Scoped to same-originator matches: the mixed ADR-0009 list can carry another
  // originator's quote that the user happens to have collected, which says
  // nothing about the quote being captured here.
  if ((result.matches || []).some(match => (
    match.match_class !== 'conflict' &&
    match.different_originator !== true &&
    (
      match.in_user_collections === true ||
      (Array.isArray(match.member_collections) && match.member_collections.length > 0)
    )
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
