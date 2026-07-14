import { AuthState } from '../../src/auth/auth-state-machine';
import { resolveIconPresentation, type IconPresentation, type TabContext } from '../../src/background/icon-state-resolver';
import type { DuplicateCheckResult } from '../../src/types/api';

const tweetTab: TabContext = {
  tabId: 1,
  isSupportedPlatform: true,
  isTweetPage: true,
  isCheckInFlight: false,
};
const supportedNonTweetTab: TabContext = {
  tabId: 1,
  isSupportedPlatform: true,
  isTweetPage: false,
  isCheckInFlight: false,
};
const unsupportedTab: TabContext = {
  tabId: 1,
  isSupportedPlatform: false,
  isTweetPage: false,
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
      title: 'Quotewise — capture works on X/Twitter tweets',
    });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, null, supportedNonTweetTab)).toMatchObject({
      iconVariant: 'color',
      badgeText: '',
      scope: 'global',
      title: 'Quotewise — open a tweet to capture',
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

    for (const result of [
      duplicate('duplicate', { search_metadata: { error: true } }),
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

  it('uses the neutral captured state on errored checks and supported idle on non-tweet pages', () => {
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('duplicate', { search_metadata: { error: true } }),
      tweetTab,
    )).toMatchObject({
      badgeText: '=',
      title: 'Quotewise — this post has captured passages',
    });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_quote'), supportedNonTweetTab)).toMatchObject({
      badgeText: '',
      title: 'Quotewise — open a tweet to capture',
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
      title: 'Quotewise — capture works on X/Twitter tweets',
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
          for (const isTweetPage of [true, false]) {
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
                    isTweetPage,
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
