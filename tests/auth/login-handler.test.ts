/**
 * Unit tests for LoginHandler
 * Tests login redirect flow and tab management
 */

import { LoginHandler } from '../../src/auth/login-handler';

// Mock Chrome APIs
const mockChrome = {
  tabs: {
    create: jest.fn(),
    get: jest.fn(),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  runtime: {
    lastError: null as any
  }
};

(global as any).chrome = mockChrome;

// Mock environment detection
jest.mock('../../src/config/environment', () => ({
  detectEnvironment: jest.fn(() => 'development'),
  getEnvironmentConfig: jest.fn(() => ({
    apiBaseUrl: 'http://localhost:8001',
    sessionCookieName: 'sessionid',
    secure: false
  }))
}));

// Get references to the mocked functions
const { detectEnvironment: mockDetectEnvironment, getEnvironmentConfig: mockGetEnvironmentConfig } = 
  require('../../src/config/environment');

describe('LoginHandler', () => {
  let loginHandler: LoginHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDetectEnvironment.mockReturnValue('development');
    mockGetEnvironmentConfig.mockReturnValue({
      apiBaseUrl: 'http://localhost:8001',
      sessionCookieName: 'sessionid',
      secure: false
    });
    loginHandler = new LoginHandler('development');
    mockChrome.runtime.lastError = null;
  });

  describe('initialization', () => {
    test('creates handler with correct environment configuration', () => {
      expect(loginHandler.getLoginUrl()).toBe('http://localhost:8001/accounts/login/');
      expect(loginHandler.getRedirectUrl()).toBe('http://localhost:8001/');
    });

    test('creates handler with staging environment', () => {
      // Mock the staging config return
      mockGetEnvironmentConfig.mockReturnValueOnce({
        apiBaseUrl: 'https://staging.quotosaurus.com',
        sessionCookieName: 'stagingsessionid',
        secure: true
      });
      
      const stagingHandler = new LoginHandler('staging');
      
      expect(stagingHandler.getLoginUrl()).toBe('https://staging.quotosaurus.com/accounts/login/');
      expect(stagingHandler.getRedirectUrl()).toBe('https://staging.quotosaurus.com/');
    });
  });

  describe('openLoginPage', () => {
    test('successfully opens login tab', async () => {
      const mockTab = { id: 123, url: 'http://localhost:8001/accounts/login/' };
      
      // Mock successful tab creation and immediate redirect
      mockChrome.tabs.create.mockImplementation((createInfo, callback) => {
        callback(mockTab);
      });

      // Mock tab update listener to simulate immediate success redirect
      mockChrome.tabs.onUpdated.addListener.mockImplementation((listener) => {
        // Simulate tab update with successful redirect
        setTimeout(() => {
          listener(123, { status: 'complete' }, { 
            id: 123, 
            url: 'http://localhost:8001/' 
          });
        }, 10);
      });

      const openPromise = loginHandler.openLoginPage();
      
      expect(mockChrome.tabs.create).toHaveBeenCalledWith(
        {
          url: 'http://localhost:8001/accounts/login/',
          active: true
        },
        expect.any(Function)
      );

      await expect(openPromise).resolves.toBeUndefined();
      expect(loginHandler.hasActiveLoginTabs()).toBe(false); // Should be cleaned up
    });

    test('handles tab creation error', async () => {
      mockChrome.runtime.lastError = { message: 'Tab creation failed' };
      
      mockChrome.tabs.create.mockImplementation((createInfo, callback) => {
        callback(null);
      });

      await expect(loginHandler.openLoginPage())
        .rejects
        .toThrow('Tab creation failed');
    });

    test('handles missing tab ID', async () => {
      const mockTab = { url: 'http://localhost:8001/accounts/login/' }; // No ID
      
      mockChrome.tabs.create.mockImplementation((createInfo, callback) => {
        callback(mockTab);
      });

      await expect(loginHandler.openLoginPage())
        .rejects
        .toThrow('Login tab created but no tab ID received');
    });

    test('resolves when tab is redirected to success URL', async () => {
      const mockTab = { id: 123 };
      
      mockChrome.tabs.create.mockImplementation((createInfo, callback) => {
        callback(mockTab);
      });

      // Mock successful redirect
      mockChrome.tabs.onUpdated.addListener.mockImplementation((listener) => {
        setTimeout(() => {
          listener(123, { status: 'complete' }, { 
            id: 123, 
            url: 'http://localhost:8001/dashboard' // Success redirect
          });
        }, 10);
      });

      await expect(loginHandler.openLoginPage()).resolves.toBeUndefined();
    });

    test('handles tab closure', async () => {
      const mockTab = { id: 123 };
      
      mockChrome.tabs.create.mockImplementation((createInfo, callback) => {
        callback(mockTab);
      });

      // Mock tab removal - need to call listener immediately not in setTimeout
      mockChrome.tabs.onRemoved.addListener.mockImplementation((listener) => {
        // Call immediately to simulate tab being closed
        listener(123);
      });

      await expect(loginHandler.openLoginPage())
        .rejects
        .toThrow('Login tab was closed by user');
    });
  });

  describe('tab monitoring', () => {
    test('tracks active login tabs', () => {
      expect(loginHandler.hasActiveLoginTabs()).toBe(false);
      expect(loginHandler.getActiveLoginTabs()).toHaveLength(0);
    });

    test('can force cleanup specific tab', () => {
      loginHandler.forceCleanupTab(123);
      // Should not throw error even if tab doesn't exist
      expect(loginHandler.hasActiveLoginTabs()).toBe(false);
    });
  });

  describe('URL detection', () => {
    const handler = new LoginHandler('development');

    test('detects successful login redirects', () => {
      const successUrls = [
        'http://localhost:8001/',
        'http://localhost:8001/dashboard',
        'http://localhost:8001/admin',
        'http://localhost:8001/?login=success'
      ];

      successUrls.forEach(url => {
        // Access private method for testing
        const isSuccess = (handler as any).isSuccessfulLoginRedirect(url);
        expect(isSuccess).toBe(true);
      });
    });

    test('does not detect login page as success', () => {
      const loginUrls = [
        'http://localhost:8001/accounts/login/',
        'http://localhost:8001/accounts/login/?next=/'
      ];

      loginUrls.forEach(url => {
        const isSuccess = (handler as any).isSuccessfulLoginRedirect(url);
        expect(isSuccess).toBe(false);
      });
    });

    test('detects login errors', () => {
      const errorUrls = [
        'http://localhost:8001/accounts/login/?error=invalid',
        'http://localhost:8001/accounts/login/?login_failed=1'
      ];

      errorUrls.forEach(url => {
        const isError = (handler as any).isLoginError(url);
        expect(isError).toBe(true);
      });
    });
  });

  describe('environment-specific login', () => {
    test('can open environment-specific login', () => {
      // Test that the method exists and can be called
      expect(typeof loginHandler.openEnvironmentLogin).toBe('function');
      
      // Test login URL getter
      expect(loginHandler.getLoginUrl()).toBe('http://localhost:8001/accounts/login/');
    });
  });
});