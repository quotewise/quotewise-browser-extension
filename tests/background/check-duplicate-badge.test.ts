import type { DuplicateCheckResult } from '../../src/types/api';
import type { TwitterData } from '../../src/types/chrome';

const duplicateResult: DuplicateCheckResult = {
  recommendation: 'duplicate',
  confidence: 1,
  in_quotewise: true,
  matches: [],
  reasoning: 'Exact match',
  search_metadata: {},
};

const tweetData: TwitterData = {
  text: 'Test quote',
  author: {
    username: 'test',
    displayName: 'Test User',
  },
  url: 'https://x.com/test/status/123',
  date: null,
  likes: 0,
  retweets: 0,
  replies: 0,
  views: 0,
  bookmarks: 0,
  tweetType: 'original',
  platform_data: {
    tweet_id: '123',
    reply_count: 0,
    retweet_count: 0,
    quote_count: 0,
    bookmark_count: 0,
    view_count: 0,
  },
};

function resetChromeMocks(): void {
  jest.clearAllMocks();
  chrome.storage.local.get = jest.fn().mockResolvedValue({});
  chrome.storage.local.set = jest.fn().mockResolvedValue(undefined);
  chrome.storage.local.remove = jest.fn().mockResolvedValue(undefined);
  chrome.tabs.query = jest.fn().mockResolvedValue([]);
  chrome.tabs.sendMessage = jest.fn();
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
    delete (globalThis as { __quotewiseDiagnostics?: unknown }).__quotewiseDiagnostics;
  });

  function mockServiceWorkerDependencies(options: {
    handleMessage?: jest.Mock;
    authState?: string;
    authStateData?: Record<string, unknown>;
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
          getStateData: jest.fn(() => ({ state, ...options.authStateData })),
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

  it('requests tweet extraction on tab load and applies the preflight badge without clicking the toolbar', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          sendResponse({
            success: true,
            originator: { found: false },
            duplicate_check: duplicateResult,
          });
        }
      }),
    });

    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
      success: true,
      data: tweetData,
    });

    await import('../../src/background/service-worker');

    const listener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await listener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(22, {
      type: 'EXTRACT_TWEET_DATA',
    });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 22, text: '●' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '=' });

    const getDiagnostics = (globalThis as {
      __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
    }).__quotewiseDiagnostics;
    expect(getDiagnostics).toEqual(expect.any(Function));

    const diagnostics = await getDiagnostics!();
    expect(diagnostics.extraction).toEqual(expect.objectContaining({
      status: 'succeeded',
      tabId: 22,
      url: 'https://x.com/test/status/123',
    }));
    expect(diagnostics.preflight).toEqual(expect.objectContaining({
      status: 'succeeded',
      trigger: 'automatic-preflight',
      tabId: 22,
      url: 'https://x.com/test/status/123',
      handle: 'test',
      duplicate: expect.objectContaining({
        recommendation: 'duplicate',
        inQuotewise: true,
      }),
    }));
  });

  it('returns token-safe runtime diagnostics via message', async () => {
    const { AuthState } = await import('../../src/auth/auth-state-machine');
    mockServiceWorkerDependencies({
      authState: AuthState.AUTHENTICATED,
      authStateData: {
        username: 'chris',
        scopes: ['quotes:write'],
        expiresAt: 1710000000000,
        lastCheckedAt: 1700000000000,
      },
    });

    chrome.tabs.query = jest.fn().mockResolvedValue([
      {
        id: 22,
        url: 'https://x.com/test/status/123',
      },
    ]);
    chrome.storage.local.get = jest.fn().mockResolvedValue({
      currentTweet: {
        data: tweetData,
        timestamp: 1700000000100,
        url: tweetData.url,
      },
      preloadedDuplicateCheck: {
        url: tweetData.url,
        result: duplicateResult,
        timestamp: 1700000000200,
      },
      preloadedOriginator: {
        handle: 'test',
        originator: {
          full_name: 'Test User',
          unique_id: 'test-user',
        },
        timestamp: 1700000000300,
      },
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const startupListener = (chrome.runtime.onStartup.addListener as jest.Mock).mock.calls[0][0];
    await startupListener();

    const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();

    listener(
      { type: MessageType.GET_DIAGNOSTICS },
      {},
      sendResponse,
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        manifest: expect.objectContaining({ version: '1.3.0' }),
        services: expect.objectContaining({
          initialized: true,
          apiHandler: true,
          authStateManager: true,
        }),
        auth: expect.objectContaining({
          initialized: true,
          state: AuthState.AUTHENTICATED,
          username: 'chris',
          scopes: ['quotes:write'],
        }),
        activeTab: expect.objectContaining({
          id: 22,
          url: 'https://x.com/test/status/123',
          isTweetPage: true,
        }),
        activeTabState: expect.objectContaining({
          tabId: 22,
          isTweetPage: true,
        }),
        storage: expect.objectContaining({
          currentTweet: expect.objectContaining({
            url: 'https://x.com/test/status/123',
            authorUsername: 'test',
            tweetId: '123',
          }),
          preloadedDuplicateCheck: expect.objectContaining({
            url: 'https://x.com/test/status/123',
            duplicate: expect.objectContaining({
              recommendation: 'duplicate',
            }),
          }),
          preloadedOriginator: expect.objectContaining({
            handle: 'test',
            fullName: 'Test User',
            uniqueId: 'test-user',
          }),
        }),
        icon: expect.objectContaining({
          lastAttempt: null,
          lastArtworkError: null,
        }),
      }),
    }));

    const response = sendResponse.mock.calls[0][0];
    expect(response.data.auth).not.toHaveProperty('accessToken');
    expect(response.data.auth).not.toHaveProperty('refreshToken');
    expect(response.data.storage.currentTweet).not.toHaveProperty('data');
    expect(response.data.storage.currentTweet).not.toHaveProperty('text');
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
        16: '/icons/icon16-grey.png',
        32: '/icons/icon32-grey.png',
        48: '/icons/icon48-grey.png',
        128: '/icons/icon128-grey.png',
      },
    });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });
});
