export type IconVariant = 'color' | 'grey';
export type IconScope = 'global' | 'tab';

export interface IconStateConfig {
  iconVariant: IconVariant;
  badgeText: string;
  badgeColor: string;
  badgeTextColor?: string;
  title: string;
  scope: IconScope;
}

export const ICON_STATES = {
  Ready: {
    iconVariant: 'color',
    badgeText: '',
    badgeColor: '#0072B2',
    title: 'Quotewise — ready to capture',
    scope: 'global',
  },
  SupportedIdle: {
    iconVariant: 'color',
    badgeText: '',
    badgeColor: '#0072B2',
    title: 'Quotewise — open a post to capture',
    scope: 'global',
  },
  UnsupportedPage: {
    iconVariant: 'grey',
    badgeText: '',
    badgeColor: '#0072B2',
    title: 'Quotewise — capture works on X, Threads, Bluesky & Substack Notes',
    scope: 'global',
  },
  AuthPending: {
    iconVariant: 'color',
    badgeText: '',
    badgeColor: '#0072B2',
    title: 'Quotewise',
    scope: 'global',
  },
  LoggedOut: {
    iconVariant: 'grey',
    badgeText: '',
    badgeColor: '#0072B2',
    title: 'Quotewise — log in to capture quotes',
    scope: 'global',
  },
  Paused: {
    iconVariant: 'grey',
    badgeText: '⏸︎',
    badgeColor: '#64748B',
    title: 'Quotewise — paused (private mode)',
    scope: 'global',
  },
  Loading: {
    iconVariant: 'color',
    badgeText: '●',
    badgeColor: '#56B4E9',
    title: 'Quotewise — checking this quote…',
    scope: 'tab',
  },
  ErrorSessionExpired: {
    iconVariant: 'color',
    badgeText: '!',
    badgeColor: '#D55E00',
    title: 'Quotewise — session expired, log in again',
    scope: 'global',
  },
  ErrorInsufficientPrivileges: {
    iconVariant: 'color',
    badgeText: '!',
    badgeColor: '#D55E00',
    title: 'Quotewise — additional permissions required',
    scope: 'global',
  },
  InCollection: {
    iconVariant: 'color',
    badgeText: '✓',
    badgeColor: '#009E73',
    title: 'Already in your collection',
    scope: 'tab',
  },
  Conflict: {
    iconVariant: 'color',
    badgeText: '⚠',
    badgeColor: '#D55E00',
    title: 'Heads up — attributed to someone else in Quotewise',
    scope: 'tab',
  },
  Exact: {
    iconVariant: 'color',
    badgeText: '=',
    badgeColor: '#009E73',
    title: 'Exact match already in Quotewise',
    scope: 'tab',
  },
  /**
   * Your originator has this quote — and so does someone else, verbatim. Same
   * glyph as `Exact` because it is still the same text; amber rather than green
   * because the capture is blocked until the attribution is resolved.
   *
   * Distinct from `Conflict`: there the other originator's quote IS the match,
   * so a warning is the whole story. Here you legitimately have it too.
   */
  ExactAlsoElsewhere: {
    iconVariant: 'color',
    badgeText: '=',
    badgeColor: '#E69F00',
    title: 'Already yours — but this exact text is also attributed to someone else',
    scope: 'tab',
  },
  Count: {
    iconVariant: 'color',
    badgeText: '2',
    badgeColor: '#009E73',
    badgeTextColor: '#FFFFFF',
    title: 'Quotewise — 2 passages captured from this post',
    scope: 'tab',
  },
  HasCaptures: {
    iconVariant: 'color',
    badgeText: '=',
    badgeColor: '#009E73',
    title: 'Quotewise — this post has captured passages',
    scope: 'tab',
  },
  Similar: {
    iconVariant: 'color',
    badgeText: '~',
    badgeColor: '#E69F00',
    title: 'Similar version already in Quotewise',
    scope: 'tab',
  },
  /**
   * Nothing under your originator, but something close is on record under
   * someone else's name — previously badged `New`, which was affirmatively
   * wrong.
   *
   * Deliberately identical in glyph and colour to `Similar`. Neither blocks
   * anything and both mean "open the tray"; the title carries the difference.
   * A fifth colour would encode a distinction nobody acts on.
   */
  SimilarElsewhere: {
    iconVariant: 'color',
    badgeText: '~',
    badgeColor: '#E69F00',
    title: 'Similar to a quote attributed to someone else',
    scope: 'tab',
  },
  MissingOriginator: {
    iconVariant: 'color',
    badgeText: '@',
    badgeColor: '#E69F00',
    title: 'Originator not in Quotewise — add them first',
    scope: 'tab',
  },
  New: {
    iconVariant: 'color',
    badgeText: '★',
    badgeColor: '#0072B2',
    // Describes the *post*, not the text. This state is reached from two very
    // different checks: the URL-only automatic probe, which cannot speak to the
    // text at all, and a full text check that came back empty. Only the weaker
    // claim is true in both, and it is the one that matches its siblings —
    // HasCaptures and Count also describe the post.
    title: 'Quotewise — nothing captured from this post yet',
    scope: 'tab',
  },
} as const satisfies Record<string, IconStateConfig>;
