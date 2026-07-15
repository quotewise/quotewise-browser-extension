/**
 * Safari native-messaging token bridge (spec 002; quotewise-apple contracts/native-messaging.md).
 * On Safari the container app is the token broker: the extension asks it for a short-lived access
 * token instead of running its own OAuth. Credentials never live in extension storage. On
 * Chrome/Firefox none of this runs.
 *
 * MUST run in the background context — content scripts can't call sendNativeMessage.
 *
 * Hardened per the gpt-5.6-sol audit: every native request has a timeout (Safari can silently drop
 * the response callback, which would otherwise hang auth forever), and concurrent GET_ACCESS_TOKEN
 * calls coalesce onto one in-flight request.
 */
import { debugLog } from '../config/environment';

/** The container app that hosts the SafariWebExtensionHandler broker. */
const NATIVE_APP_ID = 'io.quotewise.apple';

/** Keep the in-memory token until this close to expiry, then re-ask the app. */
const CACHE_SKEW_MS = 30_000;

/** Hard ceiling on a native round-trip — Safari may never invoke the callback (known bug). */
const NATIVE_TIMEOUT_MS = 8_000;

interface NativeBridgeResponse {
  ok: boolean;
  accessToken?: string;
  expiresAt?: number; // epoch SECONDS (the handler sends Int seconds)
  status?: 'signed_in' | 'signed_out';
  error?: string;
}

// In-memory only (Constitution III.2 — the extension never persists the token).
let cachedToken: string | null = null;
let cachedExpiresAtMs = 0;
// Coalesce concurrent token fetches so a burst of requests triggers ONE native round-trip.
let inFlightToken: Promise<string | null> | null = null;

/** True when running as a Safari Web Extension, where the native bridge is available. */
export function isSafariExtension(): boolean {
  try {
    return chrome.runtime.getURL('').startsWith('safari-web-extension://');
  } catch {
    return false;
  }
}

/**
 * Send one message to the container app. Uses the callback form (typed in @types/chrome and
 * supported by Safari). Resolves to null on any error, on a malformed reply, or on timeout —
 * fail-closed, never throws, never hangs.
 */
function sendNative(message: Record<string, unknown>): Promise<NativeBridgeResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: NativeBridgeResponse | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // Guard against Safari dropping the callback — settle as failure after the timeout.
    const timer = setTimeout(() => {
      debugLog('native bridge timeout for', message.type);
      settle(null);
    }, NATIVE_TIMEOUT_MS);

    try {
      chrome.runtime.sendNativeMessage(NATIVE_APP_ID, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          debugLog('native bridge error:', chrome.runtime.lastError.message);
          settle(null);
          return;
        }
        settle((response ?? null) as NativeBridgeResponse | null);
      });
    } catch (error) {
      clearTimeout(timer);
      debugLog('native bridge threw:', error);
      settle(null);
    }
  });
}

/**
 * A currently-valid access token from the container app, cached in memory until near expiry.
 * Returns null (signed-out / bridge failure) — the caller treats absence as unauthenticated.
 *
 * @param forceRefresh skip the cache AND ask the app to rotate the token regardless of local expiry
 *   (used on a 401 — the token may be revoked-but-not-expired, so a plain re-read would resend it).
 */
export async function getNativeAccessToken(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) {
    clearNativeTokenCache();
    return fetchNativeToken(true);
  }
  if (cachedToken && Date.now() < cachedExpiresAtMs - CACHE_SKEW_MS) {
    return cachedToken;
  }
  // Coalesce concurrent misses onto one round-trip.
  if (!inFlightToken) {
    inFlightToken = fetchNativeToken(false).finally(() => {
      inFlightToken = null;
    });
  }
  return inFlightToken;
}

async function fetchNativeToken(forceRefresh: boolean): Promise<string | null> {
  const response = await sendNative({ type: 'GET_ACCESS_TOKEN', forceRefresh });
  if (!response || !response.ok || !response.accessToken) {
    clearNativeTokenCache();
    return null;
  }
  cachedToken = response.accessToken;
  cachedExpiresAtMs = (response.expiresAt ?? 0) * 1000;
  return cachedToken;
}

/** Drop the cached token so the next request re-asks the app. */
export function clearNativeTokenCache(): void {
  cachedToken = null;
  cachedExpiresAtMs = 0;
  inFlightToken = null;
}

/** Whether the container app currently holds a signed-in session. */
export async function getNativeAuthStatus(): Promise<boolean> {
  const response = await sendNative({ type: 'AUTH_STATUS' });
  return response?.ok === true && response.status === 'signed_in';
}

/** Tell the app to wipe its session, and drop our cached token. Fail-closed on bridge error. */
export async function signOutNative(): Promise<void> {
  clearNativeTokenCache();
  await sendNative({ type: 'SIGN_OUT' });
}

/**
 * Hand the app the in-Safari sign-in result: it exchanges the one-time code (+PKCE verifier) into
 * the shared Keychain. Returns whether the app is now signed in (bead em9).
 */
export async function completeSignInNative(code: string, codeVerifier: string): Promise<boolean> {
  clearNativeTokenCache();
  const response = await sendNative({ type: 'COMPLETE_SIGN_IN', code, codeVerifier });
  return response?.ok === true && response.status === 'signed_in';
}
