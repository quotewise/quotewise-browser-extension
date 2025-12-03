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
    getManifest: jest.fn(() => ({
      name: 'Quotewise [DEV]',
      version: '1.1.1'
    }))
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  },
  tabs: {
    create: jest.fn(),
    get: jest.fn(),
    sendMessage: jest.fn(),
    onUpdated: {
      addListener: jest.fn()
    }
  },
  action: {
    setIcon: jest.fn(),
    setTitle: jest.fn(),
    onClicked: {
      addListener: jest.fn()
    }
  },
  alarms: {
    create: jest.fn(),
    onAlarm: {
      addListener: jest.fn()
    }
  }
};

// Add Chrome to global scope
(global as any).chrome = mockChrome;

// Mock fetch for API calls
global.fetch = jest.fn();

// Mock DOM APIs that might be used in content scripts
// JSDOM provides its own location mock, so we don't need to override it

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