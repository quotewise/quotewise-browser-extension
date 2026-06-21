async function flushPromises(count = 3): Promise<void> {
  for (let index = 0; index < count; index++) {
    await Promise.resolve();
  }
}

function resetChromeMocks(): void {
  jest.clearAllMocks();
  chrome.runtime.getManifest = jest.fn(() => ({
    manifest_version: 3,
    name: 'Quotewise',
    version: '1.6.1',
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
  chrome.tabs.create = jest.fn().mockResolvedValue({ id: 44 });
  chrome.action.setIcon = jest.fn().mockResolvedValue(undefined);
  chrome.action.setTitle = jest.fn().mockResolvedValue(undefined);
  chrome.action.setBadgeText = jest.fn().mockResolvedValue(undefined);
  chrome.action.setBadgeBackgroundColor = jest.fn().mockResolvedValue(undefined);
  chrome.action.setBadgeTextColor = jest.fn().mockResolvedValue(undefined);
  chrome.alarms.create = jest.fn();
  chrome.alarms.clear = jest.fn().mockResolvedValue(true);
}

function mockServiceWorkerDependencies(): void {
  jest.doMock('../../src/background/api-handler', () => ({
    initializeApiHandler: jest.fn(() => ({
      handleMessage: jest.fn(),
    })),
  }));

  jest.doMock('../../src/background/auth-monitor', () => ({
    AuthenticationMonitor: jest.fn(),
  }));

  jest.doMock('../../src/background/storage-cleanup', () => ({
    initializeStorageCleanup: jest.fn(() => ({
      startPeriodicCleanup: jest.fn(),
      runCleanup: jest.fn().mockResolvedValue(undefined),
      getStorageStats: jest.fn().mockResolvedValue({}),
    })),
  }));

  jest.doMock('../../src/background/icon-applicator', () => ({
    applyIconPresentation: jest.fn().mockResolvedValue(undefined),
    getIconApplicatorDiagnostics: jest.fn(() => ({})),
    resetIconToDefault: jest.fn().mockResolvedValue(undefined),
  }));

  jest.doMock('../../src/auth/auth-state-manager', () => ({
    initializeAuthStateManager: jest.fn().mockResolvedValue({
      getState: jest.fn(() => 'unauthenticated'),
      getStateData: jest.fn(() => ({ state: 'unauthenticated' })),
      isAuthenticated: jest.fn(() => false),
      startAuthenticating: jest.fn(),
      onAuthSuccess: jest.fn(),
      onAuthFailure: jest.fn(),
      onLogout: jest.fn(),
      onTokenRefreshed: jest.fn(),
      onTokenRefreshFailed: jest.fn(),
    }),
    setAuthPresentationUpdater: jest.fn(),
  }));

  jest.doMock('../../src/auth/token-refresh', () => ({
    initializeTokenRefresh: jest.fn().mockResolvedValue(undefined),
    handleTokenRefreshAlarm: jest.fn(),
  }));

  jest.doMock('../../src/auth/auth-flow', () => ({
    initiateOAuthFlow: jest.fn(),
    logout: jest.fn(),
  }));
}

describe('feedback link background handler', () => {
  beforeEach(() => {
    jest.resetModules();
    resetChromeMocks();
    mockServiceWorkerDependencies();
  });

  it('opens the shared feedback destination in a new tab', async () => {
    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();

    listener({ type: MessageType.OPEN_FEEDBACK_PAGE }, {}, sendResponse);
    await flushPromises();

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://quotewise.io/feedback/?src=chrome-ext&v=1.6.1&platform=twitter',
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('returns a non-blocking failure response when Chrome refuses to open feedback', async () => {
    chrome.tabs.create = jest.fn().mockRejectedValue(new Error('Tabs unavailable'));

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();

    listener({ type: MessageType.OPEN_FEEDBACK_PAGE }, {}, sendResponse);
    await flushPromises();

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Tabs unavailable',
    });
  });

  it('ignores sender tab, message data, and stored capture-like values when opening feedback', async () => {
    chrome.storage.local.get = jest.fn().mockResolvedValue({
      currentTweet: {
        data: {
          text: 'Sensitive quote text',
          author: { username: 'person', displayName: 'Person' },
          url: 'https://x.com/person/status/123',
        },
      },
    });

    const { MessageType } = await import('../../src/types/chrome');
    await import('../../src/background/service-worker');

    const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
    const sendResponse = jest.fn();

    listener(
      {
        type: MessageType.OPEN_FEEDBACK_PAGE,
        data: {
          quoteText: 'Sensitive quote text',
          selectedText: 'Sensitive selection',
          sourceUrl: 'https://x.com/person/status/123',
          handle: 'person',
          username: 'chris',
          collectionName: 'Private collection',
          token: 'secret-token',
        },
      },
      {
        tab: {
          id: 12,
          url: 'https://x.com/person/status/123',
        },
      },
      sendResponse,
    );
    await flushPromises();

    const [{ url }] = (chrome.tabs.create as jest.Mock).mock.calls[0];
    expect(url).toBe('https://quotewise.io/feedback/?src=chrome-ext&v=1.6.1&platform=twitter');
    expect(url).not.toContain('Sensitive');
    expect(url).not.toContain('x.com');
    expect(url).not.toContain('person');
    expect(url).not.toContain('chris');
    expect(url).not.toContain('Private');
    expect(url).not.toContain('secret');
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });
});
