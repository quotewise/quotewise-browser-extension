import {
  classifyMatchResolution,
  classifyDuplicateSighting,
  getMatchForDuplicateSightingState,
  mapRecommendationToQuoteStatus,
} from '../../src/utils/duplicate-status';
import type { DuplicateCheckResult } from '../../src/types/api';
import {
  conflictDuplicateResult,
  couldntVerifyDuplicateResult,
  duplicateMatch,
  duplicateResult,
  exactDuplicateResult,
  legacyNearMatchDuplicateResult,
  similarDuplicateResult,
} from '../helpers/duplicate-fixtures';

function duplicate(
  recommendation: string,
  overrides: Partial<DuplicateCheckResult> = {},
): DuplicateCheckResult {
  return {
    recommendation: recommendation as DuplicateCheckResult['recommendation'],
    confidence: 1,
    in_quotewise: recommendation !== 'new_quote',
    matches: [],
    reasoning: 'test',
    search_metadata: {},
    ...overrides,
  };
}

describe('duplicate sighting status', () => {
  it('classifies existing URL sightings as exact sighting', () => {
    expect(classifyDuplicateSighting({
      existing_sightings_for_url: [{ id: 1 }],
      matches: [],
    })).toBe('exact_sighting');
  });

  it('classifies exact_url matches as exact sighting', () => {
    expect(classifyDuplicateSighting({
      matches: [{ sighting_status: 'exact_url' }],
    })).toBe('exact_sighting');
  });

  it('classifies has_platform_sighting matches as same-platform sighting', () => {
    expect(classifyDuplicateSighting({
      matches: [{ sighting_status: 'has_platform_sighting' }],
    })).toBe('same_platform_sighting');
  });

  it('classifies no_platform_sighting matches as other-platform sighting', () => {
    expect(classifyDuplicateSighting({
      matches: [{ sighting_status: 'no_platform_sighting' }],
    })).toBe('other_platform_sighting');
  });

  it('prioritizes exact over same-platform and other-platform matches', () => {
    expect(classifyDuplicateSighting({
      matches: [
        { sighting_status: 'no_platform_sighting' },
        { sighting_status: 'has_platform_sighting' },
        { sighting_status: 'exact_url' },
      ],
    })).toBe('exact_sighting');
  });

  it('returns unknown when no explicit sighting status is available', () => {
    expect(classifyDuplicateSighting({
      matches: [{ sighting_status: 'unknown' }],
    })).toBe('unknown');
  });

  it('selects the match that corresponds to the classified state', () => {
    const match = getMatchForDuplicateSightingState({
      matches: [
        { id: 'first', sighting_status: 'unknown' as const },
        { id: 'target', sighting_status: 'no_platform_sighting' as const },
      ],
    }, 'other_platform_sighting');

    expect(match?.id).toBe('target');
  });
});

