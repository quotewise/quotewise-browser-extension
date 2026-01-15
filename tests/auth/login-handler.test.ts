/**
 * Unit tests for LoginHandler
 * Tests OAuth 2.0 Authorization Code flow with PKCE
 */

import { LoginHandler } from '../../src/auth/login-handler';

// Mock Chrome APIs
const mockChrome = {
  storage: {
    session: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined)
    },
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined)
    }
  },
  identity: {
    launchWebAuthFlow: jest.fn()
  },
  runtime: {
    lastError: null as chrome.runtime.LastError | null,
    id: 'test-extension-id'
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn().mockResolvedValue(true)
  }
};

(global as any).chrome = mockChrome;

// Mock auth-flow module
jest.mock('../../src/auth/auth-flow', () => ({
  initiateOAuthFlow: jest.fn(),
  logout: jest.fn(),
  OAuthFlowError: class OAuthFlowError extends Error {
    recoverable: boolean;
    constructor(message: string, recoverable = true) {
      super(message);
      this.name = 'OAuthFlowError';
      this.recoverable = recoverable;
    }
  }
}));

// Mock token-storage module
jest.mock('../../src/auth/token-storage', () => ({
  hasValidRefreshToken: jest.fn()
}));

// Mock environment
jest.mock('../../src/config/environment', () => ({
  debugLog: jest.fn()
}));

// Get references to the mocked functions
const { initiateOAuthFlow, logout, OAuthFlowError } = require('../../src/auth/auth-flow');
const { hasValidRefreshToken } = require('../../src/auth/token-storage');

describe('LoginHandler', () => {
  let loginHandler: LoginHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    loginHandler = new LoginHandler();
    mockChrome.runtime.lastError = null;
  });

  describe('initialization', () => {
    test('creates handler instance', () => {
      expect(loginHandler).toBeInstanceOf(LoginHandler);
    });

    test('isLoggingIn returns false initially', () => {
      expect(loginHandler.isLoggingIn()).toBe(false);
    });
  });

  describe('login', () => {
    test('successfully completes OAuth login flow', async () => {
      const mockTokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        accessTokenExpiresAt: Date.now() + 3600000,
        refreshTokenExpiresAt: Date.now() + 86400000,
        scopes: ['quotes:read', 'quotes:write']
      };

      initiateOAuthFlow.mockResolvedValue(mockTokens);

      const result = await loginHandler.login();

      expect(result.success).toBe(true);
      expect(result.tokens).toEqual(mockTokens);
      expect(result.error).toBeUndefined();
      expect(initiateOAuthFlow).toHaveBeenCalledTimes(1);
    });

    test('handles OAuthFlowError with recoverable flag', async () => {
      const oauthError = new OAuthFlowError('User cancelled', true);
      initiateOAuthFlow.mockRejectedValue(oauthError);

      const result = await loginHandler.login();

      expect(result.success).toBe(false);
      expect(result.error).toBe('User cancelled');
      expect(result.recoverable).toBe(true);
    });

    test('handles OAuthFlowError with non-recoverable flag', async () => {
      const oauthError = new OAuthFlowError('Invalid client', false);
      initiateOAuthFlow.mockRejectedValue(oauthError);

      const result = await loginHandler.login();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid client');
      expect(result.recoverable).toBe(false);
    });

    test('handles generic Error', async () => {
      const error = new Error('Network error');
      initiateOAuthFlow.mockRejectedValue(error);

      const result = await loginHandler.login();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.recoverable).toBe(true);
    });

    test('handles unknown error type', async () => {
      initiateOAuthFlow.mockRejectedValue('string error');

      const result = await loginHandler.login();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown login error');
      expect(result.recoverable).toBe(true);
    });

    test('prevents concurrent login attempts', async () => {
      // Start first login (will hang)
      initiateOAuthFlow.mockImplementation(() => new Promise(() => {}));

      const firstLogin = loginHandler.login();

      // Attempt second login while first is in progress
      const secondLogin = await loginHandler.login();

      expect(secondLogin.success).toBe(false);
      expect(secondLogin.error).toBe('Login already in progress');
      expect(secondLogin.recoverable).toBe(true);
      expect(initiateOAuthFlow).toHaveBeenCalledTimes(1);
    });

    test('resets isLoggingIn after successful login', async () => {
      initiateOAuthFlow.mockResolvedValue({
        accessToken: 'token',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() + 3600000,
        refreshTokenExpiresAt: Date.now() + 86400000,
        scopes: []
      });

      expect(loginHandler.isLoggingIn()).toBe(false);

      await loginHandler.login();

      expect(loginHandler.isLoggingIn()).toBe(false);
    });

    test('resets isLoggingIn after failed login', async () => {
      initiateOAuthFlow.mockRejectedValue(new Error('Failed'));

      expect(loginHandler.isLoggingIn()).toBe(false);

      await loginHandler.login();

      expect(loginHandler.isLoggingIn()).toBe(false);
    });
  });

  describe('logout', () => {
    test('calls logout from auth-flow', async () => {
      logout.mockResolvedValue(undefined);

      await loginHandler.logout();

      expect(logout).toHaveBeenCalledTimes(1);
    });

    test('handles logout errors gracefully', async () => {
      logout.mockRejectedValue(new Error('Logout failed'));

      // Should not throw
      await expect(loginHandler.logout()).rejects.toThrow('Logout failed');
    });
  });

  describe('isAuthenticated', () => {
    test('returns true when valid refresh token exists', async () => {
      hasValidRefreshToken.mockResolvedValue(true);

      const result = await loginHandler.isAuthenticated();

      expect(result).toBe(true);
      expect(hasValidRefreshToken).toHaveBeenCalledTimes(1);
    });

    test('returns false when no valid refresh token exists', async () => {
      hasValidRefreshToken.mockResolvedValue(false);

      const result = await loginHandler.isAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('isLoggingIn', () => {
    test('returns true during login process', async () => {
      let resolveLogin: (value: unknown) => void;
      const loginPromise = new Promise(resolve => {
        resolveLogin = resolve;
      });

      initiateOAuthFlow.mockImplementation(() => loginPromise);

      // Start login but don't await
      const loginResult = loginHandler.login();

      // Should be in progress
      expect(loginHandler.isLoggingIn()).toBe(true);

      // Complete login
      resolveLogin!({
        accessToken: 'token',
        refreshToken: 'refresh',
        accessTokenExpiresAt: Date.now() + 3600000,
        refreshTokenExpiresAt: Date.now() + 86400000,
        scopes: []
      });

      await loginResult;

      // Should be complete
      expect(loginHandler.isLoggingIn()).toBe(false);
    });
  });
});
