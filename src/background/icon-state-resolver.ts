import { AuthState } from '../auth/auth-state-machine';
import { ICON_STATES, type IconScope, type IconVariant } from '../config/icon-states';
import type { DuplicateCheckResult } from '../types/api';
import {
  blockingExactConflict,
  classifyMatchResolution,
  mapRecommendationToQuoteStatus,
  passageCountForUrl,
  secondaryConflicts,
} from '../utils/duplicate-status';

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
      // Attribution outranks everything else about the page, passage counts
      // included: whether the capture can proceed at all beats context about
      // what else lives on this post.
      if (quoteStatus === 'Conflict') {
        return ICON_STATES.Conflict;
      }
      // The same-originator match wins `primary`, so `recommendation` — and
      // therefore quoteStatus — reports it and never mentions the cross-
      // originator hit sitting behind it. Without this the icon badges a
      // contented green "=" while the tray hard-blocks Submit.
      if (blockingExactConflict(dup)) {
        return ICON_STATES.ExactAlsoElsewhere;
      }

      // null means the check told us nothing (it errored) — fall through to the
      // quote-status tiers rather than badging captures we cannot vouch for.
      const passageCount = passageCountForUrl(dup);
      if (passageCount === 'unknown') {
        return ICON_STATES.HasCaptures;
      }
      if (passageCount !== null && passageCount >= 2) {
        return {
          ...ICON_STATES.Count,
          badgeText: passageCount <= 9 ? String(passageCount) : '9+',
          title: `Quotewise — ${passageCount} passages captured from this post`,
          passageCount,
        };
      }
    }

    if (quoteStatus !== 'None' && quoteStatus !== 'New') {
      // With no originator resolved, a same-originator claim ("yours") cannot
      // be supported — the match is by definition somebody else's quote.
      // `InCollection` and `Conflict` pass through unchanged: InCollection is
      // genuinely the user's collection regardless of this post's originator,
      // and Conflict is already the strongest signal and must never be
      // weakened.
      if (tab.isOriginatorMissing) {
        if (quoteStatus === 'Exact') {
          return ICON_STATES.ExactElsewhere;
        }
        // Defensive symmetry: new_version (Similar) can't occur unscoped per
        // ADR-0009, but if it ever does, the same reasoning applies.
        if (quoteStatus === 'Similar') {
          return ICON_STATES.SimilarElsewhere;
        }
      }
      return QUOTE_STATUS_TO_STATE[quoteStatus];
    }

    // Something close is on record even though the recommendation tiers above
    // said otherwise.
    //
    // `recommendation` and `match_class` can disagree: with no originator the
    // server cannot recommend a *version* — there is nobody to version it under
    // — so it answers new_quote while the matches still carry `similar`. The
    // tray classifies on match_class, so an icon that trusts only the
    // recommendation ends up contradicting it on the same response.
    //
    // Ahead of MissingOriginator on purpose: knowing the quote is effectively
    // already on record beats being told to go create an originator for it.
    if (dup) {
      const crossOriginator = secondaryConflicts(dup).length > 0;
      // With the post's author absent from Quotewise, any match is by
      // definition somebody else's — so the stronger wording is earned.
      if (crossOriginator || (tab.isOriginatorMissing && classifyMatchResolution(dup) === 'similar')) {
        return ICON_STATES.SimilarElsewhere;
      }
      if (classifyMatchResolution(dup) === 'similar') {
        return ICON_STATES.Similar;
      }
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
