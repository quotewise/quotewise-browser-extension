/**
 * Login handler for Quotewise Chrome extension
 * Uses OAuth 2.0 Authorization Code flow with PKCE
 */

import { debugLog } from '../config/environment';
import { initiateOAuthFlow, logout, OAuthFlowError } from './auth-flow';
import { hasValidRefreshToken } from './token-storage';
import type { OAuthTokens } from '../types/oauth';

/**
 * Result of a login attempt
 */
export interface LoginResult {
  success: boolean;
  tokens?: OAuthTokens;
  error?: string;
  recoverable?: boolean;
}

/**
 * Handles OAuth login flow for the extension
 */
export class LoginHandler {
  private isLoginInProgress = false;

  /**
   * Initiate login flow using OAuth 2.0
   * Opens authorization popup via chrome.identity.launchWebAuthFlow
   */
  async login(): Promise<LoginResult> {
    if (this.isLoginInProgress) {
      return {
        success: false,
        error: 'Login already in progress',
        recoverable: true
      };
    }

    this.isLoginInProgress = true;
    debugLog('Starting OAuth login flow');

    try {
      const tokens = await initiateOAuthFlow();
      debugLog('OAuth login successful');

      return {
        success: true,
        tokens
      };
    } catch (error) {
      console.error('OAuth login failed:', error);

      if (error instanceof OAuthFlowError) {
        return {
          success: false,
          error: error.message,
          recoverable: error.recoverable
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown login error',
        recoverable: true
      };
    } finally {
      this.isLoginInProgress = false;
    }
  }

  /**
   * Logout and clear all tokens
   */
  async logout(): Promise<void> {
    debugLog('Logging out');
    await logout();
  }

  /**
   * Check if user is currently authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return await hasValidRefreshToken();
  }

  /**
   * Check if login is currently in progress
   */
  isLoggingIn(): boolean {
    return this.isLoginInProgress;
  }
}