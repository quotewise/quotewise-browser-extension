/**
 * Token storage module for OAuth 2.0 tokens
 * All tokens stored in chrome.storage.local (persistent across browser restarts)
 */

import type { OAuthTokens, OAuthTokenResponse } from '../types/oauth';
import { debugLog } from '../config/environment';

/** Storage keys */
const ACCESS_TOKEN_KEY = 'oauth_access_token';
const ACCESS_TOKEN_EXPIRES_KEY = 'oauth_access_token_expires';
const REFRESH_TOKEN_KEY = 'oauth_refresh_token';
const REFRESH_TOKEN_EXPIRES_KEY = 'oauth_refresh_token_expires';
const TOKEN_SCOPES_KEY = 'oauth_scopes';

/** Default token lifetimes */
const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 3600; // 1 hour
const REFRESH_TOKEN_LIFETIME_DAYS = 90;

/**
 * Store OAuth tokens after successful authorization or refresh
 */
export async function storeTokens(response: OAuthTokenResponse): Promise<OAuthTokens> {
  const now = Date.now();

  // Calculate expiry timestamps
  const accessTokenExpiresAt = now + (response.expires_in * 1000);

  // Refresh token uses 90-day sliding window
  const refreshTokenExpiresAt = now + (REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  // Parse scopes from response
  const scopes = response.scope ? response.scope.split(' ') : [];

  // Store all tokens in local storage (persistent across browser restarts)
  await chrome.storage.local.set({
    [ACCESS_TOKEN_KEY]: response.access_token,
    [ACCESS_TOKEN_EXPIRES_KEY]: accessTokenExpiresAt,
    [REFRESH_TOKEN_KEY]: response.refresh_token,
    [REFRESH_TOKEN_EXPIRES_KEY]: refreshTokenExpiresAt,
    [TOKEN_SCOPES_KEY]: scopes,
  });

  debugLog('Tokens stored successfully');

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    scopes,
  };
}

/**
 * Get stored OAuth tokens
 * Returns null if no tokens are stored
 */
export async function getStoredTokens(): Promise<OAuthTokens | null> {
  const localData = await chrome.storage.local.get([
    ACCESS_TOKEN_KEY,
    ACCESS_TOKEN_EXPIRES_KEY,
    REFRESH_TOKEN_KEY,
    REFRESH_TOKEN_EXPIRES_KEY,
    TOKEN_SCOPES_KEY,
  ]);

  const accessToken = localData[ACCESS_TOKEN_KEY] as string | undefined;
  const accessTokenExpiresAt = localData[ACCESS_TOKEN_EXPIRES_KEY] as number | undefined;
  const refreshToken = localData[REFRESH_TOKEN_KEY] as string | undefined;
  const refreshTokenExpiresAt = localData[REFRESH_TOKEN_EXPIRES_KEY] as number | undefined;
  const scopes = (localData[TOKEN_SCOPES_KEY] as string[] | undefined) || [];

  // If we don't have a refresh token, we're not authenticated
  if (!refreshToken) {
    return null;
  }

  return {
    accessToken: accessToken || '',
    refreshToken,
    accessTokenExpiresAt: accessTokenExpiresAt || 0,
    refreshTokenExpiresAt: refreshTokenExpiresAt || 0,
    scopes,
  };
}

/**
 * Get only the access token if valid
 * Returns null if no valid access token exists
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await getStoredTokens();

  if (!tokens || !tokens.accessToken) {
    return null;
  }

  // Check if access token is expired (with 30-second buffer)
  if (tokens.accessTokenExpiresAt < Date.now() + 30000) {
    return null;
  }

  return tokens.accessToken;
}

/**
 * Get the refresh token
 * Returns null if no refresh token exists or it's expired
 */
export async function getRefreshToken(): Promise<string | null> {
  const localData = await chrome.storage.local.get([
    REFRESH_TOKEN_KEY,
    REFRESH_TOKEN_EXPIRES_KEY,
  ]);

  const refreshToken = localData[REFRESH_TOKEN_KEY] as string | undefined;
  const refreshTokenExpiresAt = localData[REFRESH_TOKEN_EXPIRES_KEY] as number | undefined;

  if (!refreshToken) {
    return null;
  }

  // Check if refresh token is expired
  if (refreshTokenExpiresAt && refreshTokenExpiresAt < Date.now()) {
    debugLog('Refresh token expired');
    return null;
  }

  return refreshToken;
}

/**
 * Check if access token is valid (exists and not expired)
 */
export async function isAccessTokenValid(): Promise<boolean> {
  const accessToken = await getAccessToken();
  return accessToken !== null;
}

/**
 * Check if we have a valid refresh token
 */
export async function hasValidRefreshToken(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  return refreshToken !== null;
}

/**
 * Get time until access token expires in milliseconds
 * Returns 0 if token is expired or doesn't exist
 */
export async function getAccessTokenExpiresIn(): Promise<number> {
  const tokens = await getStoredTokens();

  if (!tokens || !tokens.accessTokenExpiresAt) {
    return 0;
  }

  const expiresIn = tokens.accessTokenExpiresAt - Date.now();
  return Math.max(0, expiresIn);
}

/**
 * Update access token after refresh (keeps existing refresh token metadata)
 */
export async function updateAccessToken(
  accessToken: string,
  expiresIn: number = DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS
): Promise<void> {
  const accessTokenExpiresAt = Date.now() + (expiresIn * 1000);

  await chrome.storage.local.set({
    [ACCESS_TOKEN_KEY]: accessToken,
    [ACCESS_TOKEN_EXPIRES_KEY]: accessTokenExpiresAt,
  });

  debugLog('Access token updated');
}

/**
 * Update refresh token after rotation
 */
export async function updateRefreshToken(refreshToken: string): Promise<void> {
  const refreshTokenExpiresAt = Date.now() + (REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  await chrome.storage.local.set({
    [REFRESH_TOKEN_KEY]: refreshToken,
    [REFRESH_TOKEN_EXPIRES_KEY]: refreshTokenExpiresAt,
  });

  debugLog('Refresh token rotated');
}

/**
 * Clear all stored tokens (logout)
 */
export async function clearTokens(): Promise<void> {
  await chrome.storage.local.remove([
    ACCESS_TOKEN_KEY,
    ACCESS_TOKEN_EXPIRES_KEY,
    REFRESH_TOKEN_KEY,
    REFRESH_TOKEN_EXPIRES_KEY,
    TOKEN_SCOPES_KEY,
  ]);

  debugLog('All tokens cleared');
}

/**
 * Check if user has a specific scope
 */
export async function hasScope(scope: string): Promise<boolean> {
  const tokens = await getStoredTokens();
  return tokens?.scopes.includes(scope) ?? false;
}

/**
 * Get all granted scopes
 */
export async function getScopes(): Promise<string[]> {
  const tokens = await getStoredTokens();
  return tokens?.scopes ?? [];
}
