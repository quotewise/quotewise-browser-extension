/**
 * Token refresh scheduling and handling
 * Uses chrome.alarms for proactive refresh before expiry
 */

import type { OAuthTokens, OAuthTokenResponse, OAuthError, TokenRefreshResult } from '../types/oauth';
import { getOAuthConfig, debugLog } from '../config/environment';
import {
  getRefreshToken,
  storeTokens,
  clearTokens,
  getStoredTokens,
  getAccessTokenExpiresIn,
} from './token-storage';

/** Alarm name for token refresh */
const TOKEN_REFRESH_ALARM = 'token-refresh';

/** Refresh tokens 5 minutes before expiry */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Minimum time between refresh attempts */
const MIN_REFRESH_INTERVAL_MS = 60 * 1000;

/** Retry delay multiplier for exponential backoff (used by scheduleRetry via chrome.alarms) */
const RETRY_DELAY_MULTIPLIER = 2;

/**
 * Mutex for token refresh: prevents concurrent refresh attempts.
 * When multiple code paths try to refresh simultaneously (e.g., alarm handler
 * + service worker init + API 401 retry), only the first makes a server call.
 * Subsequent callers wait for and reuse the in-flight result.
 *
 * This is critical because Django OAuth Toolkit rotates refresh tokens on use.
 * A second concurrent refresh with the now-rotated old token gets invalid_grant,
 * which would incorrectly trigger token clearing and log the user out.
 */
let refreshInFlight: Promise<TokenRefreshResult> | null = null;

/**
 * Schedule a token refresh alarm
 * @param accessTokenExpiresAt Unix timestamp when access token expires
 */
export function scheduleTokenRefresh(accessTokenExpiresAt: number): void {
  const now = Date.now();
  const refreshTime = accessTokenExpiresAt - REFRESH_BUFFER_MS;
  const delayMs = Math.max(refreshTime - now, MIN_REFRESH_INTERVAL_MS);

  debugLog(`Scheduling token refresh in ${Math.round(delayMs / 1000)}s`);

  chrome.alarms.create(TOKEN_REFRESH_ALARM, {
    when: now + delayMs,
  });
}

/**
 * Cancel any scheduled token refresh
 */
export async function cancelTokenRefresh(): Promise<void> {
  await chrome.alarms.clear(TOKEN_REFRESH_ALARM);
  debugLog('Token refresh alarm cancelled');
}

/** Result of handling a token refresh alarm */
export interface TokenRefreshAlarmResult {
  /** Whether refresh succeeded */
  success: boolean;
  /** On success: 'refreshed'. On failure: 'revoked', 'expired', 'concurrent_refresh', 'network_error' */
  outcome: 'refreshed' | 'revoked' | 'expired' | 'concurrent_refresh' | 'network_error';
  /** Human-readable message for error states */
  message?: string;
}

/**
 * Handle the token refresh alarm.
 * Returns the result so the caller (service worker) can route it through AuthStateManager.
 * Does NOT directly manipulate badge, storage, or auth state — the caller owns that.
 */
export async function handleTokenRefreshAlarm(): Promise<TokenRefreshAlarmResult> {
  debugLog('Token refresh alarm triggered');

  // Snapshot the current refresh token BEFORE attempting refresh
  // so we can check if another path refreshed tokens while we were waiting
  const preRefreshToken = await getRefreshToken();

  const result = await attemptTokenRefresh();

  if (result.success) {
    // Schedule next refresh
    scheduleTokenRefresh(result.tokens.accessTokenExpiresAt);
    return { success: true, outcome: 'refreshed' };
  }

  // Handle failure
  debugLog('Token refresh failed:', result.error);

  if (result.error === 'revoked') {
    await clearTokens();
    return { success: false, outcome: 'revoked', message: 'Your session was revoked. Please log in again.' };
  }

  if (result.error === 'expired') {
    // Before clearing tokens, check if another code path already refreshed
    // successfully (which would have stored a new refresh token).
    const currentRefreshToken = await getRefreshToken();
    if (currentRefreshToken && currentRefreshToken !== preRefreshToken) {
      // Tokens were refreshed by another path - don't clear them
      debugLog('Tokens were refreshed by another path, skipping clear');
      const currentExpiresIn = await getAccessTokenExpiresIn();
      if (currentExpiresIn > 0) {
        scheduleTokenRefresh(Date.now() + currentExpiresIn);
      }
      return { success: true, outcome: 'concurrent_refresh' };
    }

    // Refresh token hasn't changed - it's genuinely expired
    await clearTokens();
    return { success: false, outcome: 'expired', message: 'Your session has expired. Please log in again.' };
  }

  // Network error - retry with backoff
  scheduleRetry(1);
  return { success: false, outcome: 'network_error', message: 'Network error during token refresh' };
}

