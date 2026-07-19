import { applyIconPresentation, getIconApplicatorDiagnostics } from '../../src/background/icon-applicator';
import type { IconPresentation } from '../../src/background/icon-state-resolver';

const colorPaths = {
  16: '/icons/icon16.png',
  32: '/icons/icon32.png',
  48: '/icons/icon48.png',
  128: '/icons/icon128.png',
};

const greyPaths = {
  16: '/icons/icon16-grey.png',
  32: '/icons/icon32-grey.png',
  48: '/icons/icon48-grey.png',
  128: '/icons/icon128-grey.png',
};

function presentation(overrides: Partial<IconPresentation> = {}): IconPresentation {
  return {
    iconVariant: 'color',
    badgeText: '',
    badgeColor: '#0072B2',
    title: 'Quotewise',
    scope: 'global',
    ...overrides,
  };
}

describe('applyIconPresentation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies color paths globally without tabId for global scope', async () => {
    await applyIconPresentation(presentation(), 42);

    expect(chrome.action.setIcon).toHaveBeenCalledWith({ path: colorPaths });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalled();
    expect(chrome.action.setTitle).toHaveBeenCalledWith({ title: 'Quotewise' });
  });

  it('applies grey paths and includes tabId for tab scope', async () => {
    await applyIconPresentation(
      presentation({
        iconVariant: 'grey',
        badgeText: '!',
        badgeColor: '#D55E00',
        title: 'Quotewise — session expired, log in again',
        scope: 'tab',
      }),
      7,
    );

    expect(chrome.action.setIcon).toHaveBeenCalledWith({ tabId: 7, path: greyPaths });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: '#D55E00' });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 7,
      title: 'Quotewise — session expired, log in again',
    });
  });

  it('includes tabId for global presentations only when forceTabScope is used', async () => {
    await applyIconPresentation(presentation({ title: 'Quotewise — ready to capture' }), 9, {
      forceTabScope: true,
    });

    expect(chrome.action.setIcon).toHaveBeenCalledWith({ tabId: 9, path: colorPaths });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 9, text: '' });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 9,
      title: 'Quotewise — ready to capture',
    });
  });

  it('applies a saturated count badge with exact accessible title and contrast colors', async () => {
    const countPresentation = {
      ...presentation({
        badgeColor: '#009E73',
        scope: 'tab',
      }),
      badgeTextColor: '#FFFFFF',
      passageCount: 12,
    } as IconPresentation;

    await applyIconPresentation(countPresentation, 3);

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: '9+' });
    expect(chrome.action.setBadgeTextColor).toHaveBeenCalledWith({ tabId: 3, color: '#FFFFFF' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 3, color: '#009E73' });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 3,
      title: 'Quotewise — 12 passages captured from this post',
    });
  });

  it('still applies the badge and title when Chrome cannot fetch icon artwork', async () => {
    chrome.action.setIcon = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

    await applyIconPresentation(
      presentation({
        badgeText: '=',
        badgeColor: '#009E73',
        title: 'Exact match already in Quotewise',
        scope: 'tab',
      }),
      11,
    );

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 11, text: '=' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      tabId: 11,
      color: '#009E73',
    });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 11,
      title: 'Exact match already in Quotewise',
    });
    expect(getIconApplicatorDiagnostics()).toEqual({
      lastAttempt: expect.objectContaining({
        scope: 'tab',
        tabId: 11,
        iconVariant: 'color',
        badgeText: '=',
        badgeColor: '#009E73',
        title: 'Exact match already in Quotewise',
        path: colorPaths,
      }),
      lastArtworkError: expect.objectContaining({
        message: 'Failed to fetch',
        name: 'Error',
        scope: 'tab',
        tabId: 11,
        iconVariant: 'color',
        path: colorPaths,
      }),
    });
  });

  it('can overwrite a prior tab-scoped star on logout or session expiry', async () => {
    await applyIconPresentation(
      presentation({
        badgeText: '★',
        badgeColor: '#0072B2',
        title: 'Quotewise — nothing captured from this post yet',
        scope: 'tab',
      }),
      5,
    );
    await applyIconPresentation(
      presentation({
        iconVariant: 'grey',
        badgeText: '',
        badgeColor: '#0072B2',
        title: 'Quotewise — log in to capture quotes',
        scope: 'global',
      }),
      5,
      { forceTabScope: true },
    );

    expect(chrome.action.setIcon).toHaveBeenLastCalledWith({ tabId: 5, path: greyPaths });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 5, text: '' });
  });
});
