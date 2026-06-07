import { AuthState } from '../auth/auth-state-machine';
import { ICON_STATES, type IconScope, type IconVariant } from '../config/icon-states';
import type { DuplicateCheckResult } from '../types/api';
import { mapRecommendationToQuoteStatus } from '../utils/duplicate-status';

export interface TabContext {
  tabId: number;
  isSupportedPlatform: boolean;
  isTweetPage: boolean;
  isCheckInFlight: boolean;
  isOriginatorMissing?: boolean;
}

export interface IconPresentation {
  iconVariant: IconVariant;
  badgeText: string;
  badgeColor: string;
  title: string;
  scope: IconScope;
}

const QUOTE_STATUS_TO_STATE = {
  InCollection: ICON_STATES.InCollection,
  Conflict: ICON_STATES.Conflict,
  Exact: ICON_STATES.Exact,
  Similar: ICON_STATES.Similar,
  New: ICON_STATES.New,
} as const;

export function resolveIconPresentation(
  auth: AuthState,
  dup: DuplicateCheckResult | null,
  tab: TabContext,
): IconPresentation {
  const quoteStatus = mapRecommendationToQuoteStatus(dup);

  if (auth === AuthState.SESSION_EXPIRED) {
    return ICON_STATES.ErrorSessionExpired;
  }

  if (auth === AuthState.INSUFFICIENT_PRIVILEGES) {
    return ICON_STATES.ErrorInsufficientPrivileges;
  }

  if (auth === AuthState.UNAUTHENTICATED) {
    return ICON_STATES.LoggedOut;
  }

  if (
    tab.isSupportedPlatform &&
    tab.isTweetPage &&
    tab.isCheckInFlight &&
    quoteStatus === 'None' &&
    !tab.isOriginatorMissing
  ) {
    return ICON_STATES.Loading;
  }

  if (
    auth === AuthState.UNKNOWN ||
    auth === AuthState.CHECKING ||
    auth === AuthState.AUTHENTICATING
  ) {
    return ICON_STATES.AuthPending;
  }

  if (auth === AuthState.AUTHENTICATED && !tab.isSupportedPlatform) {
    return ICON_STATES.UnsupportedPage;
  }

  if (auth === AuthState.AUTHENTICATED && !tab.isTweetPage) {
    return ICON_STATES.SupportedIdle;
  }

  if (auth === AuthState.AUTHENTICATED && tab.isTweetPage) {
    if (quoteStatus !== 'None' && quoteStatus !== 'New') {
      return QUOTE_STATUS_TO_STATE[quoteStatus];
    }

    if (tab.isOriginatorMissing) {
      return ICON_STATES.MissingOriginator;
    }

    if (quoteStatus === 'New') {
      return ICON_STATES.New;
    }
  }

  return ICON_STATES.Ready;
}
