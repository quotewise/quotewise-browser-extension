/**
 * OAuth 2.0 type definitions for the Quotewise Chrome Extension
 */

/**
 * OAuth token data stored in chrome.storage
 */
export interface OAuthTokens {
  /** Access token for API authorization */
  accessToken: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Unix timestamp (ms) when access token expires */
  accessTokenExpiresAt: number;
  /** Unix timestamp (ms) when refresh token expires */
  refreshTokenExpiresAt: number;
  /** Granted OAuth scopes */
  scopes: string[];
}

/**
 * OAuth token response from /oauth/token endpoint
 */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope?: string;
}

/**
 * OAuth error response
 */
export interface OAuthError {
  error: OAuthErrorCode;
  error_description?: string;
  error_uri?: string;
}

/**
 * Standard OAuth error codes
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'expired_token'
  | 'authorization_pending'
  | 'slow_down'
  | 'token_family_revoked';

/**
 * PKCE parameters for authorization request
 */
export interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/**
 * Result of a token refresh attempt
 */
export type TokenRefreshResult =
  | { success: true; tokens: OAuthTokens }
  | { success: false; error: 'expired' | 'revoked' | 'network_error'; message?: string };

/**
 * OAuth configuration per environment
 */
export interface OAuthConfig {
  /** Pre-registered OAuth client ID */
  clientId: string;
  /** Authorization endpoint URL */
  authorizeUrl: string;
  /** Token endpoint URL */
  tokenUrl: string;
  /** Redirect URI for launchWebAuthFlow */
  redirectUri: string;
  /** Requested OAuth scopes */
  scopes: string[];
}

/**
 * Authorization callback result
 */
export interface AuthCallbackResult {
  code: string;
  state: string;
}

/**
 * OAuth flow state stored during authorization
 */
export interface OAuthFlowState {
  codeVerifier: string;
  state: string;
  startedAt: number;
}
