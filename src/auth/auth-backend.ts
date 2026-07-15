/**
 * Single auth seam (gpt-5.6-sol audit — design fix). There are genuinely two implementations:
 * Chrome/Firefox run their own OAuth and hold tokens locally; Safari borrows short-lived tokens
 * from the container app over the native bridge. Instead of scattering `isSafariExtension()`
 * branches across every consumer (which is how the last round of bugs crept in — a local-token
 * helper that never asked the bridge), the platform is selected ONCE here and every consumer calls
 * the interface.
 *
 * This first phase owns the token + sign-out path (the broker-contract-critical part). Auth-STATE
 * derivation still lives in auth-checker/auth-state-manager; folding it in here is tracked follow-up.
 */
import {
  isSafariExtension,
  getNativeAccessToken,
  getNativeAuthStatus,
  signOutNative,
} from './native-bridge';
import { getAccessToken, clearTokens } from './token-storage';
import { attemptTokenRefresh } from './token-refresh';

/** The scopes the container app's OAuth always grants (Safari has no local token to read them from). */
const NATIVE_SCOPES = ['quotes:read', 'quotes:write', 'collections:read', 'collections:write'];

export interface AuthSnapshot {
  authenticated: boolean;
  scopes: string[];
}

export interface AuthBackend {
  /** A usable access token, or null (fail-closed) when signed out / unavailable.
   *  `forceRefresh` rotates the token regardless of local expiry — for 401 recovery. */
  accessToken(forceRefresh?: boolean): Promise<string | null>;
  /** Whether a session is currently available. */
  status(): Promise<AuthSnapshot>;
  /** Wipe the session (the app's on Safari; local on Chrome). */
  signOut(): Promise<void>;
}

const nativeAuthBackend: AuthBackend = {
  accessToken: (forceRefresh = false) => getNativeAccessToken(forceRefresh),
  async status() {
    const signedIn = await getNativeAuthStatus();
    return { authenticated: signedIn, scopes: signedIn ? NATIVE_SCOPES : [] };
  },
  signOut: () => signOutNative(),
};

const chromeAuthBackend: AuthBackend = {
  async accessToken(forceRefresh = false) {
    if (forceRefresh) {
      await attemptTokenRefresh();
    }
    return getAccessToken();
  },
  async status() {
    const token = await getAccessToken();
    return { authenticated: token !== null, scopes: [] };
  },
  signOut: () => clearTokens(),
};

/** Selected once, at module load, by platform. No consumer should branch on the platform again. */
export const authBackend: AuthBackend = isSafariExtension() ? nativeAuthBackend : chromeAuthBackend;
