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

/** Maximum retry attempts for failed refresh */
const MAX_RETRY_ATTEMPTS = 3;

/** Retry delay multiplier for exponential backoff */
const RETRY_DELAY_MULTIPLIER = 2;

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

/**
 * Handle the token refresh alarm
 * Called when the alarm fires
 */
export async function handleTokenRefreshAlarm(): Promise<void> {
  debugLog('Token refresh alarm triggered');

  const result = await attemptTokenRefresh();

  if (result.success) {
    // Schedule next refresh
    scheduleTokenRefresh(result.tokens.accessTokenExpiresAt);
  } else {
    // Handle failure
    debugLog('Token refresh failed:', result.error);

    if (result.error === 'revoked') {
      // Token family was revoked (possible theft)
      // Clear all tokens and require re-authentication
      await clearTokens();
      notifyAuthRequired('Your session was revoked. Please log in again.');
    } else if (result.error === 'expired') {
      // Refresh token expired
      await clearTokens();
      notifyAuthRequired('Your session has expired. Please log in again.');
    } else {
      // Network error - retry with backoff
      scheduleRetry(1);
    }
  }
}

/**
 * Attempt to refresh the access token
 */
export async function attemptTokenRefresh(retryCount = 0): Promise<TokenRefreshResult> {
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

    // Network or other error
    if (retryCount < MAX_RETRY_ATTEMPTS) {
      debugLog(`Retry ${retryCount + 1}/${MAX_RETRY_ATTEMPTS} for token refresh`);
      const delay = MIN_REFRESH_INTERVAL_MS * Math.pow(RETRY_DELAY_MULTIPLIER, retryCount);
      await new Promise(resolve => setTimeout(resolve, delay));
      return attemptTokenRefresh(retryCount + 1);
    }

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
 * Notify the user that re-authentication is required
 * This should update the extension badge and state
 */
function notifyAuthRequired(message: string): void {
  debugLog('Auth required:', message);

  // Update badge to indicate auth needed
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF6B6B' });
  chrome.action.setTitle({ title: `Quotewise: ${message}` });

  // Store auth required state for popup/content script
  chrome.storage.local.set({ authRequired: true, authMessage: message });
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
    }
    // If refresh fails, the error handling in attemptTokenRefresh will handle it
  } else if (expiresIn < REFRESH_BUFFER_MS) {
    // Token expiring soon - refresh now
    debugLog('Access token expiring soon - refreshing');
    const result = await attemptTokenRefresh();

    if (result.success) {
      scheduleTokenRefresh(result.tokens.accessTokenExpiresAt);
    }
  } else {
    // Token still valid - schedule refresh for later
    scheduleTokenRefresh(tokens.accessTokenExpiresAt);
  }
}

/**
 * Clear auth required state (called after successful re-auth)
 */
export async function clearAuthRequiredState(): Promise<void> {
  await chrome.storage.local.remove(['authRequired', 'authMessage']);
}
