/**
 * Auth State Machine for Quotewise Chrome extension
 * Defines states, transitions, and helpers for centralized auth management
 */

/**
 * Authentication states for the extension
 * Matches service worker lifecycle where state must persist across terminations
 */
export enum AuthState {
  /** Initial state, auth status unknown (service worker just started) */
  UNKNOWN = 'UNKNOWN',
  /** Actively checking auth status (validating tokens) */
  CHECKING = 'CHECKING',
  /** User is authenticated with valid tokens */
  AUTHENTICATED = 'AUTHENTICATED',
  /** User is not authenticated (no tokens or invalid) */
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  /** Access token expired, refresh possible */
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  /** OAuth flow in progress */
  AUTHENTICATING = 'AUTHENTICATING',
  /** Authenticated but lacks required scopes (e.g., quotes:write) */
  INSUFFICIENT_PRIVILEGES = 'INSUFFICIENT_PRIVILEGES',
}

/**
 * Auth state data stored in chrome.storage.session
 * Persists across service worker terminations
 */
export interface AuthStateData {
  state: AuthState;
  /** Username if authenticated */
  username?: string;
  /** OAuth scopes granted */
  scopes?: string[];
  /** Access token expiry timestamp (ms since epoch) */
  expiresAt?: number;
  /** Last state check timestamp */
  lastCheckedAt: number;
  /** Error message if applicable */
  error?: string;
}

/**
 * Valid state transitions
 * Key: current state, Value: array of valid next states
 */
export const VALID_TRANSITIONS: Record<AuthState, AuthState[]> = {
  [AuthState.UNKNOWN]: [
    AuthState.CHECKING,
    AuthState.AUTHENTICATED,      // Fast restore from storage
    AuthState.UNAUTHENTICATED,    // No stored tokens
  ],
  [AuthState.CHECKING]: [
    AuthState.AUTHENTICATED,
    AuthState.UNAUTHENTICATED,
    AuthState.SESSION_EXPIRED,
    AuthState.INSUFFICIENT_PRIVILEGES,
  ],
  [AuthState.AUTHENTICATED]: [
    AuthState.UNAUTHENTICATED,    // Logout
    AuthState.SESSION_EXPIRED,    // Token expired
    AuthState.CHECKING,           // Manual re-check
  ],
  [AuthState.UNAUTHENTICATED]: [
    AuthState.AUTHENTICATING,     // Starting OAuth flow
    AuthState.CHECKING,           // Manual re-check
  ],
  [AuthState.SESSION_EXPIRED]: [
    AuthState.AUTHENTICATING,     // Re-authenticate
    AuthState.AUTHENTICATED,      // Token refresh succeeded
    AuthState.UNAUTHENTICATED,    // Refresh failed
    AuthState.CHECKING,           // Manual re-check
  ],
  [AuthState.AUTHENTICATING]: [
    AuthState.AUTHENTICATED,      // OAuth success
    AuthState.UNAUTHENTICATED,    // OAuth cancelled/failed
  ],
  [AuthState.INSUFFICIENT_PRIVILEGES]: [
    AuthState.AUTHENTICATING,     // Re-authenticate with more scopes
    AuthState.UNAUTHENTICATED,    // Logout
    AuthState.CHECKING,           // Manual re-check
  ],
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: AuthState, to: AuthState): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets?.includes(to) ?? false;
}

/**
 * Check if state requires user action (login)
 */
export function requiresLogin(state: AuthState): boolean {
  return state === AuthState.UNAUTHENTICATED || state === AuthState.SESSION_EXPIRED;
}

/**
 * Check if state is a terminal authenticated state
 */
export function isAuthenticated(state: AuthState): boolean {
  return state === AuthState.AUTHENTICATED;
}

/**
 * Check if state is an error/problem state
 * Note: UNAUTHENTICATED is NOT an error - it's an expected state for users who haven't logged in.
 * Only SESSION_EXPIRED (token issues) and INSUFFICIENT_PRIVILEGES are actual errors.
 */
export function isErrorState(state: AuthState): boolean {
  return (
    state === AuthState.SESSION_EXPIRED ||
    state === AuthState.INSUFFICIENT_PRIVILEGES
  );
}

/**
 * Check if state is a transitional state (not settled)
 */
export function isTransitionalState(state: AuthState): boolean {
  return (
    state === AuthState.UNKNOWN ||
    state === AuthState.CHECKING ||
    state === AuthState.AUTHENTICATING
  );
}

/**
 * Get display message for a state
 */
export function getStateMessage(state: AuthState): string {
  switch (state) {
    case AuthState.UNKNOWN:
      return 'Checking authentication...';
    case AuthState.CHECKING:
      return 'Verifying credentials...';
    case AuthState.AUTHENTICATED:
      return 'Ready to capture quotes';
    case AuthState.UNAUTHENTICATED:
      return 'Click to log in';  // Friendly prompt, not error
    case AuthState.SESSION_EXPIRED:
      return 'Session expired, please log in again';  // Actual error
    case AuthState.AUTHENTICATING:
      return 'Logging in...';
    case AuthState.INSUFFICIENT_PRIVILEGES:
      return 'Additional permissions required';
  }
}

/**
 * Storage key for auth state in chrome.storage.session
 */
export const AUTH_STATE_STORAGE_KEY = 'authState';

/**
 * Create initial auth state data
 */
export function createInitialAuthState(): AuthStateData {
  return {
    state: AuthState.UNKNOWN,
    lastCheckedAt: Date.now(),
  };
}
