import type { IconPresentation } from './icon-state-resolver';

export interface ApplyIconPresentationOptions {
  forceTabScope?: boolean;
}

export interface IconApplicationAttempt {
  timestamp: number;
  scope: IconPresentation['scope'];
  tabId?: number;
  forceTabScope: boolean;
  iconVariant: IconPresentation['iconVariant'];
  badgeText: string;
  badgeColor: string;
  title: string;
  path: Record<number, string>;
}

export interface IconArtworkErrorDiagnostic {
  timestamp: number;
  message: string;
  name?: string;
  scope: IconPresentation['scope'];
  tabId?: number;
  iconVariant: IconPresentation['iconVariant'];
  path: Record<number, string>;
}

export interface IconApplicatorDiagnostics {
  lastAttempt: IconApplicationAttempt | null;
  lastArtworkError: IconArtworkErrorDiagnostic | null;
}

const COLOR_ICON_PATHS = {
  16: '/icons/icon16.png',
  32: '/icons/icon32.png',
  48: '/icons/icon48.png',
  128: '/icons/icon128.png',
};

const GREY_ICON_PATHS = {
  16: '/icons/icon16-grey.png',
  32: '/icons/icon32-grey.png',
  48: '/icons/icon48-grey.png',
  128: '/icons/icon128-grey.png',
};

let warnedIconArtworkFailure = false;
let lastAttempt: IconApplicationAttempt | null = null;
let lastArtworkError: IconArtworkErrorDiagnostic | null = null;

function clonePath(path: Record<number, string>): Record<number, string> {
  return { ...path };
}

function errorDiagnostic(error: unknown): Pick<IconArtworkErrorDiagnostic, 'message' | 'name'> {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }

  return { message: String(error) };
}

export function getIconApplicatorDiagnostics(): IconApplicatorDiagnostics {
  return {
    lastAttempt: lastAttempt
      ? {
        ...lastAttempt,
        path: clonePath(lastAttempt.path),
      }
      : null,
    lastArtworkError: lastArtworkError
      ? {
        ...lastArtworkError,
        path: clonePath(lastArtworkError.path),
      }
      : null,
  };
}

export async function applyIconPresentation(
  presentation: IconPresentation,
  tabId: number,
  options: ApplyIconPresentationOptions = {},
): Promise<void> {
  const effectiveScope = options.forceTabScope ? 'tab' : presentation.scope;
  const scopeArgs = effectiveScope === 'tab' ? { tabId } : {};
  const path = presentation.iconVariant === 'grey' ? GREY_ICON_PATHS : COLOR_ICON_PATHS;
  const passageCount = presentation.passageCount;
  const badgeText = passageCount === undefined
    ? presentation.badgeText
    : passageCount <= 9 ? String(passageCount) : '9+';
  const title = passageCount === undefined
    ? presentation.title
    : `Quotewise — ${passageCount} passages captured from this post`;
  lastAttempt = {
    timestamp: Date.now(),
    scope: effectiveScope,
    ...(effectiveScope === 'tab' ? { tabId } : {}),
    forceTabScope: options.forceTabScope === true,
    iconVariant: presentation.iconVariant,
    badgeText,
    badgeColor: presentation.badgeColor,
    title,
    path: clonePath(path),
  };

  try {
    await chrome.action.setIcon({ ...scopeArgs, path });
  } catch (error) {
    lastArtworkError = {
      timestamp: Date.now(),
      ...errorDiagnostic(error),
      scope: effectiveScope,
      ...(effectiveScope === 'tab' ? { tabId } : {}),
      iconVariant: presentation.iconVariant,
      path: clonePath(path),
    };

    if (!warnedIconArtworkFailure) {
      warnedIconArtworkFailure = true;
      console.warn('Unable to update extension icon artwork:', error);
    }
  }

  await chrome.action.setBadgeText({ ...scopeArgs, text: badgeText });

  if (badgeText !== '') {
    if (presentation.badgeTextColor) {
      await chrome.action.setBadgeTextColor({
        ...scopeArgs,
        color: presentation.badgeTextColor,
      });
    }
    await chrome.action.setBadgeBackgroundColor({
      ...scopeArgs,
      color: presentation.badgeColor,
    });
  }

  await chrome.action.setTitle({ ...scopeArgs, title });
}
