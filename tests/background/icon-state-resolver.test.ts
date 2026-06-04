import { AuthState } from '../../src/auth/auth-state-machine';
import { resolveIconPresentation, type IconPresentation, type TabContext } from '../../src/background/icon-state-resolver';
import type { DuplicateCheckResult } from '../../src/types/api';

const tweetTab: TabContext = { tabId: 1, isTweetPage: true, isCheckInFlight: false };
const nonTweetTab: TabContext = { tabId: 1, isTweetPage: false, isCheckInFlight: false };

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
  it('renders logged-out, ready, and auth-pending ambient states', () => {
    expect(resolveIconPresentation(AuthState.UNAUTHENTICATED, null, nonTweetTab)).toMatchObject({
      iconVariant: 'grey',
      badgeText: '',
      scope: 'global',
      title: 'Quotewise — log in to capture quotes',
    });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, null, nonTweetTab)).toMatchObject({
      iconVariant: 'color',
      badgeText: '',
      scope: 'global',
      title: 'Quotewise — ready to capture',
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
      badgeColor: '#E69F00',
    });
    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_version'), tweetTab)).toMatchObject({
      badgeText: '~',
      badgeColor: '#CC79A7',
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
      duplicate('duplicate'),
      { ...tweetTab, isCheckInFlight: true },
    )).toMatchObject({
      badgeText: '●',
      badgeColor: '#56B4E9',
      scope: 'tab',
      title: 'Quotewise — checking this quote…',
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

  it('falls back to ready on errored duplicate checks and non-tweet pages', () => {
    expect(resolveIconPresentation(
      AuthState.AUTHENTICATED,
      duplicate('duplicate', { search_metadata: { error: true } }),
      tweetTab,
    )).toMatchObject({
      badgeText: '',
      title: 'Quotewise — ready to capture',
    });

    expect(resolveIconPresentation(AuthState.AUTHENTICATED, duplicate('new_quote'), nonTweetTab)).toMatchObject({
      badgeText: '',
      title: 'Quotewise — ready to capture',
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
        for (const isTweetPage of [true, false]) {
          for (const isCheckInFlight of [true, false]) {
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

              expect(() => resolveIconPresentation(auth, result, {
                tabId: 1,
                isTweetPage,
                isCheckInFlight,
              })).not.toThrow();
              expectPresentation(resolveIconPresentation(auth, result, {
                tabId: 1,
                isTweetPage,
                isCheckInFlight,
              }));
            }
          }
        }
      }
    }
  });
});
