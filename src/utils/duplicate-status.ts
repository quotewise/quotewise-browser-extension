import type { DuplicateCheckResult } from '../types/api';

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
}

export interface DuplicateSightingInput {
  existing_sightings_for_url?: Array<unknown>;
  matches?: DuplicateSightingMatch[];
}

export function classifyDuplicateSighting(result?: DuplicateSightingInput | null): DuplicateSightingState {
  if (!result) return 'unknown';

  if ((result.existing_sightings_for_url || []).length > 0) {
    return 'exact_sighting';
  }

  const matches = result.matches || [];
  if (matches.some(match => (
    match.sighting_status === 'exact_url' ||
    match.existing_sighting_for_this_url === true ||
    match.match_source === 'url'
  ))) {
    return 'exact_sighting';
  }

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
      return matches.find(match => match.sighting_status === 'exact_url') || matches[0];
    case 'same_platform_sighting':
      return matches.find(match => match.sighting_status === 'has_platform_sighting') || matches[0];
    case 'other_platform_sighting':
      return matches.find(match => match.sighting_status === 'no_platform_sighting') || matches[0];
    case 'unknown':
    default:
      return matches[0];
  }
}

export function classifyMatchResolution(result?: DuplicateCheckResult | null): MatchResolution {
  if (!result) return 'none';

  if (result.search_metadata?.error === true) {
    return 'couldnt_verify';
  }

  const match = Array.isArray(result.matches) ? result.matches[0] : undefined;
  const hasExactUrlSighting = (result.existing_sightings_for_url || []).length > 0;

  if (
    hasExactUrlSighting ||
    match?.existing_sighting_for_this_url === true ||
    match?.match_source === 'url' ||
    match?.match_class === 'exact' ||
    match?.sighting_status === 'exact_url'
  ) {
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

  if ((result.matches || []).some(match => match.in_user_collections === true)) {
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
