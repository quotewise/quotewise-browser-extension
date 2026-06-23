/**
 * Unit tests for AuthChecker
 * Tests OAuth 2.0 token-based authentication
 */

import { AuthChecker } from '../../src/auth/auth-checker';
import type { QuotewiseApiClient } from '../../src/types/api';
import type { AuthStatus, AuthError } from '../../src/types/auth';

// Mock API client (still used for some API operations)
const mockApiClient = {
  baseUrl: 'http://api.quotewise.test:8000',
  checkAuthStatus: jest.fn(),
  searchOriginators: jest.fn(),
  checkQuoteDuplicate: jest.fn(),
  submitQuote: jest.fn(),
  addQuoteToCollection: jest.fn(),
  listCollections: jest.fn(),
  lookupOriginatorByHandle: jest.fn(),
  preflightCheck: jest.fn()
} as jest.Mocked<QuotewiseApiClient>;

// Mock token-storage module
jest.mock('../../src/auth/token-storage', () => ({
  getStoredTokens: jest.fn(),
  isAccessTokenValid: jest.fn(),
  hasValidRefreshToken: jest.fn(),
  getAccessTokenExpiresIn: jest.fn(),
  hasScope: jest.fn()
}));

// Mock token-refresh module
jest.mock('../../src/auth/token-refresh', () => ({
  attemptTokenRefresh: jest.fn()
}));

// Mock environment
jest.mock('../../src/config/environment', () => ({
  debugLog: jest.fn()
}));

// Get references to mocked functions
const { getStoredTokens, isAccessTokenValid, hasValidRefreshToken, getAccessTokenExpiresIn, hasScope } =
  require('../../src/auth/token-storage');
const { attemptTokenRefresh } = require('../../src/auth/token-refresh');

