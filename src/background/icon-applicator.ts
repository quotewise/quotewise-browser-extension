import type { IconPresentation } from './icon-state-resolver';

export interface ApplyIconPresentationOptions {
  forceTabScope?: boolean;
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

export async function applyIconPresentation(
  presentation: IconPresentation,
  tabId: number,
  options: ApplyIconPresentationOptions = {},
): Promise<void> {
  const effectiveScope = options.forceTabScope ? 'tab' : presentation.scope;
  const scopeArgs = effectiveScope === 'tab' ? { tabId } : {};
  const path = presentation.iconVariant === 'grey' ? GREY_ICON_PATHS : COLOR_ICON_PATHS;

  try {
    await chrome.action.setIcon({ ...scopeArgs, path });
  } catch (error) {
    if (!warnedIconArtworkFailure) {
      warnedIconArtworkFailure = true;
      console.warn('Unable to update extension icon artwork:', error);
    }
  }

  await chrome.action.setBadgeText({ ...scopeArgs, text: presentation.badgeText });

  if (presentation.badgeText !== '') {
    await chrome.action.setBadgeBackgroundColor({
      ...scopeArgs,
      color: presentation.badgeColor,
    });
  }

  await chrome.action.setTitle({ ...scopeArgs, title: presentation.title });
}
