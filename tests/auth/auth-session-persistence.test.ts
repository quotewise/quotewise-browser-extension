/**
 * Tests for auth session persistence bugs
 *
 * Reproduces the scenario where the extension "forgets" login after ~30 minutes.
 *
 * Root causes fixed:
 * 1. Network errors during token refresh were treated as "not authenticated"
 * 2. No mutex on token refresh - concurrent refreshes cause race conditions
 * 3. AuthStateManager transitioned to UNAUTHENTICATED on transient errors
 */

import { AuthChecker } from '../../src/auth/auth-checker';
import type { QuotewiseApiClient } from '../../src/types/api';

// Mock token-storage module
jest.mock('../../src/auth/token-storage', () => ({
  getStoredTokens: jest.fn(),
  isAccessTokenValid: jest.fn(),
  hasValidRefreshToken: jest.fn(),
  getAccessTokenExpiresIn: jest.fn(),
  hasScope: jest.fn(),
}));

// Mock token-refresh module
jest.mock('../../src/auth/token-refresh', () => ({
  attemptTokenRefresh: jest.fn(),
}));

// Mock environment
jest.mock('../../src/config/environment', () => ({
  debugLog: jest.fn(),
}));

// Get references to mocked functions
const { getStoredTokens, isAccessTokenValid, hasScope, getAccessTokenExpiresIn } =
  require('../../src/auth/token-storage');
const { attemptTokenRefresh } = require('../../src/auth/token-refresh');

// Mock API client
const mockApiClient = {
  baseUrl: 'http://api.quotewise.test:8000',
  checkAuthStatus: jest.fn(),
  searchOriginators: jest.fn(),
  checkQuoteDuplicate: jest.fn(),
  submitQuote: jest.fn(),
  listCollections: jest.fn(),
  lookupOriginatorByHandle: jest.fn(),
  preflightCheck: jest.fn(),
} as jest.Mocked<QuotewiseApiClient>;

describe('Auth Session Persistence - Network Error Handling', () => {
  let authChecker: AuthChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    authChecker = new AuthChecker(mockApiClient);
  });

  test('returns network_error (not not_authenticated) when refresh fails due to network', async () => {
    // User has valid tokens but refresh fails due to network issue
    const mockTokens = {
      accessToken: 'expired-token',
      refreshToken: 'valid-refresh-token',
      accessTokenExpiresAt: Date.now() - 1000,
      refreshTokenExpiresAt: Date.now() + 86400000,
      scopes: ['quotes:read', 'quotes:write'],
    };

    getStoredTokens.mockResolvedValue(mockTokens);
    isAccessTokenValid.mockResolvedValue(false);
    attemptTokenRefresh.mockResolvedValue({
      success: false,
      error: 'network_error',
      message: 'Network request failed',
    });

    const result = await authChecker.checkAuthStatus();

    expect('type' in result).toBe(true);
    if ('type' in result) {
      // Network error should NOT be treated as "not authenticated"
      expect(result.type).toBe('network_error');
      expect(result.requiresLogin).toBe(false);
    }
  });

  test('does not require re-login when refresh fails transiently', async () => {
    const mockTokens = {
      accessToken: 'expired-token',
      refreshToken: 'valid-refresh-token',
      accessTokenExpiresAt: Date.now() - 1000,
      refreshTokenExpiresAt: Date.now() + 86400000,
      scopes: ['quotes:read', 'quotes:write'],
    };

    getStoredTokens.mockResolvedValue(mockTokens);
    isAccessTokenValid.mockResolvedValue(false);
    attemptTokenRefresh.mockResolvedValue({
      success: false,
      error: 'network_error',
      message: 'Failed to fetch',
    });

    const result = await authChecker.checkAuthStatus();

    if ('type' in result) {
      expect(result.requiresLogin).toBe(false);
    }
  });

  test('still returns session_expired for revoked tokens', async () => {
    const mockTokens = {
      accessToken: 'token',
      refreshToken: 'revoked-refresh',
      scopes: [],
    };

    getStoredTokens.mockResolvedValue(mockTokens);
    isAccessTokenValid.mockResolvedValue(false);
    attemptTokenRefresh.mockResolvedValue({
      success: false,
      error: 'revoked',
      message: 'Token was revoked',
    });

    const result = await authChecker.checkAuthStatus();

    expect('type' in result).toBe(true);
    if ('type' in result) {
      expect(result.type).toBe('session_expired');
      expect(result.requiresLogin).toBe(true);
    }
  });

  test('still returns not_authenticated for genuinely expired tokens', async () => {
    const mockTokens = {
      accessToken: 'token',
      refreshToken: 'expired-refresh',
      scopes: [],
    };

    getStoredTokens.mockResolvedValue(mockTokens);
    isAccessTokenValid.mockResolvedValue(false);
    attemptTokenRefresh.mockResolvedValue({
      success: false,
      error: 'expired',
      message: 'Refresh token expired',
    });

    const result = await authChecker.checkAuthStatus();

    expect('type' in result).toBe(true);
    if ('type' in result) {
      expect(result.type).toBe('not_authenticated');
      expect(result.requiresLogin).toBe(true);
    }
  });

  test('returns authenticated after successful refresh', async () => {
    const mockTokens = {
      accessToken: 'new-access-token',
      refreshToken: 'valid-refresh',
      accessTokenExpiresAt: Date.now() + 3600000,
      refreshTokenExpiresAt: Date.now() + 86400000,
      scopes: ['quotes:read', 'quotes:write'],
    };

    getStoredTokens.mockResolvedValue(mockTokens);
    isAccessTokenValid.mockResolvedValue(false);
    attemptTokenRefresh.mockResolvedValue({ success: true });
    hasScope.mockResolvedValue(true);
    getAccessTokenExpiresIn.mockResolvedValue(3600000);

    const result = await authChecker.checkAuthStatus();

    expect('isAuthenticated' in result).toBe(true);
    if ('isAuthenticated' in result) {
      expect(result.isAuthenticated).toBe(true);
    }
  });
});