describe('AuthChecker', () => {
  let authChecker: AuthChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    authChecker = new AuthChecker(mockApiClient);
  });

  describe('checkAuthStatus', () => {
    test('returns authenticated status for valid tokens', async () => {
      const mockTokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        accessTokenExpiresAt: Date.now() + 3600000,
        refreshTokenExpiresAt: Date.now() + 86400000,
        scopes: ['quotes:read', 'quotes:write']
      };

      getStoredTokens.mockResolvedValue(mockTokens);
      isAccessTokenValid.mockResolvedValue(true);
      hasScope.mockResolvedValue(true); // quotes:write
      getAccessTokenExpiresIn.mockResolvedValue(3600000); // 1 hour

      const result = await authChecker.checkAuthStatus();

      expect('isAuthenticated' in result).toBe(true);
      if ('isAuthenticated' in result) {
        expect(result.isAuthenticated).toBe(true);
        expect(result.isStaff).toBe(true); // quotes:write scope
        expect(result.sessionAge).toBe(3600); // seconds
        expect(result.scopes).toEqual(['quotes:read', 'quotes:write']);
      }
    });

    test('returns auth error when no tokens exist', async () => {
      getStoredTokens.mockResolvedValue(null);

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('not_authenticated');
        expect(result.message).toBe('Please log in to Quotewise');
        expect(result.requiresLogin).toBe(true);
      }
    });

    test('returns auth error when no refresh token exists', async () => {
      getStoredTokens.mockResolvedValue({ accessToken: 'token', refreshToken: null });

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('not_authenticated');
      }
    });

    test('attempts token refresh when access token expired', async () => {
      const mockTokens = {
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh',
        scopes: ['quotes:read', 'quotes:write']
      };

      getStoredTokens.mockResolvedValue(mockTokens);
      isAccessTokenValid.mockResolvedValue(false);
      attemptTokenRefresh.mockResolvedValue({ success: true });
      hasScope.mockResolvedValue(true);
      getAccessTokenExpiresIn.mockResolvedValue(3600000);

      const result = await authChecker.checkAuthStatus();

      expect(attemptTokenRefresh).toHaveBeenCalledTimes(1);
      expect('isAuthenticated' in result).toBe(true);
    });

    test('returns session_expired error when token refresh fails with revoked', async () => {
      const mockTokens = { accessToken: 'token', refreshToken: 'refresh', scopes: [] };

      getStoredTokens.mockResolvedValue(mockTokens);
      isAccessTokenValid.mockResolvedValue(false);
      attemptTokenRefresh.mockResolvedValue({
        success: false,
        error: 'revoked',
        message: 'Token was revoked'
      });

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('session_expired');
        expect(result.requiresLogin).toBe(true);
      }
    });

    test('returns not_authenticated error when token refresh fails with other error', async () => {
      const mockTokens = { accessToken: 'token', refreshToken: 'refresh', scopes: [] };

      getStoredTokens.mockResolvedValue(mockTokens);
      isAccessTokenValid.mockResolvedValue(false);
      attemptTokenRefresh.mockResolvedValue({ success: false, error: 'network' });

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('not_authenticated');
        expect(result.requiresLogin).toBe(true);
      }
    });

    test('handles unexpected errors gracefully', async () => {
      getStoredTokens.mockRejectedValue(new Error('Storage error'));

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('network_error');
        expect(result.message).toBe('Unable to check authentication status');
        expect(result.requiresLogin).toBe(false);
      }
    });

    test('handles authentication errors specifically', async () => {
      const authError = new Error('Authentication required');
      authError.name = 'AuthenticationError';
      getStoredTokens.mockRejectedValue(authError);

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('not_authenticated');
        expect(result.requiresLogin).toBe(true);
      }
    });
  });

  describe('isAuthenticated', () => {
    test('returns true when valid refresh token exists', async () => {
      hasValidRefreshToken.mockResolvedValue(true);

      const result = await authChecker.isAuthenticated();

      expect(result).toBe(true);
    });

    test('returns false when no valid refresh token exists', async () => {
      hasValidRefreshToken.mockResolvedValue(false);

      const result = await authChecker.isAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('waitForAuthChange', () => {
    test('resolves when authentication is detected', async () => {
      // First call returns false, second returns true
      hasValidRefreshToken
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      // Mock successful auth status on second check
      getStoredTokens.mockResolvedValue({
        accessToken: 'token',
        refreshToken: 'refresh',
        scopes: ['quotes:read', 'quotes:write']
      });
      isAccessTokenValid.mockResolvedValue(true);
      hasScope.mockResolvedValue(true);
      getAccessTokenExpiresIn.mockResolvedValue(3600000);

      const result = await authChecker.waitForAuthChange(2000);

      expect(result.isAuthenticated).toBe(true);
    });

    test('throws timeout error when no authentication detected', async () => {
      hasValidRefreshToken.mockResolvedValue(false);

      await expect(authChecker.waitForAuthChange(500))
        .rejects
        .toThrow('Authentication timeout');
    });
  });

  describe('validatePrivileges', () => {
    test('returns null for authenticated user with write access', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        username: 'admin',
        sessionAge: 3600,
        scopes: ['quotes:read', 'quotes:write']
      };

      const result = authChecker.validatePrivileges(authStatus);
      expect(result).toBeNull();
    });

    test('returns not_authenticated error for unauthenticated user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: false,
        isStaff: false
      };

      const result = authChecker.validatePrivileges(authStatus);
      expect(result).toEqual({
        type: 'not_authenticated',
        message: 'Please log in to Quotewise',
        requiresLogin: true
      });
    });

    test('returns insufficient_privileges error for read-only user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: false,
        username: 'user',
        scopes: ['quotes:read']
      };

      const result = authChecker.validatePrivileges(authStatus);
      expect(result).toEqual({
        type: 'insufficient_privileges',
        message: 'Quote submission permission required',
        requiresLogin: false
      });
    });

    test('returns session_expired error for expired token', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        username: 'admin',
        sessionAge: 0
      };

      const result = authChecker.validatePrivileges(authStatus);
      expect(result).toEqual({
        type: 'session_expired',
        message: 'Your session has expired. Please log in again.',
        requiresLogin: true
      });
    });
  });

  describe('isSessionNearExpiry', () => {
    test('returns true for tokens expiring within 10 minutes', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        sessionAge: 300 // 5 minutes
      };

      const result = authChecker.isSessionNearExpiry(authStatus);
      expect(result).toBe(true);
    });

    test('returns false for tokens with more than 10 minutes remaining', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        sessionAge: 900 // 15 minutes
      };

      const result = authChecker.isSessionNearExpiry(authStatus);
      expect(result).toBe(false);
    });

    test('returns false when no session age provided', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true
      };

      const result = authChecker.isSessionNearExpiry(authStatus);
      expect(result).toBe(false);
    });
  });

  describe('getUserDisplayName', () => {
    test('returns username for authenticated user with username', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        username: 'testuser'
      };

      const result = authChecker.getUserDisplayName(authStatus);
      expect(result).toBe('testuser');
    });

    test('returns "Not logged in" for unauthenticated user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: false,
        isStaff: false
      };

      const result = authChecker.getUserDisplayName(authStatus);
      expect(result).toBe('Not logged in');
    });

    test('returns "Authenticated user" when no username provided', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true
      };

      const result = authChecker.getUserDisplayName(authStatus);
      expect(result).toBe('Authenticated user');
    });
  });

  describe('getStatusSummary', () => {
    test('returns error message for AuthError', () => {
      const authError: AuthError = {
        type: 'not_authenticated',
        message: 'Please log in',
        requiresLogin: true
      };

      const result = authChecker.getStatusSummary(authError);
      expect(result).toBe('Please log in');
    });

    test('returns detailed status for authenticated user with write access', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        username: 'admin',
        sessionAge: 1800 // 30 minutes
      };

      const result = authChecker.getStatusSummary(authStatus);
      expect(result).toBe('Logged in as admin (token expires in 30m)');
    });

    test('returns status for authenticated read-only user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: false,
        username: 'user'
      };

      const result = authChecker.getStatusSummary(authStatus);
      expect(result).toBe('Logged in (read-only access)');
    });

    test('returns not authenticated status', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: false,
        isStaff: false
      };

      const result = authChecker.getStatusSummary(authStatus);
      expect(result).toBe('Not authenticated');
    });

    test('handles authenticated user without username', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        sessionAge: 600 // 10 minutes
      };

      const result = authChecker.getStatusSummary(authStatus);
      expect(result).toBe('Logged in as user (token expires in 10m)');
    });
  });
});
