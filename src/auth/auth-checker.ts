/**
 * Authentication status checker for Quotewise Chrome extension
 * Uses OAuth 2.0 token-based authentication
 */

import type { QuotewiseApiClient } from '../types/api';
import type { AuthStatus, AuthError } from '../types/auth';
import { debugLog } from '../config/environment';
import {
  getStoredTokens,
  isAccessTokenValid,
  hasValidRefreshToken,
  getAccessTokenExpiresIn,
  hasScope,
} from './token-storage';
import { attemptTokenRefresh } from './token-refresh';
import { isSafariExtension, getNativeAuthStatus } from './native-bridge';

/**
 * Checks authentication status using OAuth tokens
 * Provides fast local validation with optional backend verification
 */
export class AuthChecker {
  constructor(private apiClient: QuotewiseApiClient) {}

  /**
   * Check current authentication status
   * Fast path: Uses local token validation
   * Falls back to API check if needed
   */
  async checkAuthStatus(): Promise<AuthStatus | AuthError> {
    // Safari: the container app owns auth (spec 002). Local storage never holds tokens there, so
    // derive status from the native bridge — otherwise the capture UI sees an empty local store and
    // shows a bogus login prompt (which then crashes on chrome.identity.launchWebAuthFlow).
    if (isSafariExtension()) {
      const signedIn = await getNativeAuthStatus();
      if (!signedIn) {
        return {
          type: 'not_authenticated',
          message: 'Sign in from the Quotewise app to capture quotes.',
          requiresLogin: true,
        };
      }
      return {
        isAuthenticated: true,
        isStaff: true, // the app's OAuth grants quotes:write
        username: undefined,
        sessionAge: 0,
        scopes: ['quotes:read', 'quotes:write', 'collections:read', 'collections:write'],
      };
    }

    try {
      debugLog('Checking authentication status...');

      // Fast path: Check if we have valid tokens locally
      const tokens = await getStoredTokens();

      if (!tokens || !tokens.refreshToken) {
        return {
          type: 'not_authenticated',
          message: 'Please log in to Quotewise',
          requiresLogin: true
        };
      }

      // Check if access token is valid
      const hasValidAccess = await isAccessTokenValid();

      if (!hasValidAccess) {
        // Try to refresh the token
        debugLog('Access token expired, attempting refresh');
        const refreshResult = await attemptTokenRefresh();

        if (!refreshResult.success) {
          if (refreshResult.error === 'revoked') {
            return {
              type: 'session_expired',
              message: refreshResult.message || 'Your session was revoked. Please log in again.',
              requiresLogin: true
            };
          }

          if (refreshResult.error === 'network_error') {
            // Network error is transient - user still has a valid refresh token.
            // Don't treat this as "not authenticated" which would force re-login.
            return {
              type: 'network_error',
              message: refreshResult.message || 'Unable to refresh session',
              requiresLogin: false
            };
          }

          // Token genuinely expired (invalid_grant, expired_token)
          return {
            type: 'not_authenticated',
            message: refreshResult.message || 'Please log in to Quotewise',
            requiresLogin: true
          };
        }
      }

      // Derive permissions from scopes
      const canWrite = await hasScope('quotes:write');

      // Get token expiry info
      const expiresInMs = await getAccessTokenExpiresIn();
      const expiresInSeconds = Math.floor(expiresInMs / 1000);

      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: canWrite, // quotes:write scope implies staff-level access
        username: undefined, // Token doesn't contain username, could fetch from API if needed
        sessionAge: expiresInSeconds,
        scopes: tokens.scopes
      };

      debugLog('Authentication status:', authStatus);
      return authStatus;

    } catch (error) {
      console.error('Error checking authentication status:', error);

      if (error instanceof Error && error.name === 'AuthenticationError') {
        return {
          type: 'not_authenticated',
          message: 'Please log in to Quotewise',
          requiresLogin: true
        };
      }

      return {
        type: 'network_error',
        message: 'Unable to check authentication status',
        requiresLogin: false
      };
    }
  }

  /**
   * Quick check if user is authenticated (no network call)
   */
  async isAuthenticated(): Promise<boolean> {
    return await hasValidRefreshToken();
  }

  /**
   * Wait for authentication changes after OAuth flow
   * Polls local storage for token presence
   */
  async waitForAuthChange(timeout = 30000): Promise<AuthStatus> {
    debugLog('Waiting for authentication change...');
    const startTime = Date.now();
    const pollInterval = 500; // Check every 500ms

    while (Date.now() - startTime < timeout) {
      const hasRefresh = await hasValidRefreshToken();

      if (hasRefresh) {
        const status = await this.checkAuthStatus();
        if ('isAuthenticated' in status && status.isAuthenticated) {
          debugLog('Authentication detected:', status);
          return status;
        }
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Authentication timeout - no login detected within ' + (timeout / 1000) + ' seconds');
  }

  /**
   * Validate that user has required privileges for quote submission
   */
  validatePrivileges(authStatus: AuthStatus): AuthError | null {
    if (!authStatus.isAuthenticated) {
      return {
        type: 'not_authenticated',
        message: 'Please log in to Quotewise',
        requiresLogin: true
      };
    }

    if (!authStatus.isStaff) {
      return {
        type: 'insufficient_privileges',
        message: 'Quote submission permission required',
        requiresLogin: false
      };
    }

    // Check token expiration
    if (authStatus.sessionAge !== undefined && authStatus.sessionAge <= 0) {
      return {
        type: 'session_expired',
        message: 'Your session has expired. Please log in again.',
        requiresLogin: true
      };
    }

    return null; // User has valid authentication and privileges
  }

  /**
   * Check if token is near expiration (within 10 minutes)
   */
  isSessionNearExpiry(authStatus: AuthStatus): boolean {
    if (!authStatus.sessionAge) return false;

    const tenMinutes = 10 * 60; // 10 minutes in seconds
    return authStatus.sessionAge <= tenMinutes;
  }

  /**
   * Get user display name for UI
   */
  getUserDisplayName(authStatus: AuthStatus): string {
    if (!authStatus.isAuthenticated) return 'Not logged in';

    return authStatus.username || 'Authenticated user';
  }

  /**
   * Get authentication status summary for display
   */
  getStatusSummary(authStatus: AuthStatus | AuthError): string {
    if ('type' in authStatus) {
      // It's an AuthError
      return authStatus.message;
    }

    if (!authStatus.isAuthenticated) {
      return 'Not authenticated';
    }

    if (!authStatus.isStaff) {
      return 'Logged in (read-only access)';
    }

    const username = authStatus.username || 'user';
    const sessionInfo = authStatus.sessionAge
      ? ` (token expires in ${Math.floor(authStatus.sessionAge / 60)}m)`
      : '';

    return `Logged in as ${username}${sessionInfo}`;
  }
}