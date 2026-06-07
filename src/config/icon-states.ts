export type IconVariant = 'color' | 'grey';
export type IconScope = 'global' | 'tab';

export interface IconStateConfig {
  iconVariant: IconVariant;
  badgeText: string;
  badgeColor: string;
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
    title: 'Quotewise — open a tweet to capture',
    scope: 'global',
  },
  UnsupportedPage: {
    iconVariant: 'grey',
    badgeText: '',
    badgeColor: '#0072B2',
    title: 'Quotewise — capture works on X/Twitter tweets',
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
  Similar: {
    iconVariant: 'color',
    badgeText: '~',
    badgeColor: '#E69F00',
    title: 'Similar version already in Quotewise',
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
    title: 'New quote — not in Quotewise yet',
    scope: 'tab',
  },
} as const satisfies Record<string, IconStateConfig>;
