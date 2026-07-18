/**
 * Safari cold-start auth restore (bead quotewise-apple-9b7).
 *
 * Symptom: after the Safari event-page background idles out, opening the tray shows logged-out for a
 * moment, then self-corrects to signed-in with no user action. Theory: on Safari, restoreState()
 * unconditionally runs checkAuthState() — which flashes CHECKING and blocks on a native-bridge
 * round-trip — instead of optimistically restoring the persisted AUTHENTICATED state (the non-Safari
 * path already avoids this flicker). So the popup waits on the bridge and shows its logged-out
 * default until the round-trip returns.
 *
 * These tests force Safari mode (which optimistic-restore.test.ts never does) and assert the manager
 * restores AUTHENTICATED immediately without a CHECKING flash, while still re-validating.
 */
import { AuthState, AUTH_STATE_STORAGE_KEY } from '../../src/auth/auth-state-machine';
import { MessageType } from '../../src/types/chrome';

const mockCheckAuthStatus = jest.fn();

jest.mock('../../src/auth/token-storage', () => ({
  getStoredTokens: jest.fn().mockResolvedValue(undefined),
  getAccessTokenExpiresIn: jest.fn(),
  hasValidRefreshToken: jest.fn().mockResolvedValue(false),
  isAccessTokenValid: jest.fn(),
  hasScope: jest.fn(),
}));

jest.mock('../../src/auth/auth-checker', () => ({
  AuthChecker: jest.fn().mockImplementation(() => ({
    checkAuthStatus: mockCheckAuthStatus,
  })),
}));

jest.mock('../../src/api/quotewise-api', () => ({ apiClient: {} }));
jest.mock('../../src/config/environment', () => ({ debugLog: jest.fn() }));
// The whole point: exercise the Safari branch of restoreState().
jest.mock('../../src/auth/native-bridge', () => ({ isSafariExtension: () => true }));

/** Fresh singleton per test (the instance is module-level — isolate the module to reset it). */
function createFreshManager(): Promise<{ getState: () => AuthState }> {
  return new Promise((resolve, reject) => {
    jest.isolateModules(() => {
      const { initializeAuthStateManager } = require('../../src/auth/auth-state-manager');
      initializeAuthStateManager().then(resolve).catch(reject);
    });
  });
}

/** Auth states the manager broadcast to the popup (AUTH_STATE_CHANGED), in order. */
function broadcastStates(): AuthState[] {
  return (chrome.runtime.sendMessage as jest.Mock).mock.calls
    .map(([msg]) => msg)
    .filter((m) => m?.type === MessageType.AUTH_STATE_CHANGED)
    .map((m) => m.data.state as AuthState);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Safari cold-start auth restore (quotewise-apple-9b7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.tabs.query as jest.Mock).mockResolvedValue([]);
  });

  test('a valid persisted session restores AUTHENTICATED with no CHECKING flash', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [AUTH_STATE_STORAGE_KEY]: {
        state: AuthState.AUTHENTICATED,
        username: 'testuser',
        scopes: ['quotes:write'],
        lastCheckedAt: Date.now() - 60_000,
      },
    });
    // The bridge WILL confirm the session — but the popup must not see a non-authenticated state
    // while we wait for it.
    mockCheckAuthStatus.mockResolvedValue({ username: 'testuser', scopes: ['quotes:write'] });

    const manager = await createFreshManager();
    await flush(); // let any background re-validation settle

    expect(manager.getState()).toBe(AuthState.AUTHENTICATED);
    // The flicker: current code transitions UNKNOWN -> CHECKING before the bridge answers.
    expect(broadcastStates()).not.toContain(AuthState.CHECKING);
  });

  test('still re-validates: a stale persisted session downgrades when the app has signed out', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [AUTH_STATE_STORAGE_KEY]: {
        state: AuthState.AUTHENTICATED,
        username: 'testuser',
        lastCheckedAt: Date.now() - 60_000,
      },
    });
    // Bridge says: not signed in anymore (user signed out in the container app).
    mockCheckAuthStatus.mockResolvedValue({ type: 'not_authenticated', message: 'Not signed in' });

    const manager = await createFreshManager();
    await flush(); // let the background re-validation downgrade

    expect(manager.getState()).toBe(AuthState.UNAUTHENTICATED);
  });
});
