import type { DuplicateCheckResult } from '../../src/types/api';

export function duplicateMatch(
  overrides: Partial<DuplicateCheckResult['matches'][number]> = {},
): DuplicateCheckResult['matches'][number] {
  return {
    quote_id: '101',
    version_id: 1,
    text: 'Existing quote text',
    similarity: 0.92,
    match_type: 'similar',
    in_user_collections: false,
    originator: {
      id: 'originator-1',
      full_name: 'Existing Author',
      sort_name: null,
      birth_year: null,
      death_year: null,
    },
    workflow_status: 'published',
    likes_count: 0,
    short_code: 'existing-quote',
    url: 'https://quotewise.io/quotes/existing-quote',
    ...overrides,
  };
}

export function duplicateResult(
  overrides: Partial<DuplicateCheckResult> = {},
): DuplicateCheckResult {
  return {
    recommendation: 'new_quote',
    confidence: 0.9,
    in_quotewise: false,
    matches: [],
    reasoning: 'test fixture',
    search_metadata: {},
    ...overrides,
  };
}

export function similarDuplicateResult(
  overrides: Partial<DuplicateCheckResult> = {},
): DuplicateCheckResult {
  return duplicateResult({
    recommendation: 'new_version',
    in_quotewise: true,
    matches: [duplicateMatch({
      match_source: 'similarity',
      match_class: 'similar',
    })],
    ...overrides,
  });
}

export function conflictDuplicateResult(
  overrides: Partial<DuplicateCheckResult> = {},
): DuplicateCheckResult {
  return duplicateResult({
    recommendation: 'attribution_conflict',
    in_quotewise: true,
    matches: [duplicateMatch({
      match_source: 'similarity',
      match_class: 'conflict',
      originator: {
        id: 'originator-2',
        full_name: 'Different Author',
        sort_name: null,
        birth_year: null,
        death_year: null,
      },
    })],
    ...overrides,
  });
}

export function exactDuplicateResult(
  overrides: Partial<DuplicateCheckResult> = {},
): DuplicateCheckResult {
  return duplicateResult({
    recommendation: 'duplicate',
    in_quotewise: true,
    matches: [duplicateMatch({
      match_source: 'url',
      match_class: 'exact',
      existing_sighting_for_this_url: true,
      sighting_status: 'exact_url',
    })],
    ...overrides,
  });
}

export function couldntVerifyDuplicateResult(
  overrides: Partial<DuplicateCheckResult> = {},
): DuplicateCheckResult {
  return duplicateResult({
    recommendation: 'new_quote',
    confidence: 0,
    in_quotewise: false,
    matches: [],
    reasoning: "Couldn't verify duplicates",
    search_metadata: { error: true },
    ...overrides,
  });
}

export function legacyNearMatchDuplicateResult(
  overrides: Partial<DuplicateCheckResult> = {},
): DuplicateCheckResult {
  return duplicateResult({
    recommendation: 'new_version',
    in_quotewise: true,
    matches: [duplicateMatch({
      match_source: undefined,
      match_class: undefined,
    })],
    ...overrides,
  });
}
