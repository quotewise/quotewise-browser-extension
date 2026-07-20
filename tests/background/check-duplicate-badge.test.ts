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

const newQuoteResult: DuplicateCheckResult = {
  recommendation: 'new_quote',
  confidence: 1,
  in_quotewise: false,
  matches: [],
  reasoning: 'No match',
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

const parentTweetData: TwitterData = {
  ...tweetData,
  text: 'Parent quote',
  author: {
    username: 'known',
    displayName: 'Known Originator',
  },
  url: 'https://x.com/known/status/111',
  platform_data: {
    ...tweetData.platform_data,
    tweet_id: '111',
  },
};

const replyTweetData: TwitterData = {
  ...tweetData,
  text: 'Reply quote',
  author: {
    username: 'replier',
    displayName: 'Reply User',
  },
  url: 'https://x.com/replier/status/222',
  platform_data: {
    ...tweetData.platform_data,
    tweet_id: '222',
  },
};

const colorIconPaths = {
  16: '/icons/icon16.png',
  32: '/icons/icon32.png',
  48: '/icons/icon48.png',
  128: '/icons/icon128.png',
};

const greyIconPaths = {
  16: '/icons/icon16-grey.png',
  32: '/icons/icon32-grey.png',
  48: '/icons/icon48-grey.png',
  128: '/icons/icon128-grey.png',
};

function resetChromeMocks(): void {
  jest.clearAllMocks();
  chrome.runtime.getManifest = jest.fn(() => ({
    manifest_version: 3,
    name: 'Quotewise [DEV]',
    version: '1.3.0',
  }));
  chrome.storage.local.get = jest.fn().mockResolvedValue({});
  chrome.storage.local.set = jest.fn().mockResolvedValue(undefined);
  chrome.storage.local.remove = jest.fn().mockResolvedValue(undefined);
  chrome.storage.session.get = jest.fn().mockResolvedValue({});
  chrome.storage.session.set = jest.fn().mockResolvedValue(undefined);
  chrome.storage.session.remove = jest.fn().mockResolvedValue(undefined);
  chrome.tabs.query = jest.fn().mockResolvedValue([]);
  chrome.tabs.get = jest.fn();
  chrome.tabs.sendMessage = jest.fn();
  chrome.action.setIcon = jest.fn().mockResolvedValue(undefined);
  chrome.action.setTitle = jest.fn().mockResolvedValue(undefined);
  chrome.action.setBadgeText = jest.fn().mockResolvedValue(undefined);
  chrome.action.setBadgeTextColor = jest.fn().mockResolvedValue(undefined);
  chrome.action.setBadgeBackgroundColor = jest.fn().mockResolvedValue(undefined);
  chrome.alarms.create = jest.fn();
  chrome.alarms.clear = jest.fn().mockResolvedValue(true);
}

async function flushPromises(count = 3): Promise<void> {
  for (let index = 0; index < count; index++) {
    await Promise.resolve();
  }
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
      let state = options.authState ?? AuthState.AUTHENTICATED;
      const transitionTo = jest.fn(async (newState: string) => {
        state = newState;
        if (capturedAuthPresentationUpdater) {
          await capturedAuthPresentationUpdater(newState);
        }
      });
      return {
        initializeAuthStateManager: jest.fn().mockResolvedValue({
          getState: jest.fn(() => state),
          isAuthenticated: jest.fn(() => state === AuthState.AUTHENTICATED),
          getStateData: jest.fn(() => ({ state, ...options.authStateData })),
          startAuthenticating: jest.fn(async () => transitionTo(AuthState.AUTHENTICATING)),
          onAuthSuccess: jest.fn(async () => transitionTo(AuthState.AUTHENTICATED)),
          onAuthFailure: jest.fn(async () => transitionTo(AuthState.UNAUTHENTICATED)),
          onLogout: jest.fn(async () => transitionTo(AuthState.UNAUTHENTICATED)),
          onTokenRefreshFailed: jest.fn(async () => transitionTo(AuthState.SESSION_EXPIRED)),
          onInsufficientPrivileges: jest.fn(async () => transitionTo(AuthState.INSUFFICIENT_PRIVILEGES)),
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
      color: '#009E73',
    });
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      result: duplicateResult,
    }));
  });

  it('marks the sender post as collected immediately after a successful quote submission', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (_message, _sender, sendResponse) => {
        sendResponse({
          success: true,
          message: 'Quote submitted successfully',
          quoteId: '456',
        });
      }),
    });
    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: tweetData.url,
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();
    listener(
      {
        type: MessageType.SUBMIT_QUOTE,
        data: {
          text: tweetData.text,
          originator_slug: 'test-user',
          source_url: tweetData.url,
        },
      },
      { tab: { id: 22, url: tweetData.url } },
      sendResponse,
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    // Submitting a quote puts it in Quotewise, NOT in a user collection — the badge
    // must show the exists state (=), not the in-collection checkmark (✓).
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '=' });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
      tabId: 22,
      title: 'Exact match already in Quotewise',
    });
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 22, text: '✓' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      preloadedDuplicateCheck: {
        url: tweetData.url,
        result: expect.objectContaining({
          recommendation: 'duplicate',
          in_quotewise: true,
          matches: [expect.objectContaining({ in_user_collections: false })],
        }),
        timestamp: expect.any(Number),
      },
    });
  });

  it('keeps the submitted state when a stale pre-submit duplicate check resolves late', async () => {
    const { MessageType } = await import('../../src/types/chrome');
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === MessageType.SUBMIT_QUOTE) {
          sendResponse({ success: true, message: 'Quote submitted successfully', quoteId: '456' });
          return;
        }
        // A duplicate check that started before the submit resolves late with the
        // pre-submit answer: the quote did not exist yet.
        sendResponse({ success: true, result: newQuoteResult, ...newQuoteResult });
      }),
    });
    chrome.tabs.get = jest.fn().mockResolvedValue({ id: 22, url: tweetData.url });

    await import('../../src/background/service-worker');
    const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];

    listener(
      {
        type: MessageType.SUBMIT_QUOTE,
        data: { text: tweetData.text, originator_slug: 'test-user', source_url: tweetData.url },
      },
      { tab: { id: 22, url: tweetData.url } },
      jest.fn(),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '=' });

    listener(
      {
        type: MessageType.CHECK_DUPLICATE,
        data: { text: tweetData.text, source_url: tweetData.url },
      },
      { tab: { id: 22, url: tweetData.url } },
      jest.fn(),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    // The just-submitted quote definitionally exists: a late "new_quote" answer for the
    // same post must not downgrade the badge back to ★.
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 22, text: '★' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '=' });
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
      type: 'EXTRACT_POST_DATA',
    });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 22, text: '●' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '=' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      preloadedDuplicateCheck: expect.objectContaining({
        url: tweetData.url,
        result: duplicateResult,
        preflightMs: expect.any(Number),
      }),
    });

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

  it('applies the cached URL passage count from automatic preflight to the tab icon', async () => {
    const countedResult: DuplicateCheckResult = {
      ...duplicateResult,
      existing_sightings_total: 12,
      existing_sightings_for_url: [],
    };
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          sendResponse({
            success: true,
            originator: { found: false },
            duplicate_check: countedResult,
          });
        }
      }),
    });
    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({ success: true, data: tweetData });

    await import('../../src/background/service-worker');

    const listener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await listener(22, { status: 'complete' }, { id: 22, url: tweetData.url });
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '9+' });
    expect(chrome.action.setBadgeTextColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#FFFFFF',
    });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#009E73',
    });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
      tabId: 22,
      title: 'Quotewise — 12 passages captured from this post',
    });
  });

  it('keeps automatic preflight identifier-only and explicit preflight text-bearing', async () => {
    const handleMessage = jest.fn(async (message, _sender, sendResponse) => {
      if (message.type === 'PREFLIGHT_CHECK') {
        sendResponse({
          success: true,
          originator: { found: false },
          duplicate_check: newQuoteResult,
        });
      }
    });
    mockServiceWorkerDependencies({ handleMessage });
    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({ success: true, data: tweetData });
    chrome.tabs.get = jest.fn().mockResolvedValue({ id: 22, url: tweetData.url });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const tabListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await tabListener(22, { status: 'complete' }, { id: 22, url: tweetData.url });
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const automatic = handleMessage.mock.calls
      .map(([message]) => message)
      .find(message => message.type === MessageType.PREFLIGHT_CHECK);
    expect(automatic?.data).toEqual({
      handle: 'test',
      platform: 'twitter',
      source_url: tweetData.url,
    });

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    runtimeListener(
      {
        type: MessageType.CHECK_NOW,
        data: {
          handle: 'test',
          platform: 'twitter',
          source_url: tweetData.url,
          text: 'Explicit selection',
        },
      },
      { tab: { id: 22, url: tweetData.url } },
      jest.fn(),
    );
    await flushPromises(10);

    const explicit = handleMessage.mock.calls
      .map(([message]) => message)
      .filter(message => message.type === MessageType.PREFLIGHT_CHECK)[1];
    expect(explicit?.data).toEqual({
      handle: 'test',
      platform: 'twitter',
      source_url: tweetData.url,
      text: 'Explicit selection',
    });
  });

  it('dedupes same-tweet automatic extraction from tab update and history navigation bursts', async () => {
    let completeExtraction!: (response: Record<string, unknown>) => void;
    const handleMessage = jest.fn(async (message, _sender, sendResponse) => {
      if (message.type === 'PREFLIGHT_CHECK') {
        sendResponse({
          success: true,
          originator: {
            found: false,
            handle: 'test',
            platform: 'twitter',
            create_url: 'https://quotewise.io/originators/new?handle=test',
          },
          duplicate_check: newQuoteResult,
        });
      }
    });
    mockServiceWorkerDependencies({ handleMessage });

    chrome.tabs.sendMessage = jest.fn().mockImplementation(() => new Promise(resolve => {
      completeExtraction = resolve;
    }));

    await import('../../src/background/service-worker');
    const startupListener = (chrome.runtime.onStartup.addListener as jest.Mock).mock.calls[0][0];
    await startupListener();

    const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    const historyListener = (chrome.webNavigation.onHistoryStateUpdated.addListener as jest.Mock).mock.calls[0][0];

    const tabUpdatePromise = tabUpdateListener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });
    await flushPromises(10);

    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);

    const historyPromise = historyListener({
      frameId: 0,
      tabId: 22,
      url: 'https://x.com/test/status/123',
    });
    await flushPromises(10);

    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);

    completeExtraction({
      success: true,
      data: tweetData,
    });
    await tabUpdatePromise;
    await historyPromise;
    await flushPromises(10);

    const preflightCalls = handleMessage.mock.calls.filter(([message]) => message.type === 'PREFLIGHT_CHECK');
    expect(preflightCalls).toHaveLength(1);

    const getDiagnostics = (globalThis as {
      __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
    }).__quotewiseDiagnostics;
    const diagnostics = await getDiagnostics!();
    expect(diagnostics.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'extraction_request_deduped',
        sourceUrl: 'https://x.com/test/status/123',
        reason: 'same_tweet_extraction_in_flight',
      }),
    ]));
    expect(diagnostics.events.filter((event: Record<string, unknown>) => (
      event.event === 'automatic_preflight_started' &&
      event.sourceUrl === 'https://x.com/test/status/123'
    ))).toHaveLength(1);
  });

  it('keeps the extracted-tweet message open until automatic preflight applies the icon', async () => {
    let completePreflight!: (response: Record<string, unknown>) => void;
    mockServiceWorkerDependencies({
      handleMessage: jest.fn((message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          completePreflight = sendResponse;
        }
        return Promise.resolve();
      }),
    });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();
    runtimeListener(
      {
        type: MessageType.POST_DATA_EXTRACTED,
        data: tweetData,
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

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });
    expect(sendResponse).not.toHaveBeenCalled();

    completePreflight({
      success: true,
      originator: {
        found: false,
        handle: 'test',
        platform: 'twitter',
        create_url: 'https://quotewise.io/originators/new?handle=test',
      },
      duplicate_check: newQuoteResult,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('revives @ alongside the cached duplicate result after a worker restart', async () => {
    // Both caches were written by the previous visit's preflight: the duplicate
    // result (★-producing new_quote) AND the not-found originator record. A
    // fresh worker that revives one without the other paints ★ over what the
    // user last saw as @.
    mockServiceWorkerDependencies();

    chrome.storage.local.get = jest.fn().mockResolvedValue({
      preloadedDuplicateCheck: {
        url: 'https://x.com/test/status/123',
        result: newQuoteResult,
        timestamp: Date.now(),
      },
      preloadedOriginator: {
        handle: 'test',
        originator: null,
        create_url: 'https://quotewise.io/originators/new?handle=test',
        url: 'https://x.com/test/status/123',
        timestamp: Date.now(),
      },
    });
    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await import('../../src/background/service-worker');

    const onUpdatedListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await onUpdatedListener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    for (let index = 0; index < 6; index++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const paints = (chrome.action.setBadgeText as jest.Mock).mock.calls.map(call => call[0]);
    expect(paints).not.toContainEqual({ tabId: 22, text: '★' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
  });

  it('keeps @ through a hydration re-extraction instead of flashing ★ each round', async () => {
    // Twitter fires POST_DATA_EXTRACTED repeatedly as the page hydrates. A
    // re-extraction of the SAME url contradicts nothing about the originator,
    // so the settled @ must not regress to ★ while the next round re-verifies.
    const preflightResponders: Array<(response: Record<string, unknown>) => void> = [];
    const handleMessage = jest.fn((message, _sender, sendResponse) => {
      if (message.type === 'PREFLIGHT_CHECK') {
        preflightResponders.push(sendResponse);
      }
      return Promise.resolve();
    });
    mockServiceWorkerDependencies({ handleMessage });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sender = { tab: { id: 22, url: 'https://x.com/test/status/123' } };
    const notFoundPreflight = {
      success: true,
      originator: {
        found: false,
        handle: 'test',
        platform: 'twitter',
        create_url: 'https://quotewise.io/originators/new?handle=test',
      },
      duplicate_check: newQuoteResult,
    };

    const flushMacrotasks = async (count = 6): Promise<void> => {
      for (let index = 0; index < count; index++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };

    // Round 1: extraction → preflight answers "no originator" → settles @.
    runtimeListener({ type: MessageType.POST_DATA_EXTRACTED, data: tweetData }, sender, jest.fn());
    await flushMacrotasks();
    preflightResponders[0]!(notFoundPreflight);
    await flushMacrotasks();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });

    // Round 2: hydration re-fires extraction for the same post.
    const paintsBeforeRoundTwo = (chrome.action.setBadgeText as jest.Mock).mock.calls.length;
    runtimeListener({ type: MessageType.POST_DATA_EXTRACTED, data: tweetData }, sender, jest.fn());
    await flushMacrotasks();

    const roundTwoPaints = (chrome.action.setBadgeText as jest.Mock).mock.calls
      .slice(paintsBeforeRoundTwo)
      .map(call => call[0]);
    expect(roundTwoPaints).not.toContainEqual({ tabId: 22, text: '★' });

    // And after round 2's preflight answers the same way, still @.
    preflightResponders[1]?.(notFoundPreflight);
    await flushMacrotasks();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
  });

  it('dedupes same-tweet extracted data messages before automatic preflight starts', async () => {
    let completePreflight!: (response: Record<string, unknown>) => void;
    const handleMessage = jest.fn((message, _sender, sendResponse) => {
      if (message.type === 'PREFLIGHT_CHECK') {
        completePreflight = sendResponse;
      }
      return Promise.resolve();
    });
    mockServiceWorkerDependencies({ handleMessage });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const startupListener = (chrome.runtime.onStartup.addListener as jest.Mock).mock.calls[0][0];
    await startupListener();

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponseOne = jest.fn();
    const sendResponseTwo = jest.fn();

    runtimeListener(
      {
        type: MessageType.POST_DATA_EXTRACTED,
        data: tweetData,
      },
      {
        tab: {
          id: 22,
          url: 'https://x.com/test/status/123',
        },
      },
      sendResponseOne,
    );
    runtimeListener(
      {
        type: MessageType.POST_DATA_EXTRACTED,
        data: tweetData,
      },
      {
        tab: {
          id: 22,
          url: 'https://x.com/test/status/123',
        },
      },
      sendResponseTwo,
    );

    await flushPromises(20);

    const preflightCalls = handleMessage.mock.calls.filter(([message]) => message.type === 'PREFLIGHT_CHECK');
    expect(preflightCalls).toHaveLength(1);

    const getDiagnostics = (globalThis as {
      __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
    }).__quotewiseDiagnostics;
    let diagnostics = await getDiagnostics!();
    expect(diagnostics.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'automatic_preflight_deduped',
        sourceUrl: 'https://x.com/test/status/123',
        reason: 'same_tweet_preflight_in_flight',
      }),
    ]));
    expect(diagnostics.events.filter((event: Record<string, unknown>) => (
      event.event === 'originator_probe_scheduled' &&
      event.sourceUrl === 'https://x.com/test/status/123'
    ))).toHaveLength(1);

    completePreflight({
      success: true,
      originator: {
        found: false,
        handle: 'test',
        platform: 'twitter',
        create_url: 'https://quotewise.io/originators/new?handle=test',
      },
      duplicate_check: newQuoteResult,
    });

    await flushPromises(30);

    expect(sendResponseOne).toHaveBeenCalledWith({ success: true });
    expect(sendResponseTwo).toHaveBeenCalledWith({ success: true });
    diagnostics = await getDiagnostics!();
    expect(diagnostics.events.filter((event: Record<string, unknown>) => (
      event.event === 'automatic_preflight_started' &&
      event.sourceUrl === 'https://x.com/test/status/123'
    ))).toHaveLength(1);
  });

  it('runs originator fallback on automatic preflight timeout without clearing to ready first', async () => {
    const handleMessage = jest.fn((message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          return Promise.resolve();
        }

        if (message.type === 'LOOKUP_ORIGINATOR_BY_HANDLE') {
          sendResponse({
            success: true,
            found: false,
            handle: 'test',
            platform: 'twitter',
            create_url: 'https://quotewise.io/originators/new?handle=test',
          });
        }

        return Promise.resolve();
      });
    mockServiceWorkerDependencies({ handleMessage });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });
    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
      success: true,
      data: tweetData,
    });

    await import('../../src/background/service-worker');

    const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await tabUpdateListener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

    const alarmName = (chrome.alarms.create as jest.Mock).mock.calls
      .map(call => call[0] as string)
      .find(name => name.startsWith('automatic-preflight-timeout:'));
    expect(alarmName).toEqual(expect.any(String));

    const alarmListener = (chrome.alarms.onAlarm.addListener as jest.Mock).mock.calls[0][0];
    const setBadgeTextCallCount = (chrome.action.setBadgeText as jest.Mock).mock.calls.length;
    await alarmListener({ name: alarmName });

    const setBadgeTextCallsAfterAlarm = (chrome.action.setBadgeText as jest.Mock).mock.calls
      .slice(setBadgeTextCallCount)
      .map(call => call[0]);
    expect(setBadgeTextCallsAfterAlarm).not.toContainEqual({ tabId: 22, text: '' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
      tabId: 22,
      title: 'Originator not in Quotewise — add them first',
    });
    expect(handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LOOKUP_ORIGINATOR_BY_HANDLE',
        data: expect.objectContaining({
          handle: 'test',
          platform: 'twitter',
          source_url: 'https://x.com/test/status/123',
        }),
      }),
      expect.any(Object),
      expect.any(Function),
    );

    const getDiagnostics = (globalThis as {
      __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
    }).__quotewiseDiagnostics;
    const diagnostics = await getDiagnostics!();
    expect(diagnostics.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'automatic_preflight_timeout',
        classification: 'combined_preflight_timeout',
      }),
      expect.objectContaining({
        event: 'automatic_preflight_timeout_fallback_started',
        classification: 'combined_preflight_timeout',
      }),
      expect.objectContaining({
        event: 'automatic_preflight_timeout_fallback_applied',
        classification: 'combined_preflight_timeout',
      }),
    ]));
  });

  it('uses an early automatic originator probe to show missing-originator before preflight timeout', async () => {
    jest.useFakeTimers();

    try {
      const handleMessage = jest.fn((message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          return Promise.resolve();
        }

        if (message.type === 'LOOKUP_ORIGINATOR_BY_HANDLE') {
          sendResponse({
            success: true,
            found: false,
            handle: 'test',
            platform: 'twitter',
            create_url: 'https://quotewise.io/originators/new?handle=test',
          });
        }

        return Promise.resolve();
      });
      mockServiceWorkerDependencies({ handleMessage });

      chrome.tabs.get = jest.fn().mockResolvedValue({
        id: 22,
        url: 'https://x.com/test/status/123',
      });
      chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
        success: true,
        data: tweetData,
      });

      await import('../../src/background/service-worker');

      const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
      await tabUpdateListener(22, { status: 'complete' }, {
        id: 22,
        url: 'https://x.com/test/status/123',
      });

      await flushPromises(8);
      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

      await jest.advanceTimersByTimeAsync(300);
      await flushPromises();

      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
        tabId: 22,
        color: '#E69F00',
      });
      expect(handleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOOKUP_ORIGINATOR_BY_HANDLE',
          data: expect.objectContaining({
            handle: 'test',
            platform: 'twitter',
            source_url: 'https://x.com/test/status/123',
          }),
        }),
        expect.any(Object),
        expect.any(Function),
      );

      const getDiagnostics = (globalThis as {
        __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
      }).__quotewiseDiagnostics;
      const diagnostics = await getDiagnostics!();
      expect(diagnostics.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'originator_probe_scheduled',
          trigger: 'automatic-preflight',
          tabId: 22,
          sourceUrl: 'https://x.com/test/status/123',
        }),
        expect.objectContaining({
          event: 'originator_probe_request_sent',
          trigger: 'automatic-preflight',
          operationId: expect.any(String),
        }),
        expect.objectContaining({
          event: 'originator_probe_response_received',
          trigger: 'automatic-preflight',
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({
          event: 'originator_probe_applied',
          reason: 'originator_probe_not_found',
        }),
      ]));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('does not send the early originator probe when combined preflight resolves before the probe delay', async () => {
    jest.useFakeTimers();

    try {
      const handleMessage = jest.fn((message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          sendResponse({
            success: true,
            originator: {
              found: false,
              handle: 'test',
              platform: 'twitter',
              create_url: 'https://quotewise.io/originators/new?handle=test',
            },
            duplicate_check: newQuoteResult,
          });
        }

        return Promise.resolve();
      });
      mockServiceWorkerDependencies({ handleMessage });

      chrome.tabs.get = jest.fn().mockResolvedValue({
        id: 22,
        url: 'https://x.com/test/status/123',
      });
      chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
        success: true,
        data: tweetData,
      });

      await import('../../src/background/service-worker');

      const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
      await tabUpdateListener(22, { status: 'complete' }, {
        id: 22,
        url: 'https://x.com/test/status/123',
      });

      await flushPromises(5);
      await jest.advanceTimersByTimeAsync(1_000);
      await flushPromises();

      expect(handleMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOOKUP_ORIGINATOR_BY_HANDLE',
        }),
        expect.any(Object),
        expect.any(Function),
      );

      const getDiagnostics = (globalThis as {
        __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
      }).__quotewiseDiagnostics;
      const diagnostics = await getDiagnostics!();
      expect(diagnostics.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'originator_probe_skipped',
          reason: 'preflight_completed_before_probe',
          classification: 'preflight_won_before_probe',
          sourceUrl: 'https://x.com/test/status/123',
        }),
      ]));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('classifies an early originator probe lookup timeout', async () => {
    jest.useFakeTimers();

    try {
      const handleMessage = jest.fn((message) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          return Promise.resolve();
        }

        if (message.type === 'LOOKUP_ORIGINATOR_BY_HANDLE') {
          return Promise.resolve();
        }

        return Promise.resolve();
      });
      mockServiceWorkerDependencies({ handleMessage });

      chrome.tabs.get = jest.fn().mockResolvedValue({
        id: 22,
        url: 'https://x.com/test/status/123',
      });
      chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
        success: true,
        data: tweetData,
      });

      await import('../../src/background/service-worker');

      const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
      await tabUpdateListener(22, { status: 'complete' }, {
        id: 22,
        url: 'https://x.com/test/status/123',
      });

      await flushPromises();
      await jest.advanceTimersByTimeAsync(300);
      await flushPromises();

      expect(handleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOOKUP_ORIGINATOR_BY_HANDLE',
          data: expect.objectContaining({
            handle: 'test',
            platform: 'twitter',
            source_url: 'https://x.com/test/status/123',
          }),
        }),
        expect.any(Object),
        expect.any(Function),
      );

      await jest.advanceTimersByTimeAsync(3_000);
      await flushPromises();

      const getDiagnostics = (globalThis as {
        __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
      }).__quotewiseDiagnostics;
      const diagnostics = await getDiagnostics!();
      expect(diagnostics.preflight).toEqual(expect.objectContaining({
        status: 'failed',
        trigger: 'automatic-originator-probe',
        reason: 'originator_probe_unsuccessful',
        classification: 'probe_lookup_timeout',
        operationId: expect.any(String),
      }));
      expect(diagnostics.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'originator_probe_response_received',
          classification: 'probe_lookup_timeout',
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({
          event: 'originator_probe_failed',
          reason: 'originator_probe_lookup_timeout',
          classification: 'probe_lookup_timeout',
        }),
      ]));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('keeps automatic Loading when the early originator probe finds an originator before duplicate status is known', async () => {
    jest.useFakeTimers();

    try {
      mockServiceWorkerDependencies({
        handleMessage: jest.fn((message, _sender, sendResponse) => {
          if (message.type === 'PREFLIGHT_CHECK') {
            return Promise.resolve();
          }

          if (message.type === 'LOOKUP_ORIGINATOR_BY_HANDLE') {
            sendResponse({
              success: true,
              found: true,
              handle: 'test',
              platform: 'twitter',
              originator: {
                id: 1,
                unique_id: 'test-user',
                full_name: 'Test User',
                sort_name_display: 'Test User',
                confidence: 1,
              },
            });
          }

          return Promise.resolve();
        }),
      });

      chrome.tabs.get = jest.fn().mockResolvedValue({
        id: 22,
        url: 'https://x.com/test/status/123',
      });
      chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
        success: true,
        data: tweetData,
      });

      await import('../../src/background/service-worker');

      const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
      await tabUpdateListener(22, { status: 'complete' }, {
        id: 22,
        url: 'https://x.com/test/status/123',
      });

      await flushPromises(8);
      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

      await jest.advanceTimersByTimeAsync(300);
      await flushPromises();

      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        preloadedOriginator: {
          handle: 'test',
          originator: {
            id: 1,
            full_name: 'Test User',
            unique_id: 'test-user',
            sort_name_display: 'Test User',
            confidence: 1,
          },
          timestamp: expect.any(Number),
        },
      });
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('ignores an early originator probe response after navigating to a different tweet', async () => {
    jest.useFakeTimers();

    try {
      let completeLookup!: (response: Record<string, unknown>) => void;
      mockServiceWorkerDependencies({
        handleMessage: jest.fn((message, _sender, sendResponse) => {
          if (message.type === 'PREFLIGHT_CHECK') {
            return Promise.resolve();
          }

          if (message.type === 'LOOKUP_ORIGINATOR_BY_HANDLE') {
            completeLookup = sendResponse;
          }

          return Promise.resolve();
        }),
      });

      let currentUrl = 'https://x.com/test/status/123';
      chrome.tabs.get = jest.fn().mockImplementation(() => Promise.resolve({
        id: 22,
        url: currentUrl,
      }));
      chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
        success: true,
        data: tweetData,
      });

      await import('../../src/background/service-worker');

      const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
      await tabUpdateListener(22, { status: 'complete' }, {
        id: 22,
        url: 'https://x.com/test/status/123',
      });

      await flushPromises(8);
      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

      await jest.advanceTimersByTimeAsync(300);
      await flushPromises();
      expect(completeLookup).toEqual(expect.any(Function));

      currentUrl = 'https://x.com/other/status/456';
      completeLookup({
        success: true,
        found: false,
        handle: 'test',
        platform: 'twitter',
        create_url: 'https://quotewise.io/originators/new?handle=test',
      });

      await flushPromises();

      expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 22, text: '@' });
      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

      const getDiagnostics = (globalThis as {
        __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
      }).__quotewiseDiagnostics;
      expect(await getDiagnostics!()).toEqual(expect.objectContaining({
        preflight: expect.objectContaining({
          status: 'skipped',
          trigger: 'automatic-originator-probe',
          reason: 'stale_originator_probe_response',
          classification: 'probe_stale_after_navigation',
          url: 'https://x.com/test/status/123',
        }),
        events: expect.arrayContaining([
          expect.objectContaining({
            event: 'originator_probe_skipped',
            reason: 'stale_originator_probe_response',
            classification: 'probe_stale_after_navigation',
          }),
        ]),
      }));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('clears timeout fallback loading when the originator fallback does not answer', async () => {
    jest.useFakeTimers();

    try {
      mockServiceWorkerDependencies({
        handleMessage: jest.fn((message) => {
          if (message.type === 'PREFLIGHT_CHECK') {
            return Promise.resolve();
          }
          return Promise.resolve();
        }),
      });

      chrome.tabs.get = jest.fn().mockResolvedValue({
        id: 22,
        url: 'https://x.com/test/status/123',
      });
      chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
        success: true,
        data: tweetData,
      });

      await import('../../src/background/service-worker');

      const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
      await tabUpdateListener(22, { status: 'complete' }, {
        id: 22,
        url: 'https://x.com/test/status/123',
      });

      await flushPromises(8);

      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

      const alarmName = (chrome.alarms.create as jest.Mock).mock.calls
        .map(call => call[0] as string)
        .find(name => name.startsWith('automatic-preflight-timeout:'));
      const alarmListener = (chrome.alarms.onAlarm.addListener as jest.Mock).mock.calls[0][0];
      const alarmPromise = alarmListener({ name: alarmName });

      await Promise.resolve();
      await Promise.resolve();

      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

      await jest.advanceTimersByTimeAsync(4_000);
      await alarmPromise;

      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '' });
      expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
        tabId: 22,
        title: 'Quotewise — ready to capture',
      });
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('accepts a late automatic preflight response after timeout when the tab still shows the same tweet', async () => {
    let completePreflight!: (response: Record<string, unknown>) => void;
    mockServiceWorkerDependencies({
      handleMessage: jest.fn((message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          completePreflight = sendResponse;
        }
        if (message.type === 'LOOKUP_ORIGINATOR_BY_HANDLE') {
          sendResponse({
            success: true,
            found: true,
            handle: 'test',
            platform: 'twitter',
            originator: {
              id: 1,
              unique_id: 'test-user',
              full_name: 'Test User',
              sort_name_display: 'Test User',
              confidence: 1,
            },
          });
        }
        return Promise.resolve();
      }),
    });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });
    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
      success: true,
      data: tweetData,
    });

    await import('../../src/background/service-worker');

    const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await tabUpdateListener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const alarmName = (chrome.alarms.create as jest.Mock).mock.calls
      .map(call => call[0] as string)
      .find(name => name.startsWith('automatic-preflight-timeout:'));
    const alarmListener = (chrome.alarms.onAlarm.addListener as jest.Mock).mock.calls[0][0];
    await alarmListener({ name: alarmName });

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '' });

    completePreflight({
      success: true,
      originator: {
        found: false,
        handle: 'test',
        platform: 'twitter',
        create_url: 'https://quotewise.io/originators/new?handle=test',
      },
      duplicate_check: newQuoteResult,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
  });

  it('ignores a late automatic preflight response for a different current tweet', async () => {
    let completePreflight!: (response: Record<string, unknown>) => void;
    mockServiceWorkerDependencies({
      handleMessage: jest.fn((message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          completePreflight = sendResponse;
        }
        return Promise.resolve();
      }),
    });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/replier/status/222',
    });
    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
      success: true,
      data: tweetData,
    });

    await import('../../src/background/service-worker');

    const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await tabUpdateListener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    completePreflight({
      success: true,
      originator: {
        found: true,
        originator: {
          id: 1,
          full_name: 'Test User',
          slug: 'test-user',
        },
      },
      duplicate_check: duplicateResult,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).not.toHaveBeenLastCalledWith({ tabId: 22, text: '=' });

    const getDiagnostics = (globalThis as {
      __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
    }).__quotewiseDiagnostics;
    expect(await getDiagnostics!()).toEqual(expect.objectContaining({
      preflight: expect.objectContaining({
        status: 'skipped',
        reason: 'stale_preflight_result',
        url: 'https://x.com/test/status/123',
      }),
    }));
  });

  it('lets tray originator status supersede a pending automatic preflight for the same tweet', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn((message) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          return Promise.resolve();
        }
        return Promise.resolve();
      }),
    });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });
    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
      success: true,
      data: tweetData,
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await tabUpdateListener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();
    runtimeListener(
      {
        type: MessageType.ORIGINATOR_LOOKUP_STATUS,
        data: {
          handle: 'test',
          platform: 'twitter',
          source_url: 'https://x.com/test/status/123',
          found: false,
          create_url: 'https://quotewise.io/originators/new?handle=test',
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
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });

    const alarmName = (chrome.alarms.create as jest.Mock).mock.calls
      .map(call => call[0] as string)
      .find(name => name.startsWith('automatic-preflight-timeout:'));
    const alarmListener = (chrome.alarms.onAlarm.addListener as jest.Mock).mock.calls[0][0];
    await alarmListener({ name: alarmName });

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
  });

  it('clears an expired persisted automatic preflight loading state on startup', async () => {
    const startedAt = Date.now() - 9_000;
    const timeoutAt = Date.now() - 1_000;
    const { AuthState } = await import('../../src/auth/auth-state-machine');
    mockServiceWorkerDependencies({ authState: AuthState.AUTHENTICATED });

    chrome.storage.session.get = jest.fn().mockResolvedValue({
      automaticPreflightOperations: [
        {
          tabId: 22,
          url: 'https://x.com/test/status/123',
          statusId: '123',
          operationId: 'persisted-timeout',
          trigger: 'automatic-preflight',
          startedAt,
          timeoutAt,
        },
      ],
    });
    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await import('../../src/background/service-worker');

    const startupListener = (chrome.runtime.onStartup.addListener as jest.Mock).mock.calls[0][0];
    await startupListener();

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '' });
    expect(chrome.storage.session.set).toHaveBeenLastCalledWith({
      automaticPreflightOperations: [],
    });
  });

  it('retries automatic extraction when tweet data is not ready on initial navigation', async () => {
    jest.useFakeTimers();

    try {
      mockServiceWorkerDependencies({
        handleMessage: jest.fn(async (message, _sender, sendResponse) => {
          if (message.type === 'PREFLIGHT_CHECK') {
            sendResponse({
              success: true,
              originator: {
                found: false,
                handle: 'test',
                platform: 'twitter',
                create_url: 'https://quotewise.io/originators/new?handle=test',
              },
              duplicate_check: newQuoteResult,
            });
          }
        }),
      });

      chrome.tabs.get = jest.fn().mockResolvedValue({
        id: 22,
        url: 'https://x.com/test/status/123?mx=2',
      });
      chrome.tabs.sendMessage = jest.fn()
        .mockResolvedValueOnce({
          success: false,
          error: 'No tweet data available on this page.',
        })
        .mockResolvedValueOnce({
          success: true,
          data: tweetData,
        });

      await import('../../src/background/service-worker');

      const listener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
      await listener(22, { status: 'complete' }, {
        id: 22,
        url: 'https://x.com/test/status/123',
      });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);

      const getDiagnostics = (globalThis as {
        __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
      }).__quotewiseDiagnostics;
      expect(await getDiagnostics!()).toEqual(expect.objectContaining({
        extraction: expect.objectContaining({
          status: 'no_data',
          tabId: 22,
          url: 'https://x.com/test/status/123',
          classification: 'extraction_retry_before_preflight',
          retryAfterMs: 1000,
        }),
        events: expect.arrayContaining([
          expect.objectContaining({
            event: 'extraction_retry_scheduled',
            classification: 'extraction_retry_before_preflight',
            retryAfterMs: 1000,
          }),
        ]),
      }));

      await jest.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(chrome.tabs.get).toHaveBeenCalledWith(22);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
        tabId: 22,
        color: '#E69F00',
      });
      expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
        tabId: 22,
        title: 'Originator not in Quotewise — add them first',
      });
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('uses a tray handle lookup not-found response to replace the loading badge immediately', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          return;
        }

        if (message.type === 'LOOKUP_ORIGINATOR_BY_HANDLE') {
          sendResponse({
            success: true,
            found: false,
            handle: 'test',
            platform: 'twitter',
            create_url: 'https://quotewise.io/originators/new?handle=test',
          });
        }
      }),
    });

    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
      success: true,
      data: tweetData,
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await tabUpdateListener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();
    runtimeListener(
      {
        type: MessageType.LOOKUP_ORIGINATOR_BY_HANDLE,
        data: {
          handle: 'test',
          platform: 'twitter',
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
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      found: false,
    }));
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      preloadedOriginator: {
        handle: 'test',
        originator: null,
        create_url: 'https://quotewise.io/originators/new?handle=test',
        url: 'https://x.com/test/status/123',
        timestamp: expect.any(Number),
      },
    });
  });

  it('shows the loading badge while a tray handle lookup is in flight', async () => {
    let resolveLookup!: () => void;
    mockServiceWorkerDependencies({
      handleMessage: jest.fn((message, _sender, sendResponse) => {
        if (message.type !== 'LOOKUP_ORIGINATOR_BY_HANDLE') {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          resolveLookup = () => {
            sendResponse({
              success: true,
              found: false,
              handle: 'test',
              platform: 'twitter',
              create_url: 'https://quotewise.io/originators/new?handle=test',
            });
            resolve();
          };
        });
      }),
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();
    runtimeListener(
      {
        type: MessageType.LOOKUP_ORIGINATOR_BY_HANDLE,
        data: {
          handle: 'test',
          platform: 'twitter',
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

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '●' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#56B4E9',
    });

    resolveLookup();

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      found: false,
    }));
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
  });

  it('uses a tray preloaded not-found status message to update the toolbar immediately', async () => {
    mockServiceWorkerDependencies();

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();
    runtimeListener(
      {
        type: MessageType.ORIGINATOR_LOOKUP_STATUS,
        data: {
          handle: 'test',
          platform: 'twitter',
          source_url: 'https://x.com/test/status/123',
          found: false,
          create_url: 'https://quotewise.io/originators/new?handle=test',
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
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
  });

  it('keeps the missing-originator badge when an unscoped duplicate check answers new_quote', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (_message, _sender, sendResponse) => {
        sendResponse({
          success: true,
          result: newQuoteResult,
          ...newQuoteResult,
        });
      }),
    });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];

    // At rest: the tray's originator lookup reported not-found → @ badge.
    runtimeListener(
      {
        type: MessageType.ORIGINATOR_LOOKUP_STATUS,
        data: {
          handle: 'test',
          platform: 'twitter',
          source_url: 'https://x.com/test/status/123',
          found: false,
          create_url: 'https://quotewise.io/originators/new?handle=test',
        },
      },
      { tab: { id: 22, url: 'https://x.com/test/status/123' } },
      jest.fn(),
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });

    // Tray open: the ADR-0009 no-originator check (no originator_slug) proves
    // nothing about the originator, so its new_quote answer must not flip the
    // badge from @ to ★.
    const sendResponse = jest.fn();
    runtimeListener(
      {
        type: MessageType.CHECK_DUPLICATE,
        data: {
          text: 'Test quote',
          source_url: 'https://x.com/test/status/123',
          social_handle: 'test',
        },
      },
      { tab: { id: 22, url: 'https://x.com/test/status/123' } },
      sendResponse,
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
  });

  it('ignores a tray originator status message after navigating away from the source tweet', async () => {
    mockServiceWorkerDependencies();

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/other/status/456',
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();
    runtimeListener(
      {
        type: MessageType.ORIGINATOR_LOOKUP_STATUS,
        data: {
          handle: 'test',
          platform: 'twitter',
          source_url: 'https://x.com/test/status/123',
          found: false,
          create_url: 'https://quotewise.io/originators/new?handle=test',
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
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 22, text: '@' });

    const getDiagnostics = (globalThis as {
      __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
    }).__quotewiseDiagnostics;
    expect(await getDiagnostics!()).toEqual(expect.objectContaining({
      preflight: expect.objectContaining({
        status: 'skipped',
        trigger: 'originator-lookup',
        reason: 'stale_originator_lookup_response',
        url: 'https://x.com/test/status/123',
      }),
    }));
  });

  it('ignores an explicit duplicate-check response after navigating away from the source tweet', async () => {
    let completeDuplicateCheck!: (response: Record<string, unknown>) => void;
    mockServiceWorkerDependencies({
      handleMessage: jest.fn((_message, _sender, sendResponse) => {
        completeDuplicateCheck = sendResponse;
        return Promise.resolve();
      }),
    });

    chrome.tabs.get = jest.fn().mockResolvedValue({
      id: 22,
      url: 'https://x.com/other/status/456',
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const runtimeListener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();
    runtimeListener(
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
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 22, text: '●' });

    completeDuplicateCheck({
      success: true,
      result: duplicateResult,
      ...duplicateResult,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      result: duplicateResult,
    }));
    expect(chrome.action.setBadgeText).not.toHaveBeenLastCalledWith({ tabId: 22, text: '=' });

    const getDiagnostics = (globalThis as {
      __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
    }).__quotewiseDiagnostics;
    expect(await getDiagnostics!()).toEqual(expect.objectContaining({
      preflight: expect.objectContaining({
        status: 'skipped',
        trigger: 'explicit-duplicate-check',
        reason: 'stale_duplicate_check_response',
        url: 'https://x.com/test/status/123',
      }),
    }));
  });

  it('does not process stale parent tweet data for a reply URL during SPA navigation', async () => {
    jest.useFakeTimers();
    const handleMessage = jest.fn();

    try {
      mockServiceWorkerDependencies({
        handleMessage,
      });

      chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
        success: true,
        data: parentTweetData,
      });

      await import('../../src/background/service-worker');

      const startupListener = (chrome.runtime.onStartup.addListener as jest.Mock).mock.calls[0][0];
      await startupListener();
      await flushPromises(10);

      const listener = (chrome.webNavigation.onHistoryStateUpdated.addListener as jest.Mock).mock.calls[0][0];
      await listener({
        frameId: 0,
        tabId: 22,
        url: 'https://x.com/replier/status/222',
      });

      await flushPromises(10);

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(22, {
        type: 'EXTRACT_POST_DATA',
      });
      expect(handleMessage).not.toHaveBeenCalled();
      expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 22, text: '★' });

      const getDiagnostics = (globalThis as {
        __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
      }).__quotewiseDiagnostics;
      expect(await getDiagnostics!()).toEqual(expect.objectContaining({
        extraction: expect.objectContaining({
          status: 'no_data',
          tabId: 22,
          url: 'https://x.com/replier/status/222',
          reason: 'stale_tweet_data',
          retryAfterMs: 1000,
        }),
      }));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('classifies stale parent extraction retry before preflight starts for a reply URL', async () => {
    jest.useFakeTimers();

    try {
      const handleMessage = jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          sendResponse({
            success: true,
            originator: {
              found: true,
              handle: 'replier',
              platform: 'twitter',
              originator: {
                id: 2,
                full_name: 'Reply User',
                slug: 'reply-user',
              },
            },
            duplicate_check: newQuoteResult,
          });
        }
      });
      mockServiceWorkerDependencies({ handleMessage });

      chrome.tabs.get = jest.fn().mockResolvedValue({
        id: 22,
        url: 'https://x.com/replier/status/222',
      });
      chrome.tabs.sendMessage = jest.fn()
        .mockResolvedValueOnce({
          success: true,
          data: parentTweetData,
        })
        .mockResolvedValueOnce({
          success: true,
          data: replyTweetData,
        });

      await import('../../src/background/service-worker');

      const startupListener = (chrome.runtime.onStartup.addListener as jest.Mock).mock.calls[0][0];
      await startupListener();
      await flushPromises(10);

      const listener = (chrome.webNavigation.onHistoryStateUpdated.addListener as jest.Mock).mock.calls[0][0];
      await listener({
        frameId: 0,
        tabId: 22,
        url: 'https://x.com/replier/status/222',
      });

      await flushPromises(10);

      expect(handleMessage).not.toHaveBeenCalled();

      const getDiagnostics = (globalThis as {
        __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
      }).__quotewiseDiagnostics;
      expect(await getDiagnostics!()).toEqual(expect.objectContaining({
        extraction: expect.objectContaining({
          status: 'no_data',
          tabId: 22,
          url: 'https://x.com/replier/status/222',
          reason: 'stale_tweet_data',
          classification: 'extraction_retry_before_preflight',
          retryAfterMs: 1000,
        }),
        events: expect.arrayContaining([
          expect.objectContaining({
            event: 'extraction_retry_scheduled',
            sourceUrl: 'https://x.com/replier/status/222',
            classification: 'extraction_retry_before_preflight',
            retryAfterMs: 1000,
          }),
        ]),
      }));

      await jest.advanceTimersByTimeAsync(1_000);
      await flushPromises(8);

      expect(handleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PREFLIGHT_CHECK',
          data: expect.objectContaining({
            handle: 'replier',
            platform: 'twitter',
            source_url: 'https://x.com/replier/status/222',
          }),
        }),
        expect.any(Object),
        expect.any(Function),
      );

      const diagnostics = await getDiagnostics!();
      expect(diagnostics.preflight).toEqual(expect.objectContaining({
        status: 'succeeded',
        trigger: 'automatic-preflight',
        handle: 'replier',
        url: 'https://x.com/replier/status/222',
        operationId: expect.any(String),
      }));
      expect(diagnostics.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'valid_tweet_data_accepted',
          sourceUrl: 'https://x.com/replier/status/222',
          statusId: '222',
          handle: 'replier',
        }),
        expect.objectContaining({
          event: 'automatic_preflight_started',
          sourceUrl: 'https://x.com/replier/status/222',
          handle: 'replier',
          operationId: expect.any(String),
        }),
      ]));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('renders a terminal missing-originator badge and caches not-found preflight data', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          sendResponse({
            success: true,
            originator: {
              found: false,
              handle: 'test',
              platform: 'twitter',
              create_url: 'https://quotewise.io/originators/new?handle=test',
            },
            duplicate_check: newQuoteResult,
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

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 22, text: '●' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
      tabId: 22,
      title: 'Originator not in Quotewise — add them first',
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      preloadedOriginator: {
        handle: 'test',
        originator: null,
        create_url: 'https://quotewise.io/originators/new?handle=test',
        url: 'https://x.com/test/status/123',
        timestamp: expect.any(Number),
      },
    });
  });

  it('treats a preflight originator without a slug as unresolved instead of new quote', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          sendResponse({
            success: true,
            originator: {
              found: true,
              handle: 'test',
              platform: 'twitter',
              originator: {
                id: 42,
                full_name: 'Test User',
              },
            },
            duplicate_check: newQuoteResult,
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

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 22, text: '●' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '@' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#E69F00',
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      preloadedOriginator: {
        handle: 'test',
        originator: null,
        create_url: 'http://quotewise.test:8000/originators/add/?suggested_handle=test&platform=twitter',
        url: 'https://x.com/test/status/123',
        timestamp: expect.any(Number),
      },
    });
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
          isPostPage: true,
        }),
        activeTabState: expect.objectContaining({
          tabId: 22,
          isPostPage: true,
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

  it('omits the detailed event trail outside debug mode', async () => {
    chrome.runtime.getManifest = jest.fn(() => ({
      manifest_version: 3,
      name: 'Quotewise',
      version: '1.4.30',
    }));
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          sendResponse({
            success: true,
            originator: {
              found: false,
              handle: 'test',
              platform: 'twitter',
              create_url: 'https://quotewise.io/originators/new?handle=test',
            },
            duplicate_check: newQuoteResult,
          });
        }
      }),
    });

    chrome.tabs.sendMessage = jest.fn().mockResolvedValue({
      success: true,
      data: tweetData,
    });

    await import('../../src/background/service-worker');

    const tabUpdateListener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await tabUpdateListener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/test/status/123',
    });

    await flushPromises(20);

    const getDiagnostics = (globalThis as {
      __quotewiseDiagnostics?: () => Promise<Record<string, any>>;
    }).__quotewiseDiagnostics;
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
    }));
    expect(diagnostics.events).toEqual([]);
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
      color: '#009E73',
    });
  });

  it('keeps a cached new-quote star visible while automatic preflight revalidates', async () => {
    jest.useFakeTimers();

    try {
      mockServiceWorkerDependencies({
        handleMessage: jest.fn((message) => {
          if (message.type === 'PREFLIGHT_CHECK') {
            return Promise.resolve();
          }
          return Promise.resolve();
        }),
      });

      chrome.storage.local.get = jest.fn().mockResolvedValue({
        preloadedDuplicateCheck: {
          url: 'https://x.com/test/status/123',
          result: newQuoteResult,
          timestamp: Date.now(),
        },
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

      await flushPromises(20);

      expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 22, text: '●' });
      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '★' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
        tabId: 22,
        color: '#0072B2',
      });
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('keeps a cached new-quote star visible during an explicit overlay re-check (qw-togyr)', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (_message, _sender, sendResponse) => {
        sendResponse({
          success: true,
          result: newQuoteResult,
          ...newQuoteResult,
        });
      }),
    });

    chrome.storage.local.get = jest.fn().mockResolvedValue({
      preloadedDuplicateCheck: {
        url: 'https://x.com/test/status/123',
        result: newQuoteResult,
        timestamp: Date.now(),
      },
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
      { tab: { id: 22, url: 'https://x.com/test/status/123' } },
      sendResponse,
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    // The explicit re-check must NOT flash Loading (●) over an already-resolved star.
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 22, text: '●' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '★' });
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
      color: '#009E73',
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
      path: greyIconPaths,
    });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('renders authenticated unsupported sites as grey unavailable and clears any badge', async () => {
    mockServiceWorkerDependencies();

    await import('../../src/background/service-worker');

    const listener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await listener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://example.com/article',
    });

    expect(chrome.action.setIcon).toHaveBeenLastCalledWith({
      tabId: 22,
      path: greyIconPaths,
    });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '' });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
      tabId: 22,
      title: 'Quotewise — capture works on X, Threads, Bluesky & Substack Notes',
    });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('renders authenticated X/Twitter non-tweet pages as full-color supported idle', async () => {
    mockServiceWorkerDependencies();

    await import('../../src/background/service-worker');

    const listener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    await listener(22, { status: 'complete' }, {
      id: 22,
      url: 'https://x.com/home',
    });

    expect(chrome.action.setIcon).toHaveBeenLastCalledWith({
      tabId: 22,
      path: colorIconPaths,
    });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '' });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
      tabId: 22,
      title: 'Quotewise — open a post to capture',
    });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('replaces the tweet icon with session-expired status when automatic preflight requires auth', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (message, _sender, sendResponse) => {
        if (message.type === 'PREFLIGHT_CHECK') {
          sendResponse({
            success: false,
            authRequired: true,
            authFailureType: 'session_expired',
            error: 'Authentication required',
            originator: { found: false },
            duplicate_check: newQuoteResult,
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
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '!' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#D55E00',
    });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
      tabId: 22,
      title: 'Quotewise — session expired, log in again',
    });
  });

  it('replaces the sender tab icon when a tray duplicate check requires auth', async () => {
    mockServiceWorkerDependencies({
      handleMessage: jest.fn(async (_message, _sender, sendResponse) => {
        sendResponse({
          success: false,
          authRequired: true,
          authFailureType: 'session_expired',
          error: 'Authentication required',
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
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      authRequired: true,
    }));
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 22, text: '!' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId: 22,
      color: '#D55E00',
    });
  });
});
