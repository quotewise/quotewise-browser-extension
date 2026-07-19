import {
  blockingExactConflict,
  classifyMatchResolution,
  classifyDuplicateSighting,
  secondaryConflicts,
  getMatchForDuplicateSightingState,
  mapRecommendationToQuoteStatus,
  matchedSightingForText,
  passageCountForUrl,
  primaryMatch,
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

const OTHER_ORIGINATOR = {
  id: 'originator-2',
  full_name: 'Different Author',
  sort_name: null,
  birth_year: null,
  death_year: null,
};

function crossOriginatorMatch(
  overrides: Partial<DuplicateCheckResult['matches'][number]> = {},
): DuplicateCheckResult['matches'][number] {
  return duplicateMatch({
    quote_id: 'cross',
    match_class: 'conflict',
    match_type: 'near_different_originator',
    different_originator: true,
    originator: OTHER_ORIGINATOR,
    ...overrides,
  });
}

describe('primary match selection', () => {
  it('selects the server-flagged primary regardless of position', () => {
    const primary = duplicateMatch({ quote_id: 'same', primary: true });

    expect(primaryMatch([crossOriginatorMatch(), primary])?.quote_id).toBe('same');
  });

  it('falls back to index 0 when no match is flagged (older servers)', () => {
    expect(primaryMatch([crossOriginatorMatch(), duplicateMatch({ quote_id: 'same' })])?.quote_id)
      .toBe('cross');
  });

  it('is total for absent and malformed lists', () => {
    expect(primaryMatch(undefined)).toBeUndefined();
    expect(primaryMatch([])).toBeUndefined();
    expect(() => primaryMatch('not-an-array' as never)).not.toThrow();
    expect(primaryMatch('not-an-array' as never)).toBeUndefined();
  });

  it('classifies a mixed list by the primary rather than by position', () => {
    // The cross-originator hit sorts closer in embedding space, but the server
    // flagged the same-originator match as primary. Position must not win.
    const result = duplicateResult({
      recommendation: 'new_version',
      in_quotewise: true,
      matches: [
        crossOriginatorMatch(),
        duplicateMatch({ quote_id: 'same', match_class: 'similar', primary: true }),
      ],
    });

    expect(classifyMatchResolution(result)).toBe('similar');
  });

  it('falls back to the primary rather than index 0 for sighting-state selection', () => {
    const match = getMatchForDuplicateSightingState({
      matches: [
        crossOriginatorMatch({ sighting_status: 'unknown' }),
        duplicateMatch({ quote_id: 'same', primary: true, sighting_status: 'unknown' }),
      ],
    }, 'same_platform_sighting');

    expect(match?.quote_id).toBe('same');
  });
});

describe('cross-originator selectors', () => {
  it('blocks on an exact cross-originator match wherever it sits in the list', () => {
    const exact = crossOriginatorMatch({ match_type: 'exact_different_originator' });

    expect(blockingExactConflict(duplicateResult({ matches: [exact] }))?.quote_id).toBe('cross');
    // Behind a same-originator primary — the case classifyMatchResolution misses.
    expect(blockingExactConflict(duplicateResult({
      matches: [duplicateMatch({ quote_id: 'same', primary: true }), exact],
    }))?.quote_id).toBe('cross');
  });

  it('does not block on merely-similar cross-originator matches', () => {
    expect(blockingExactConflict(duplicateResult({
      matches: [crossOriginatorMatch()],
    }))).toBeUndefined();
  });

  it('never blocks on an errored or absent check', () => {
    expect(blockingExactConflict(null)).toBeUndefined();
    expect(blockingExactConflict(undefined)).toBeUndefined();
    expect(blockingExactConflict(couldntVerifyDuplicateResult({
      matches: [crossOriginatorMatch({ match_type: 'exact_different_originator' })],
    }))).toBeUndefined();
    expect(() => blockingExactConflict({ matches: 'nope' } as never)).not.toThrow();
  });

  it('excludes the primary and same-originator matches from the secondary list', () => {
    const result = duplicateResult({
      matches: [
        duplicateMatch({ quote_id: 'same', primary: true }),
        duplicateMatch({ quote_id: 'same-2' }),
        crossOriginatorMatch({ quote_id: 'cross-1' }),
        crossOriginatorMatch({ quote_id: 'cross-2', match_class: undefined }),
      ],
    });

    expect(secondaryConflicts(result).map(match => match.quote_id))
      .toEqual(['cross-1', 'cross-2']);
  });

  it('drops a lone cross-originator match, since it is the primary', () => {
    expect(secondaryConflicts(duplicateResult({
      matches: [crossOriginatorMatch()],
    }))).toEqual([]);
    expect(secondaryConflicts(couldntVerifyDuplicateResult())).toEqual([]);
    expect(secondaryConflicts(null)).toEqual([]);
  });
});

describe('duplicate sighting status', () => {
  it('classifies only the normalized matching URL passage as exact sighting', () => {
    expect(classifyDuplicateSighting({
      existing_sightings_for_url: [{ text: '  Same\npassage ' }],
      matches: [],
    }, 'Same passage')).toBe('exact_sighting');

    expect(classifyDuplicateSighting({
      existing_sightings_for_url: [{ text: 'Existing passage' }],
      matches: [],
    }, 'Different passage')).not.toBe('exact_sighting');
  });

  it('does not block from URL-only signals without matching text', () => {
    expect(classifyDuplicateSighting({
      matches: [{ sighting_status: 'exact_url' }],
    }, 'Different passage')).not.toBe('exact_sighting');
    expect(classifyDuplicateSighting({
      matches: [{ match_source: 'url' }],
    }, 'Different passage')).not.toBe('exact_sighting');
    expect(classifyDuplicateSighting({
      matches: [{ existing_sighting_for_this_url: true }],
    }, 'Different passage')).not.toBe('exact_sighting');
  });

  it('ignores sighting status carried by cross-originator matches', () => {
    // Another originator's quote having a sighting on this platform says nothing
    // about whether the quote being captured is already recorded. Before the
    // mixed ADR-0009 list these could not appear together.
    expect(classifyDuplicateSighting({
      matches: [
        { sighting_status: 'unknown' },
        { sighting_status: 'has_platform_sighting', different_originator: true },
      ],
    })).toBe('unknown');

    expect(classifyDuplicateSighting({
      matches: [
        { sighting_status: 'unknown' },
        { sighting_status: 'exact_url', match_class: 'conflict' },
      ],
    }, 'Some passage')).toBe('unknown');

    // Same-originator matches in the same mixed list still classify.
    expect(classifyDuplicateSighting({
      matches: [
        { sighting_status: 'has_platform_sighting', different_originator: true },
        { sighting_status: 'has_platform_sighting' },
      ],
    })).toBe('same_platform_sighting');
  });

  it('does not select a cross-originator match for a sighting state', () => {
    const match = getMatchForDuplicateSightingState({
      matches: [
        { id: 'cross', sighting_status: 'no_platform_sighting' as const, different_originator: true },
        { id: 'same', sighting_status: 'no_platform_sighting' as const },
      ],
    }, 'other_platform_sighting');

    expect(match?.id).toBe('same');
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

  it('prioritizes a matching passage over same-platform and other-platform matches', () => {
    expect(classifyDuplicateSighting({
      existing_sightings_for_url: [{ text: 'Exact passage' }],
      matches: [
        { sighting_status: 'no_platform_sighting' },
        { sighting_status: 'has_platform_sighting' },
        { sighting_status: 'exact_url' },
      ],
    }, 'Exact passage')).toBe('exact_sighting');
  });

  it('keeps omitted and empty current text non-blocking', () => {
    const result = { existing_sightings_for_url: [{ text: 'Existing passage' }] };

    expect(classifyDuplicateSighting(result)).not.toBe('exact_sighting');
    expect(classifyDuplicateSighting(result, '   ')).not.toBe('exact_sighting');
  });

  it('resolves the matching passage rather than the first URL entry', () => {
    const result = duplicate('duplicate', {
      existing_sightings_for_url: [
        {
          id: 1,
          quote_id: 'first',
          source_url: 'https://x.com/test/status/1',
          text: 'First passage',
          web_url: 'https://quotewise.io/q/first/',
        },
        {
          id: 2,
          quote_id: 'matched',
          source_url: 'https://x.com/test/status/1',
          text: '  Matched\n passage ',
          web_url: 'https://quotewise.io/q/matched/',
        },
      ],
    });

    expect(matchedSightingForText(result, 'Matched passage')?.web_url)
      .toBe('https://quotewise.io/q/matched/');
  });

  it('ignores malformed passage lists and non-string text', () => {
    const malformedList = duplicate('duplicate', {
      existing_sightings_for_url: 'not-an-array' as never,
    });
    const malformedEntry = duplicate('duplicate', {
      existing_sightings_for_url: [{ text: 42 }] as never,
    });

    expect(() => matchedSightingForText(malformedList, '42')).not.toThrow();
    expect(() => matchedSightingForText(malformedEntry, '42')).not.toThrow();
    expect(matchedSightingForText(malformedList, '42')).toBeUndefined();
    expect(matchedSightingForText(malformedEntry, '42')).toBeUndefined();
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
        member_collections: [],
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
        member_collections: [],
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

    expect(mapRecommendationToQuoteStatus(duplicate('duplicate', {
      matches: [{
        quote_id: 'q1',
        version_id: 1,
        text: 'Quote',
        similarity: 100,
        match_type: 'exact_same_originator',
        in_user_collections: false,
        member_collections: [{ slug: 'favorites', name: 'Favorites' }],
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

  it('ignores collection membership on cross-originator matches', () => {
    // The vector sweep now returns same- and cross-originator matches in one
    // list. Another originator's quote sitting in the user's collection must not
    // report the quote being captured as already collected.
    expect(mapRecommendationToQuoteStatus(duplicate('new_quote', {
      matches: [crossOriginatorMatch({ in_user_collections: true })],
    }))).not.toBe('InCollection');

    expect(mapRecommendationToQuoteStatus(duplicate('new_quote', {
      matches: [crossOriginatorMatch({
        member_collections: [{ slug: 'favorites', name: 'Favorites' }],
      })],
    }))).not.toBe('InCollection');

    // A same-originator match in the same mixed list still counts.
    expect(mapRecommendationToQuoteStatus(duplicate('duplicate', {
      matches: [
        crossOriginatorMatch(),
        duplicateMatch({ primary: true, in_user_collections: true }),
      ],
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
      existing_sightings_for_url: [{
        id: 1,
        quote_id: '101',
        source_url: 'https://x.com/test/status/1',
        text: 'Exact passage',
      }],
      matches: [duplicateMatch({
        match_source: 'url',
        match_class: 'conflict',
        existing_sighting_for_this_url: true,
      })],
    }), 'Exact passage')).toBe('exact');

    expect(classifyMatchResolution(conflictDuplicateResult())).toBe('conflict');
    expect(classifyMatchResolution(similarDuplicateResult())).toBe('similar');
    expect(classifyMatchResolution(duplicateResult())).toBe('none');
  });

  it('does not treat URL-only signals as exact without a matching passage', () => {
    expect(classifyMatchResolution(duplicateResult({
      matches: [duplicateMatch({ match_source: 'url' })],
    }), 'Different passage')).toBe('none');
    expect(classifyMatchResolution(duplicateResult({
      matches: [duplicateMatch({ match_class: 'exact' })],
    }), 'Different passage')).toBe('none');
    expect(classifyMatchResolution(duplicateResult({
      matches: [duplicateMatch({ sighting_status: 'exact_url' })],
    }), 'Different passage')).toBe('none');
    expect(classifyMatchResolution(duplicateResult({
      matches: [duplicateMatch({ existing_sighting_for_this_url: true })],
    }), 'Different passage')).toBe('none');
  });

  it('requires current text before returning exact', () => {
    const result = duplicateResult({
      existing_sightings_for_url: [{
        id: 1,
        quote_id: '101',
        source_url: 'https://x.com/test/status/1',
        text: 'Exact passage',
      }],
    });

    expect(classifyMatchResolution(result, ' Exact\npassage ')).toBe('exact');
    expect(classifyMatchResolution(result)).not.toBe('exact');
    expect(classifyMatchResolution(result, '   ')).not.toBe('exact');
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

describe('passage count for URL', () => {
  const entries = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: index,
    quote_id: String(index),
    source_url: 'https://x.com/test/status/1',
  }));

  it('implements the canonical count truth table', () => {
    // null = no information. Distinct from 'unknown', which means captures exist
    // but cannot be counted — only the latter licenses a "has captures" claim.
    expect(passageCountForUrl(null)).toBeNull();
    expect(passageCountForUrl(undefined)).toBeNull();
    expect(passageCountForUrl(duplicate('new_quote', {
      search_metadata: { error: true },
    }))).toBeNull();
    expect(passageCountForUrl(duplicate('duplicate', {
      existing_sightings_total: 12,
      existing_sightings_for_url: 'malformed' as never,
    }))).toBe(12);

    for (const malformedTotal of [-1, 1.5, Number.NaN, '2']) {
      expect(passageCountForUrl(duplicate('duplicate', {
        existing_sightings_total: malformedTotal as never,
      }))).toBe('unknown');
    }

    expect(passageCountForUrl(duplicate('duplicate', {
      existing_sightings_for_url: entries(0),
    }))).toBe(0);
    expect(passageCountForUrl(duplicate('duplicate', {
      existing_sightings_for_url: entries(49),
    }))).toBe(49);
    expect(passageCountForUrl(duplicate('duplicate', {
      existing_sightings_for_url: entries(50),
    }))).toBe('unknown');
    expect(passageCountForUrl(duplicate('duplicate', {
      existing_sightings_for_url: {} as never,
    }))).toBe('unknown');
    expect(passageCountForUrl(duplicate('new_quote'))).toBe(0);
  });
});