describe('quote-status recommendation mapping', () => {
  it('maps null and errored checks to no quote status', () => {
    expect(mapRecommendationToQuoteStatus(null)).toBe('None');
    expect(mapRecommendationToQuoteStatus(
      duplicate('duplicate', { search_metadata: { error: true } }),
    )).toBe('None');
  });

  it('maps new recommendations and weak similar matches to New', () => {
    expect(mapRecommendationToQuoteStatus(duplicate('new_quote'))).toBe('New');
    expect(mapRecommendationToQuoteStatus(duplicate('new_quote_known_author'))).toBe('New');
    expect(mapRecommendationToQuoteStatus(duplicate('new_quote', {
      matches: [{
        quote_id: 'q1',
        version_id: 1,
        text: 'Quote',
        similarity: 0.55,
        match_type: 'similar',
        in_user_collections: false,
        originator: {
          id: 'o1',
          full_name: 'Author',
          sort_name: null,
          birth_year: null,
          death_year: null,
        },
        workflow_status: 'published',
        likes_count: 0,
      }],
    }))).toBe('New');
  });

  it('defaults unknown recommendations to New without throwing', () => {
    expect(() => mapRecommendationToQuoteStatus(duplicate('banana'))).not.toThrow();
    expect(mapRecommendationToQuoteStatus(duplicate('banana'))).toBe('New');
  });

  it('maps collection matches before recommendation tiers', () => {
    expect(mapRecommendationToQuoteStatus(duplicate('duplicate', {
      matches: [{
        quote_id: 'q1',
        version_id: 1,
        text: 'Quote',
        similarity: 100,
        match_type: 'exact_same_originator',
        in_user_collections: true,
        originator: {
          id: 'o1',
          full_name: 'Author',
          sort_name: null,
          birth_year: null,
          death_year: null,
        },
        workflow_status: 'published',
        likes_count: 0,
      }],
    }))).toBe('InCollection');
  });

  it('maps exact and similar recommendation tiers', () => {
    expect(mapRecommendationToQuoteStatus(duplicate('duplicate'))).toBe('Exact');
    expect(mapRecommendationToQuoteStatus(duplicate('duplicate_known_author'))).toBe('Exact');
    expect(mapRecommendationToQuoteStatus(duplicate('new_version'))).toBe('Similar');
    expect(mapRecommendationToQuoteStatus(duplicate('new_version_known_author'))).toBe('Similar');
  });

  it('maps attribution conflict recommendations', () => {
    expect(mapRecommendationToQuoteStatus(duplicate('attribution_conflict'))).toBe('Conflict');
    expect(mapRecommendationToQuoteStatus(duplicate('attribution_conflict_resolved'))).toBe('Conflict');
  });
});

describe('match resolution classifier', () => {
  it('uses precedence: couldnt_verify before exact/conflict/similar', () => {
    expect(classifyMatchResolution(couldntVerifyDuplicateResult({
      matches: [duplicateMatch({
        match_source: 'url',
        match_class: 'exact',
        existing_sighting_for_this_url: true,
      })],
    }))).toBe('couldnt_verify');

    expect(classifyMatchResolution(exactDuplicateResult({
      matches: [duplicateMatch({
        match_source: 'url',
        match_class: 'conflict',
        existing_sighting_for_this_url: true,
      })],
    }))).toBe('exact');

    expect(classifyMatchResolution(conflictDuplicateResult())).toBe('conflict');
    expect(classifyMatchResolution(similarDuplicateResult())).toBe('similar');
    expect(classifyMatchResolution(duplicateResult())).toBe('none');
  });

  it('treats URL and exact sighting signals as exact', () => {
    expect(classifyMatchResolution(duplicateResult({
      matches: [duplicateMatch({ match_source: 'url' })],
    }))).toBe('exact');
    expect(classifyMatchResolution(duplicateResult({
      matches: [duplicateMatch({ match_class: 'exact' })],
    }))).toBe('exact');
    expect(classifyMatchResolution(duplicateResult({
      matches: [duplicateMatch({ sighting_status: 'exact_url' })],
    }))).toBe('exact');
    expect(classifyMatchResolution(duplicateResult({
      matches: [duplicateMatch({ existing_sighting_for_this_url: true })],
    }))).toBe('exact');
  });

  it('maps legacy near-match recommendations to similar when match_class is absent', () => {
    expect(classifyMatchResolution(legacyNearMatchDuplicateResult())).toBe('similar');
    expect(classifyMatchResolution(legacyNearMatchDuplicateResult({
      recommendation: 'new_version_known_author',
    }))).toBe('similar');
  });

  it('is total for absent fields and malformed inputs', () => {
    expect(() => classifyMatchResolution(null)).not.toThrow();
    expect(() => classifyMatchResolution(undefined)).not.toThrow();
    expect(() => classifyMatchResolution({
      recommendation: 'banana',
      search_metadata: null,
    } as unknown as DuplicateCheckResult)).not.toThrow();

    expect(classifyMatchResolution(null)).toBe('none');
    expect(classifyMatchResolution(undefined)).toBe('none');
    expect(classifyMatchResolution({
      recommendation: 'banana',
      search_metadata: null,
    } as unknown as DuplicateCheckResult)).toBe('none');
  });
});
