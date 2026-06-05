import type { DuplicateCheckResult } from '../../src/types/api';

const duplicateResult: DuplicateCheckResult = {
  recommendation: 'duplicate',
  confidence: 1,
  in_quotewise: true,
  matches: [],
  reasoning: 'Exact match',
  search_metadata: {},
};

function resetChromeMocks(): void {
  jest.clearAllMocks();
  chrome.storage.local.get = jest.fn().mockResolvedValue({});
  chrome.storage.local.set = jest.fn().mockResolvedValue(undefined);
  chrome.storage.local.remove = jest.fn().mockResolvedValue(undefined);
  chrome.tabs.query = jest.fn().mockResolvedValue([]);
  chrome.action.setIcon = jest.fn().mockResolvedValue(undefined);
  chrome.action.setTitle = jest.fn().mockResolvedValue(undefined);
  chrome.action.setBadgeText = jest.fn().mockResolvedValue(undefined);
  chrome.action.setBadgeBackgroundColor = jest.fn().mockResolvedValue(undefined);
}

describe('CHECK_DUPLICATE toolbar badge updates', () => {
  let capturedAuthPresentationUpdater: ((state: string) => Promise<void>) | null = null;

  beforeEach(() => {
    jest.resetModules();
    resetChromeMocks();
    capturedAuthPresentationUpdater = null;
  });

  function mockServiceWorkerDependencies(options: {
    handleMessage?: jest.Mock;
    authState?: string;
  } = {}): void {
    jest.doMock('../../src/background/api-handler', () => ({
      initializeApiHandler: jest.fn(() => ({
        handleMessage: options.handleMessage ?? jest.fn(),
      })),
    }));

    jest.doMock('../../src/background/auth-monitor', () => ({
      AuthenticationMonitor: jest.fn(),
    }));

    jest.doMock('../../src/background/storage-cleanup', () => ({
      initializeStorageCleanup: jest.fn(() => ({
        startPeriodicCleanup: jest.fn(),
        runCleanup: jest.fn(),
        getStorageStats: jest.fn(),
      })),
    }));

    jest.doMock('../../src/auth/auth-state-manager', () => {
      const { AuthState } = jest.requireActual('../../src/auth/auth-state-machine');
      const state = options.authState ?? AuthState.AUTHENTICATED;
      return {
        initializeAuthStateManager: jest.fn().mockResolvedValue({
          getState: jest.fn(() => state),
          isAuthenticated: jest.fn(() => state === AuthState.AUTHENTICATED),
          getStateData: jest.fn(() => ({ state })),
          startAuthenticating: jest.fn(),
          onAuthSuccess: jest.fn(),
          onAuthFailure: jest.fn(),
          onLogout: jest.fn(),
        }),
        setAuthPresentationUpdater: jest.fn((updater) => {
          capturedAuthPresentationUpdater = updater;
        }),
      };
    });

    jest.doMock('../../src/auth/token-refresh', () => ({
      initializeTokenRefresh: jest.fn().mockResolvedValue(undefined),
      handleTokenRefreshAlarm: jest.fn(),
    }));

    jest.doMock('../../src/auth/auth-flow', () => ({
      initiateOAuthFlow: jest.fn(),
      logout: jest.fn(),
    }));
  }

  it('applies loading and final duplicate badges for explicit overlay checks', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (_message, _sender, sendResponse) => {
        sendResponse({
          success: true,
          result: duplicateResult,
          ...duplicateResult,
        });
      }),
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();

    listener(
      {
        type: MessageType.CHECK_DUPLICATE,
        data: {
          text: 'Test quote',
          source_url: 'https://x.com/test/status/123',
        },
      },
      {
        tab: {
          id: 22,
          url: 'https://x.com/test/status/123',
        },
      },
      sendResponse,
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 22, text: '●' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '=' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      result: duplicateResult,
    }));
  });

  it('restores a tweet badge from preloaded duplicate cache after tab activation', async () => {
    mockServiceWorkerDependencies();

    chrome.storage.local.get = jest.fn().mockResolvedValue({
      preloadedDuplicateCheck: {
        url: 'https://x.com/test/status/123',
        result: duplicateResult,
        timestamp: Date.now(),
      },
    });
    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await import('../../src/background/service-worker');

    const listener = (chrome.tabs.onActivated.addListener as jest.Mock).mock.calls[0][0];
    await listener({ tabId: 22 });

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '=' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
  });

  it('preserves a cached tweet badge during authenticated auth presentation refreshes', async () => {
    mockServiceWorkerDependencies();

    chrome.storage.local.get = jest.fn().mockResolvedValue({
      preloadedDuplicateCheck: {
        url: 'https://x.com/test/status/123',
        result: duplicateResult,
        timestamp: Date.now(),
      },
    });
    chrome.tabs.query = jest.fn().mockResolvedValue([
      {
        id: 22,
        url: 'https://x.com/test/status/123',
      },
    ]);

    const { AuthState } = await import('../../src/auth/auth-state-machine');
    await import('../../src/background/service-worker');

    expect(capturedAuthPresentationUpdater).not.toBeNull();
    await capturedAuthPresentationUpdater!(AuthState.AUTHENTICATED);

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '=' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
  });

  it('applies the grey logged-out icon on fresh startup when no auth state is stored', async () => {
    const { AuthState } = await import('../../src/auth/auth-state-machine');
    mockServiceWorkerDependencies({ authState: AuthState.UNAUTHENTICATED });

    await import('../../src/background/service-worker');

    const listener = (chrome.runtime.onStartup.addListener as jest.Mock).mock.calls[0][0];
    await listener();

    expect(capturedAuthPresentationUpdater).not.toBeNull();
    await capturedAuthPresentationUpdater!(AuthState.UNAUTHENTICATED);

    expect(chrome.action.setIcon).toHaveBeenLastCalledWith({
      path: {
        16: 'icons/icon16-grey.png',
        32: 'icons/icon32-grey.png',
        48: 'icons/icon48-grey.png',
        128: 'icons/icon128-grey.png',
      },
    });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });
});
