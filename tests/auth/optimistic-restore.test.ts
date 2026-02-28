/**
 * Tests for optimistic auth state restore (FR-020)
 *
 * Verifies that restoreState() checks token expiry locally and does NOT
 * make a network call when the access token is still valid.
 * This prevents the persistent re-login bug caused by service worker restarts.
 */

import { AuthState, AUTH_STATE_STORAGE_KEY } from '../../src/auth/auth-state-machine';

// Shared mock functions that persist across jest.resetModules()
const mockGetAccessTokenExpiresIn = jest.fn();
const mockHasValidRefreshToken = jest.fn();
const mockCheckAuthStatus = jest.fn();

// These mocks must be defined before any dynamic require() calls
jest.mock('../../src/auth/token-storage', () => ({
  getStoredTokens: jest.fn(),
  getAccessTokenExpiresIn: mockGetAccessTokenExpiresIn,
  hasValidRefreshToken: mockHasValidRefreshToken,
  isAccessTokenValid: jest.fn(),
  hasScope: jest.fn(),
}));

jest.mock('../../src/auth/auth-checker', () => ({
  AuthChecker: jest.fn().mockImplementation(() => ({
    checkAuthStatus: mockCheckAuthStatus,
  })),
}));

jest.mock('../../src/api/quotewise-api', () => ({
  apiClient: {},
}));

jest.mock('../../src/config/environment', () => ({
  debugLog: jest.fn(),
}));

/**
 * Helper: reset the AuthStateManager singleton so each test gets a fresh instance.
 * We dynamically require to get the fresh module after singleton reset.
 */
async function createFreshManager() {
  // The singleton is a module-level `let instance` — we need to reset it.
  // Since jest.mock() persists across resetModules for manual mocks,
  // we just need to clear the singleton. We can do this by accessing the module.
  const mod = require('../../src/auth/auth-state-manager');
  // Force singleton reset by calling initialize which creates new if instance is null
  // But the instance is already set from a previous test... We need a different approach.
  // Actually, with jest.isolateModules we get a fresh module scope.
  return new Promise<{ getState: () => AuthState }>((resolve, reject) => {
    jest.isolateModules(() => {
      const { initializeAuthStateManager } = require('../../src/auth/auth-state-manager');
      initializeAuthStateManager().then(resolve).catch(reject);
    });
  });
}

describe('Optimistic Auth Restore (FR-020)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('restoreState does NOT call checkAuthStatus when access token is still valid', async () => {
    // Setup: stored AUTHENTICATED state with valid token
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [AUTH_STATE_STORAGE_KEY]: {
        state: AuthState.AUTHENTICATED,
        username: 'testuser',
        lastCheckedAt: Date.now() - 1000,
      },
    });

    // Token has 30 minutes left — no need to hit network
    mockGetAccessTokenExpiresIn.mockResolvedValue(30 * 60 * 1000);

    const manager = await createFreshManager();

    // Should restore AUTHENTICATED without network call
    expect(manager.getState()).toBe(AuthState.AUTHENTICATED);
    expect(mockCheckAuthStatus).not.toHaveBeenCalled();
  });

  test('restoreState keeps AUTHENTICATED when token expired but refresh token exists', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [AUTH_STATE_STORAGE_KEY]: {
        state: AuthState.AUTHENTICATED,
        username: 'testuser',
        lastCheckedAt: Date.now() - 1000,
      },
    });

    // Token expired
    mockGetAccessTokenExpiresIn.mockResolvedValue(0);
    // But refresh token exists — initializeTokenRefresh() will handle refresh
    mockHasValidRefreshToken.mockResolvedValue(true);

    const manager = await createFreshManager();

    // Should keep AUTHENTICATED (not flash to CHECKING)
    expect(manager.getState()).toBe(AuthState.AUTHENTICATED);
    // Should NOT have called network-based auth check
    expect(mockCheckAuthStatus).not.toHaveBeenCalled();
  });

  test('restoreState transitions to UNAUTHENTICATED when no refresh token', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [AUTH_STATE_STORAGE_KEY]: {
        state: AuthState.AUTHENTICATED,
        username: 'testuser',
        lastCheckedAt: Date.now() - 1000,
      },
    });

    // Token expired and no refresh token
    mockGetAccessTokenExpiresIn.mockResolvedValue(0);
    mockHasValidRefreshToken.mockResolvedValue(false);

    const manager = await createFreshManager();

    expect(manager.getState()).toBe(AuthState.UNAUTHENTICATED);
  });

  test('restoreState calls checkAuthState for transitional CHECKING state', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [AUTH_STATE_STORAGE_KEY]: {
        state: AuthState.CHECKING,
        lastCheckedAt: Date.now() - 1000,
      },
    });

    // For checkAuthState path: no refresh token → UNAUTHENTICATED
    mockHasValidRefreshToken.mockResolvedValue(false);

    const manager = await createFreshManager();

    // CHECKING is a transitional state — should re-validate and end up UNAUTHENTICATED
    expect(manager.getState()).toBe(AuthState.UNAUTHENTICATED);
  });

  test('restoreState preserves UNAUTHENTICATED state without network call', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [AUTH_STATE_STORAGE_KEY]: {
        state: AuthState.UNAUTHENTICATED,
        lastCheckedAt: Date.now() - 1000,
      },
    });

    const manager = await createFreshManager();

    expect(manager.getState()).toBe(AuthState.UNAUTHENTICATED);
    expect(mockCheckAuthStatus).not.toHaveBeenCalled();
  });

  test('restoreState preserves SESSION_EXPIRED state without network call', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [AUTH_STATE_STORAGE_KEY]: {
        state: AuthState.SESSION_EXPIRED,
        error: 'Session expired',
        lastCheckedAt: Date.now() - 1000,
      },
    });

    const manager = await createFreshManager();

    expect(manager.getState()).toBe(AuthState.SESSION_EXPIRED);
    expect(mockCheckAuthStatus).not.toHaveBeenCalled();
  });
});
