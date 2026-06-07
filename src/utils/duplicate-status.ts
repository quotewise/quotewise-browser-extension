import type { DuplicateCheckResult } from '../types/api';

type SightingStatus = 'exact_url' | 'has_platform_sighting' | 'no_platform_sighting' | 'unknown';

export type QuoteStatus = 'None' | 'InCollection' | 'Conflict' | 'Exact' | 'Similar' | 'New';

export type DuplicateSightingState =
  | 'exact_sighting'
  | 'same_platform_sighting'
  | 'other_platform_sighting'
  | 'unknown';

export interface DuplicateSightingMatch {
  sighting_status?: SightingStatus;
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
  if (matches.some(match => match.sighting_status === 'exact_url')) {
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