/**
 * Attempt to refresh the access token.
 * Uses a mutex to ensure only one refresh is in-flight at a time.
 * Concurrent callers wait for and reuse the in-flight result.
 */
export async function attemptTokenRefresh(): Promise<TokenRefreshResult> {
  if (refreshInFlight) {
    debugLog('Token refresh already in-flight, waiting for result');
    return refreshInFlight;
  }

  const refreshPromise = doAttemptTokenRefresh();

  refreshInFlight = refreshPromise;
  refreshPromise.finally(() => {
    refreshInFlight = null;
  });

  return refreshPromise;
}

/**
 * Internal token refresh implementation (no mutex)
 */
async function doAttemptTokenRefresh(): Promise<TokenRefreshResult> {
  // Check if we're online
  if (!navigator.onLine) {
    debugLog('Offline - skipping token refresh');

    // Check if current token is still valid
    const expiresIn = await getAccessTokenExpiresIn();
    if (expiresIn > 0) {
      const tokens = await getStoredTokens();
      if (tokens) {
        return { success: true, tokens };
      }
    }

    return {
      success: false,
      error: 'network_error',
      message: 'Device is offline',
    };
  }

  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    return {
      success: false,
      error: 'expired',
      message: 'No refresh token available',
    };
  }

  try {
    const tokens = await refreshTokens(refreshToken);
    return { success: true, tokens };
  } catch (error) {
    if (error instanceof TokenRefreshError) {
      if (error.code === 'token_family_revoked') {
        return {
          success: false,
          error: 'revoked',
          message: error.message,
        };
      }

      if (error.code === 'invalid_grant' || error.code === 'expired_token') {
        return {
          success: false,
          error: 'expired',
          message: error.message,
        };
      }
    }

    // Network or other error — return immediately.
    // The alarm handler (handleTokenRefreshAlarm) owns retry scheduling via chrome.alarms,
    // which survives service worker termination (unlike setTimeout).
    return {
      success: false,
      error: 'network_error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Error thrown during token refresh
 */
class TokenRefreshError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'TokenRefreshError';
  }
}

/**
 * Refresh tokens using the refresh token
 */
async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const config = getOAuthConfig();

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as OAuthError;
    throw new TokenRefreshError(
      errorData.error_description || errorData.error || 'Token refresh failed',
      errorData.error || 'refresh_failed'
    );
  }

  const tokenResponse = await response.json() as OAuthTokenResponse;

  // Store the new tokens (includes rotated refresh token)
  return storeTokens(tokenResponse);
}

/**
 * Schedule a retry after a failed refresh attempt
 */
function scheduleRetry(attemptNumber: number): void {
  const delay = MIN_REFRESH_INTERVAL_MS * Math.pow(RETRY_DELAY_MULTIPLIER, attemptNumber - 1);

  debugLog(`Scheduling refresh retry ${attemptNumber} in ${delay / 1000}s`);

  chrome.alarms.create(TOKEN_REFRESH_ALARM, {
    delayInMinutes: delay / 60000,
  });
}

/**
 * Initialize token refresh on service worker startup
 * Restores refresh scheduling if tokens exist
 */
export async function initializeTokenRefresh(): Promise<void> {
  const tokens = await getStoredTokens();

  if (!tokens) {
    debugLog('No tokens found - skipping refresh initialization');
    return;
  }

  // Check if access token is expired or near expiry
  const expiresIn = await getAccessTokenExpiresIn();

  if (expiresIn <= 0) {
    // Token expired - attempt immediate refresh
    debugLog('Access token expired - attempting refresh');
    const result = await attemptTokenRefresh();

    if (result.success) {
      scheduleTokenRefresh(result.tokens.accessTokenExpiresAt);
    } else if (result.error === 'network_error') {
      // Transient failure on startup — schedule alarm-based retry
      // so we recover once network is available (survives SW termination)
      debugLog('Startup refresh failed (network) - scheduling alarm retry');
      scheduleRetry(1);
    }
  } else if (expiresIn < REFRESH_BUFFER_MS) {
    // Token expiring soon - refresh now
    debugLog('Access token expiring soon - refreshing');
    const result = await attemptTokenRefresh();

    if (result.success) {
      scheduleTokenRefresh(result.tokens.accessTokenExpiresAt);
    } else if (result.error === 'network_error') {
      debugLog('Startup refresh failed (network) - scheduling alarm retry');
      scheduleRetry(1);
    }
  } else {
    // Token still valid - schedule refresh for later
    scheduleTokenRefresh(tokens.accessTokenExpiresAt);
  }
}

