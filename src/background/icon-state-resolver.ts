import { AuthState } from '../auth/auth-state-machine';
import { ICON_STATES, type IconScope, type IconVariant } from '../config/icon-states';
import type { DuplicateCheckResult } from '../types/api';
import { mapRecommendationToQuoteStatus } from '../utils/duplicate-status';

export interface TabContext {
  tabId: number;
  isTweetPage: boolean;
  isCheckInFlight: boolean;
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
  if (auth === AuthState.SESSION_EXPIRED) {
    return ICON_STATES.ErrorSessionExpired;
  }

  if (auth === AuthState.INSUFFICIENT_PRIVILEGES) {
    return ICON_STATES.ErrorInsufficientPrivileges;
  }

  if (auth === AuthState.UNAUTHENTICATED) {
    return ICON_STATES.LoggedOut;
  }

  if (tab.isCheckInFlight) {
    return ICON_STATES.Loading;
  }

  if (
    auth === AuthState.UNKNOWN ||
    auth === AuthState.CHECKING ||
    auth === AuthState.AUTHENTICATING
  ) {
    return ICON_STATES.AuthPending;
  }

  if (auth === AuthState.AUTHENTICATED && tab.isTweetPage) {
    const quoteStatus = mapRecommendationToQuoteStatus(dup);
    if (quoteStatus !== 'None') {
      return QUOTE_STATUS_TO_STATE[quoteStatus];
    }
  }

  return ICON_STATES.Ready;
}
