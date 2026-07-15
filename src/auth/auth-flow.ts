/**
 * OAuth 2.0 Authorization Code Flow with PKCE
 * Uses chrome.identity.launchWebAuthFlow() for browser-based authentication
 */

import type { OAuthTokens, OAuthTokenResponse, OAuthError, AuthCallbackResult } from '../types/oauth';
import { getOAuthConfig } from '../config/environment';
import { debugLog } from '../config/environment';
import { generatePKCEParams, storeFlowState, retrieveAndClearFlowState, validateState } from './pkce';
import { storeTokens } from './token-storage';
import { scheduleTokenRefresh } from './token-refresh';
import { isSafariExtension } from './native-bridge';

/**
 * Error thrown during OAuth flow
 */
export class OAuthFlowError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

/**
 * Initiate the OAuth 2.0 Authorization Code flow with PKCE
 * Opens a popup for user authentication via launchWebAuthFlow
 */
export async function initiateOAuthFlow(): Promise<OAuthTokens> {
  // Safari has no chrome.identity.launchWebAuthFlow — sign-in happens in the container app, not the
  // extension (spec 002; CLAUDE.md caution). Fail with guidance instead of a TypeError crash.
  if (isSafariExtension()) {
    throw new OAuthFlowError('Please sign in from the Quotewise app.', 'safari_use_app', false);
  }

  const config = getOAuthConfig();
  debugLog('Starting OAuth flow with config:', { ...config, clientId: config.clientId });

  // Generate PKCE parameters
  const pkce = await generatePKCEParams();

  // Store flow state for validation after callback
  await storeFlowState(pkce.codeVerifier, pkce.state);

  // Build authorization URL
  const authUrl = buildAuthorizationUrl(config, pkce.codeChallenge, pkce.state);
  debugLog('Authorization URL:', authUrl);

  // Launch web auth flow
  const callbackUrl = await launchAuthFlow(authUrl);
  debugLog('Received callback URL');

  // Parse and validate callback
  const callbackResult = parseCallbackUrl(callbackUrl);

  // Retrieve stored flow state
  const flowState = await retrieveAndClearFlowState();
  if (!flowState) {
    throw new OAuthFlowError(
      'OAuth flow state expired or not found',
      'state_expired',
      true
    );
  }

  // Validate state parameter
  if (!validateState(callbackResult.state, flowState.state)) {
    throw new OAuthFlowError(
      'OAuth state mismatch - possible CSRF attack',
      'state_mismatch',
      false
    );
  }

  // Exchange authorization code for tokens
  const tokens = await exchangeCodeForTokens(
    callbackResult.code,
    flowState.codeVerifier,
    config
  );

  // Schedule proactive token refresh
  scheduleTokenRefresh(tokens.accessTokenExpiresAt);

  debugLog('OAuth flow completed successfully');
  return tokens;
}

/**
 * Build the authorization URL with all required parameters
 */
function buildAuthorizationUrl(
  config: ReturnType<typeof getOAuthConfig>,
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: config.scopes.join(' '),
    state,
  });

  return `${config.authorizeUrl}?${params.toString()}`;
}

/**
 * Launch the web authentication flow using Chrome's identity API
 */
async function launchAuthFlow(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true,
      },
      (callbackUrl) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || 'Unknown error';

          // Check for user cancellation
          if (errorMessage.includes('canceled') || errorMessage.includes('cancelled')) {
            reject(new OAuthFlowError(
              'User cancelled authentication',
              'user_cancelled',
              true
            ));
            return;
          }

          reject(new OAuthFlowError(
            `Authentication failed: ${errorMessage}`,
            'auth_failed',
            true
          ));
          return;
        }

        if (!callbackUrl) {
          reject(new OAuthFlowError(
            'No callback URL received',
            'no_callback',
            true
          ));
          return;
        }

        resolve(callbackUrl);
      }
    );
  });
}

/**
 * Parse the callback URL to extract authorization code and state
 */
function parseCallbackUrl(callbackUrl: string): AuthCallbackResult {
  const url = new URL(callbackUrl);
  const params = url.searchParams;

  // Check for error response
  const error = params.get('error');
  if (error) {
    const errorDescription = params.get('error_description') || 'Unknown error';
    throw new OAuthFlowError(
      errorDescription,
      error,
      error === 'access_denied' // User denied access is recoverable
    );
  }

  const code = params.get('code');
  const state = params.get('state');

  if (!code) {
    throw new OAuthFlowError(
      'Authorization code not found in callback',
      'missing_code',
      false
    );
  }

  if (!state) {
    throw new OAuthFlowError(
      'State parameter not found in callback',
      'missing_state',
      false
    );
  }

  return { code, state };
}

/**
 * Exchange authorization code for access and refresh tokens
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  config: ReturnType<typeof getOAuthConfig>
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
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
    const errorMessage = errorData.error_description || errorData.error || 'Token exchange failed';

    throw new OAuthFlowError(
      errorMessage,
      errorData.error || 'token_exchange_failed',
      errorData.error === 'invalid_grant' // Expired code is recoverable
    );
  }

  const tokenResponse = await response.json() as OAuthTokenResponse;

  // Store tokens and return
  return storeTokens(tokenResponse);
}

/**
 * Logout - clear all stored tokens and revoke if possible
 */
export async function logout(): Promise<void> {
  debugLog('Logging out - clearing session');

  // Wipe the session via the selected backend: Safari tells the container app (native SIGN_OUT and
  // drops the cached access token — otherwise the extension keeps submitting for ~1h); Chrome
  // clears its local tokens. Then clear any local refresh alarm.
  const { authBackend } = await import('./auth-backend');
  await authBackend.signOut();

  await chrome.alarms.clear('token-refresh');

  debugLog('Logout complete');
}

/**
 * Check if the user needs to re-authenticate
 * Returns true if there's no refresh token or it's expired
 */
export async function needsReauthentication(): Promise<boolean> {
  const { hasValidRefreshToken } = await import('./token-storage');
  return !(await hasValidRefreshToken());
}
