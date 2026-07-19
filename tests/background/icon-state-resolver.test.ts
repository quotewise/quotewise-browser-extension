import { AuthState } from '../../src/auth/auth-state-machine';
import { resolveIconPresentation, type IconPresentation, type TabContext } from '../../src/background/icon-state-resolver';
import type { DuplicateCheckResult } from '../../src/types/api';
import { duplicateMatch } from '../helpers/duplicate-fixtures';

const tweetTab: TabContext = {
  tabId: 1,
  isSupportedPlatform: true,
  isPostPage: true,
  isCheckInFlight: false,
};
const supportedNonTweetTab: TabContext = {
  tabId: 1,
  isSupportedPlatform: true,
  isPostPage: false,
  isCheckInFlight: false,
};
const unsupportedTab: TabContext = {
  tabId: 1,
  isSupportedPlatform: false,
  isPostPage: false,
  isCheckInFlight: false,
};

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

function expectPresentation(value: IconPresentation): void {
  expect(['color', 'grey']).toContain(value.iconVariant);
  expect(typeof value.badgeText).toBe('string');
  expect(typeof value.badgeColor).toBe('string');
  expect(typeof value.title).toBe('string');
  expect(['global', 'tab']).toContain(value.scope);
}

describe('resolveIconPresentation', () => {
  it('renders logged-out, supported idle, unsupported, and auth-pending ambient states', () => {
    expect(resolveIconPresentation(AuthState.UNAUTHENTICATED, null, unsupportedTab)).toMatchObject({
      iconVariant: 'grey',
      badgeText: '',
      scope: 'global',
      title: 'Quotewise — log in to capture quotes',
    });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, null, unsupportedTab)).toMatchObject({
      iconVariant: 'grey',
      badgeText: '',
      scope: 'global',
      title: 'Quotewise — capture works on X, Threads, Bluesky & Substack Notes',
    });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, null, supportedNonTweetTab)).toMatchObject({
      iconVariant: 'color',
      badgeText: '',
      scope: 'global',
      title: 'Quotewise — open a post to capture',
    });

    for (const state of [AuthState.UNKNOWN, AuthState.CHECKING, AuthState.AUTHENTICATING]) {
      expect(resolveIconPresentation(state, duplicate('duplicate'), tweetTab)).toMatchObject({
        iconVariant: 'color',
        badgeText: '',
        scope: 'global',
        title: 'Quotewise',
      });
    }
  });

  it('renders new quote status as a tab-scoped blue star', () => {
    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_quote'), tweetTab)).toMatchObject({
      iconVariant: 'color',
      badgeText: '★',
      badgeColor: '#0072B2',
      scope: 'tab',
      title: 'New quote — not in Quotewise yet',
    });
  });

  describe('attribution outranks everything else on the page', () => {
    const otherOriginator = {
      id: 'o2',
      full_name: 'Different Author',
      sort_name: null,
      birth_year: null,
      death_year: null,
    };

    const exactCrossMatch = () => duplicateMatch({
      quote_id: 'cross',
      match_class: 'conflict' as const,
      match_type: 'exact_different_originator',
      different_originator: true,
      originator: otherOriginator,
    });

    const sameOriginatorPrimary = () => duplicateMatch({
      quote_id: 'mine',
      primary: true,
      match_class: 'exact' as const,
      match_type: 'exact_same_originator',
    });

    it('flags an exact match that is also on record under someone else', () => {
      // The server ranks the same-originator match primary, so `recommendation`
      // says "duplicate" and never mentions the conflict behind it. Badging a
      // contented green "=" while the tray hard-blocks Submit is the bug.
      expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('duplicate', {
        matches: [sameOriginatorPrimary(), exactCrossMatch()],
      }), tweetTab)).toMatchObject({
        badgeText: '=',
        badgeColor: '#E69F00',
        title: 'Already yours — but this exact text is also attributed to someone else',
      });
    });

    it('keeps the plain warning when the conflict IS the match', () => {
      expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('attribution_conflict', {
        matches: [exactCrossMatch()],
      }), tweetTab)).toMatchObject({ badgeText: '⚠', badgeColor: '#D55E00' });
    });

    it('outranks passage counts', () => {
      // "Can this capture proceed" beats "what else lives on this post".
      expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('duplicate', {
        existing_sightings_total: 4,
        matches: [sameOriginatorPrimary(), exactCrossMatch()],
      }), tweetTab)).toMatchObject({ badgeText: '=', badgeColor: '#E69F00' });

      expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('attribution_conflict', {
        existing_sightings_total: 4,
        matches: [exactCrossMatch()],
      }), tweetTab)).toMatchObject({ badgeText: '⚠' });
    });

    it('outranks collection membership', () => {
      expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('duplicate', {
        matches: [
          duplicateMatch({ quote_id: 'mine', primary: true, in_user_collections: true }),
          exactCrossMatch(),
        ],
      }), tweetTab)).toMatchObject({ badgeText: '=', badgeColor: '#E69F00' });
    });

    it('stops calling a quote new when something close is on record elsewhere', () => {
      // Previously badged "★ New quote — not in Quotewise yet", which is not
      // vague but false.
      expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_quote', {
        matches: [
          duplicateMatch({ quote_id: 'mine', primary: true, match_class: 'similar' }),
          duplicateMatch({
            quote_id: 'near',
            match_class: 'conflict',
            match_type: 'near_different_originator',
            different_originator: true,
            originator: otherOriginator,
          }),
        ],
      }), tweetTab)).toMatchObject({
        badgeText: '~',
        badgeColor: '#E69F00',
        title: 'Similar to a quote attributed to someone else',
      });
    });

    it('leaves a genuinely new quote alone', () => {
      expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_quote', {
        matches: [duplicateMatch({ primary: true })],
      }), tweetTab)).toMatchObject({ badgeText: '★' });
    });

    it('trusts the matches over the recommendation when they disagree', () => {
      // Live case: an Asimov quote posted by a handle that is not an originator.
      // With no originator the server cannot recommend a *version* — nobody to
      // version it under — so `recommendation` is new_quote while the match
      // still carries match_class 'similar'. The tray keys on match_class and
      // offered "Add as variant"; the icon keyed on recommendation and badged
      // "@ originator missing". Same response, two answers.
      const asimovNearMatch = duplicate('new_quote', {
        matches: [duplicateMatch({
          quote_id: 'asimov',
          primary: true,
          match_class: 'similar',
          different_originator: false,
          originator: {
            id: 'asimov',
            full_name: 'Isaac Asimov',
            sort_name: null,
            birth_year: null,
            death_year: null,
          },
        })],
        search_metadata: { lexical_search_skipped_unscoped: true },
      });

      expect(resolveIconPresentation(
        AuthState.AUTHENTICATED,
        asimovNearMatch,
        { ...tweetTab, isOriginatorMissing: true },
      )).toMatchObject({
        badgeText: '~',
        badgeColor: '#E69F00',
        title: 'Similar to a quote attributed to someone else',
      });
    });

    it('still reports a missing originator when nothing matched', () => {
      expect(resolveIconPresentation(
        AuthState.AUTHENTICATED,
        duplicate('new_quote', { matches: [] }),
        { ...tweetTab, isOriginatorMissing: true },
      )).toMatchObject({ badgeText: '@' });
    });

    it('does not fire on the no-originator path, where nothing is a conflict', () => {
      // With no originator claimed the server reports different_originator:false
      // and never `conflict`, so neither new state may trigger.
      expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('duplicate', {
        matches: [duplicateMatch({
          primary: true,
          match_class: 'exact',
          match_type: 'exact_same_originator',
          different_originator: false,
        })],
        search_metadata: { lexical_search_skipped_unscoped: true },
      }), tweetTab)).toMatchObject({ badgeText: '=', badgeColor: '#009E73' });
    });
  });

  it('claims nothing about captures when the duplicate check failed', () => {
    // passageCountForUrl cannot count a check that never completed. Reporting
    // "this post has captured passages" on the strength of a failure asserts
    // something we do not know.
    const presentation = resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('new_quote', { search_metadata: { error: true } }),
      tweetTab,
    );

    expect(presentation.badgeText).toBe('');
    expect(presentation.title).not.toContain('captured passages');
  });

  it('still reports captures it cannot count', () => {
    const presentation = resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('new_quote', { existing_sightings_for_url: 'malformed' as never }),
      tweetTab,
    );

    expect(presentation).toMatchObject({
      badgeText: '=',
      title: 'Quotewise — this post has captured passages',
    });
  });

  it('renders in-collection ahead of exact duplicate', () => {
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('duplicate', {
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
      }),
      tweetTab,
    )).toMatchObject({
      badgeText: '✓',
      badgeColor: '#009E73',
      scope: 'tab',
      title: 'Already in your collection',
    });
  });

  it('renders exact and similar with distinct glyphs and colors', () => {
    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('duplicate'), tweetTab)).toMatchObject({
      badgeText: '=',
      badgeColor: '#009E73',
    });
    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_version'), tweetTab)).toMatchObject({
      badgeText: '~',
      badgeColor: '#E69F00',
    });
  });

  it('resolves passage counts without inventing zero for unknown data', () => {
    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('duplicate', {
      existing_sightings_total: 12,
    }), tweetTab)).toMatchObject({
      passageCount: 12,
      badgeText: '9+',
      badgeColor: '#009E73',
      title: 'Quotewise — 12 passages captured from this post',
    });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('duplicate', {
      existing_sightings_total: 1,
    }), tweetTab)).toMatchObject({ badgeText: '=' });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_quote', {
      existing_sightings_total: 0,
    }), tweetTab)).toMatchObject({ badgeText: '★' });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, null, tweetTab)).toMatchObject({
      badgeText: '',
      title: 'Quotewise — ready to capture',
    });

    // Positive evidence of captures whose count is unavailable — safe to badge.
    // An errored check is NOT in this set; it is evidence of nothing.
    for (const result of [
      duplicate('duplicate', { existing_sightings_total: -1 }),
      duplicate('duplicate', { existing_sightings_for_url: {} as never }),
      duplicate('duplicate', {
        existing_sightings_for_url: Array.from({ length: 50 }, (_, index) => ({
          id: index,
          quote_id: String(index),
          source_url: 'https://x.com/test/status/1',
        })),
      }),
    ]) {
      expect(resolveIconPresentation(AuthState.AUTHENTICATED, result, tweetTab)).toMatchObject({
        badgeText: '=',
        title: 'Quotewise — this post has captured passages',
      });
    }
  });

  it('renders missing originator after similar/exact but before new', () => {
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('new_quote'),
      { ...tweetTab, isOriginatorMissing: true },
    )).toMatchObject({
      badgeText: '@',
      badgeColor: '#E69F00',
      scope: 'tab',
      title: 'Originator not in Quotewise — add them first',
    });

    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('duplicate'),
      { ...tweetTab, isOriginatorMissing: true },
    )).toMatchObject({
      badgeText: '=',
      badgeColor: '#009E73',
    });
  });

  it('renders attribution conflicts with the chosen warning glyph', () => {
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('attribution_conflict'),
      tweetTab,
    )).toMatchObject({
      badgeText: '⚠',
      badgeColor: '#D55E00',
      scope: 'tab',
      title: 'Heads up — attributed to someone else in Quotewise',
    });
  });

  it('renders static loading while a duplicate check is in flight', () => {
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      null,
      { ...tweetTab, isCheckInFlight: true },
    )).toMatchObject({
      badgeText: '●',
      badgeColor: '#56B4E9',
      scope: 'tab',
      title: 'Quotewise — checking this quote…',
    });
  });

  it('keeps a known quote status visible while revalidating in the background', () => {
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('new_quote'),
      { ...tweetTab, isCheckInFlight: true },
    )).toMatchObject({
      badgeText: '★',
      badgeColor: '#0072B2',
      scope: 'tab',
      title: 'New quote — not in Quotewise yet',
    });

    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('duplicate'),
      { ...tweetTab, isCheckInFlight: true },
    )).toMatchObject({
      badgeText: '=',
      badgeColor: '#009E73',
      scope: 'tab',
      title: 'Exact match already in Quotewise',
    });
  });

  it('renders auth errors globally and ahead of duplicate data', () => {
    expect(resolveIconPresentation(AuthState.SESSION_EXPIRED, duplicate('duplicate'), tweetTab)).toMatchObject({
      badgeText: '!',
      badgeColor: '#D55E00',
      scope: 'global',
      title: 'Quotewise — session expired, log in again',
    });
    expect(resolveIconPresentation(AuthState.INSUFFICIENT_PRIVILEGES, duplicate('new_quote'), tweetTab)).toMatchObject({
      badgeText: '!',
      badgeColor: '#D55E00',
      scope: 'global',
      title: 'Quotewise — additional permissions required',
    });
  });

  it('renders Paused after logged-out/errors and ahead of loading, idle, and quote status', () => {
    for (const state of [AuthState.SESSION_EXPIRED, AuthState.INSUFFICIENT_PRIVILEGES]) {
      expect(resolveIconPresentation(state, duplicate('new_quote'), tweetTab, true)).toMatchObject({
        badgeText: '!',
        scope: 'global',
      });
    }

    expect(resolveIconPresentation(AuthState.UNAUTHENTICATED, null, tweetTab, true)).toMatchObject({
      title: 'Quotewise — log in to capture quotes',
      badgeText: '',
    });

    for (const state of [AuthState.AUTHENTICATED, AuthState.UNKNOWN, AuthState.CHECKING, AuthState.AUTHENTICATING]) {
      expect(resolveIconPresentation(
        state,
        duplicate('duplicate'),
        { ...tweetTab, isCheckInFlight: true },
        true,
      )).toMatchObject({
        iconVariant: 'grey',
        badgeText: '⏸︎',
        badgeColor: '#64748B',
        scope: 'global',
        title: 'Quotewise — paused (private mode)',
      });
    }
  });

  it('falls back to the ambient state on errored checks and supported idle on non-tweet pages', () => {
    // Previously badged "=" / "this post has captured passages" — a claim built
    // on a check that never completed. The tray reports the failure; the icon
    // simply declines to assert.
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('duplicate', { search_metadata: { error: true } }),
      tweetTab,
    )).toMatchObject({
      badgeText: '',
      title: 'Quotewise — ready to capture',
    });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_quote'), supportedNonTweetTab)).toMatchObject({
      badgeText: '',
      title: 'Quotewise — open a post to capture',
    });
  });

  it('does not show loading or quote-status badges on unsupported sites', () => {
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('new_quote'),
      { ...unsupportedTab, isCheckInFlight: true },
    )).toMatchObject({
      iconVariant: 'grey',
      badgeText: '',
      scope: 'global',
      title: 'Quotewise — capture works on X, Threads, Bluesky & Substack Notes',
    });
  });

  it('is total across auth, recommendation, collected, tweet, and in-flight combinations', () => {
    const recommendations = [
      null,
      'new_quote',
      'new_quote_known_author',
      'duplicate',
      'duplicate_known_author',
      'new_version',
      'new_version_known_author',
      'attribution_conflict',
      'attribution_conflict_resolved',
      'banana',
    ];

    for (const auth of Object.values(AuthState)) {
      for (const recommendation of recommendations) {
        for (const isSupportedPlatform of [true, false]) {
          for (const isPostPage of [true, false]) {
            for (const isCheckInFlight of [true, false]) {
              for (const isOriginatorMissing of [true, false]) {
                for (const collected of [true, false]) {
                  const result = recommendation === null
                    ? null
                    : duplicate(recommendation, {
                      matches: collected ? [{
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
                      }] : [],
                    });

                  const tab = {
                    tabId: 1,
                    isSupportedPlatform,
                    isPostPage,
                    isCheckInFlight,
                    isOriginatorMissing,
                  };
                  expect(() => resolveIconPresentation(auth, result, tab)).not.toThrow();
                  expectPresentation(resolveIconPresentation(auth, result, tab));
                }
              }
            }
          }
        }
      }
    }
  });
});
