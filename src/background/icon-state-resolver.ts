import { AuthState } from '../auth/auth-state-machine';
import { ICON_STATES, type IconScope, type IconVariant } from '../config/icon-states';
import type { DuplicateCheckResult } from '../types/api';
import { mapRecommendationToQuoteStatus, passageCountForUrl } from '../utils/duplicate-status';

export interface TabContext {
  tabId: number;
  isSupportedPlatform: boolean;
  isPostPage: boolean;
  isCheckInFlight: boolean;
  isOriginatorMissing?: boolean;
}

export interface IconPresentation {
  iconVariant: IconVariant;
  badgeText: string;
  badgeColor: string;
  badgeTextColor?: string;
  title: string;
  scope: IconScope;
  passageCount?: number;
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
  privateMode = false,
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

  if (privateMode) {
    return ICON_STATES.Paused;
  }

  if (
    tab.isSupportedPlatform &&
    tab.isPostPage &&
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

  if (auth === AuthState.AUTHENTICATED && !tab.isPostPage) {
    return ICON_STATES.SupportedIdle;
  }

  if (auth === AuthState.AUTHENTICATED && tab.isPostPage) {
    if (dup) {
      const passageCount = passageCountForUrl(dup);
      if (passageCount === 'unknown') {
        return ICON_STATES.HasCaptures;
      }
      if (passageCount >= 2) {
        return {
          ...ICON_STATES.Count,
          badgeText: passageCount <= 9 ? String(passageCount) : '9+',
          title: `Quotewise — ${passageCount} passages captured from this post`,
          passageCount,
        };
      }
    }

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
