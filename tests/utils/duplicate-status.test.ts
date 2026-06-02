import {
  classifyDuplicateSighting,
  getMatchForDuplicateSightingState,
} from '../../src/utils/duplicate-status';

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
