/**
 * Jest test setup for Chrome extension
 */


// Mock Chrome APIs
const mockChrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    },
    lastError: null,
    onInstalled: {
      addListener: jest.fn()
    },
    onStartup: {
      addListener: jest.fn()
    },
    getManifest: jest.fn(() => ({
      name: 'Quotewise [DEV]',
      version: '1.3.0'
    })),
    id: 'test-extension-id'
  },
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined)
    },
    session: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined)
    }
  },
  tabs: {
    create: jest.fn(),
    get: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn(),
    onActivated: {
      addListener: jest.fn()
    },
    onRemoved: {
      addListener: jest.fn()
    },
    onUpdated: {
      addListener: jest.fn()
    }
  },
  action: {
    setIcon: jest.fn().mockResolvedValue(undefined),
    setTitle: jest.fn().mockResolvedValue(undefined),
    setBadgeText: jest.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: jest.fn().mockResolvedValue(undefined),
    setBadgeTextColor: jest.fn().mockResolvedValue(undefined),
    getBadgeText: jest.fn().mockResolvedValue(''),
    openPopup: jest.fn().mockResolvedValue(undefined),
    onClicked: {
      addListener: jest.fn()
    }
  },
  webNavigation: {
    onHistoryStateUpdated: {
      addListener: jest.fn()
    }
  },
  scripting: {
    executeScript: jest.fn().mockResolvedValue(undefined)
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn().mockResolvedValue(true),
    onAlarm: {
      addListener: jest.fn()
    }
  },
  identity: {
    launchWebAuthFlow: jest.fn()
  }
};

// Add Chrome to global scope
(global as any).chrome = mockChrome;

// Mock fetch for API calls
global.fetch = jest.fn();

// Mock DOM APIs that might be used in content scripts
// Note: JSDOM's window.location is non-configurable, so tests that need
// to verify URL-dependent behavior should use function parameters instead

// Mock MutationObserver
global.MutationObserver = class MutationObserver {
  constructor(callback: MutationCallback) {}
  disconnect() {}
  observe(element: Element, initObject?: MutationObserverInit): void {}
  takeRecords(): MutationRecord[] { return []; }
};

// Console setup for tests
console.log = jest.fn();
console.error = jest.fn();
console.warn = jest.fn();
