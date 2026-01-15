/**
 * PKCE (Proof Key for Code Exchange) implementation for OAuth 2.0
 * RFC 7636: https://tools.ietf.org/html/rfc7636
 */

import type { PKCEParams, OAuthFlowState } from '../types/oauth';

/** Storage key for PKCE flow state */
const FLOW_STATE_KEY = 'oauth_flow_state';

/**
 * Generate a cryptographically random code verifier
 * Per RFC 7636: 43-128 characters, unreserved URI characters
 */
export function generateCodeVerifier(length = 64): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Derive code challenge from code verifier using SHA-256 (S256 method)
 * Per RFC 7636: BASE64URL(SHA256(code_verifier))
 */
export async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hashBuffer));
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(length = 32): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate complete PKCE parameters for authorization request
 */
export async function generatePKCEParams(): Promise<PKCEParams> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  const state = generateState();

  return {
    codeVerifier,
    codeChallenge,
    state,
  };
}

/**
 * Store PKCE flow state in session storage for later verification
 * Uses chrome.storage.session which is cleared on browser close
 */
export async function storeFlowState(codeVerifier: string, state: string): Promise<void> {
  const flowState: OAuthFlowState = {
    codeVerifier,
    state,
    startedAt: Date.now(),
  };
  await chrome.storage.session.set({ [FLOW_STATE_KEY]: flowState });
}

/**
 * Retrieve and clear PKCE flow state from session storage
 * Returns null if state doesn't exist or has expired (10 minute timeout)
 */
export async function retrieveAndClearFlowState(): Promise<OAuthFlowState | null> {
  const result = await chrome.storage.session.get(FLOW_STATE_KEY);
  const flowState = result[FLOW_STATE_KEY] as OAuthFlowState | undefined;

  // Clear the state regardless of validity
  await chrome.storage.session.remove(FLOW_STATE_KEY);

  if (!flowState) {
    return null;
  }

  // Check for 10-minute expiration
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  if (Date.now() - flowState.startedAt > TEN_MINUTES_MS) {
    return null;
  }

  return flowState;
}

/**
 * Validate that callback state matches stored state
 */
export function validateState(callbackState: string, storedState: string): boolean {
  // Constant-time comparison to prevent timing attacks
  if (callbackState.length !== storedState.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < callbackState.length; i++) {
    result |= callbackState.charCodeAt(i) ^ storedState.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Base64 URL encode without padding
 * Per RFC 7636: BASE64URL encoding
 */
function base64UrlEncode(buffer: Uint8Array): string {
  // Convert to base64
  let base64 = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    base64 += String.fromCharCode(bytes[i]);
  }
  base64 = btoa(base64);

  // Convert to base64url (replace + with -, / with _, remove padding)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
