/**
 * Authentication status checker for Quotewise Chrome extension
 * Integrates with Django session authentication patterns
 */

import type { QuotewiseApiClient } from '../types/api';
import type { AuthStatus, AuthError } from '../types/auth';
import { debugLog } from '../config/environment';

/**
 * Checks authentication status against Django backend
 * Handles session validation and staff privilege checking
 */
export class AuthChecker {
  constructor(private apiClient: QuotewiseApiClient) {}

  /**
   * Check current authentication status with Django backend
   * Uses /api/v1/auth/status/ endpoint (matches Django patterns)
   */
  async checkAuthStatus(): Promise<AuthStatus | AuthError> {
    try {
      debugLog('Checking authentication status...');
      
      // Call Django auth status endpoint
      const response = await this.apiClient.checkAuthStatus();
      
      if (!response.authenticated) {
        return {
          type: 'not_authenticated',
          message: 'Please log in to Quotewise',
          requiresLogin: true
        };
      }

      // Convert API response to AuthStatus
      const authStatus: AuthStatus = {
        isAuthenticated: response.authenticated,
        isStaff: response.is_admin || false, // Map is_admin to isStaff
        username: response.user?.username,
        sessionExpiry: response.sessionExpiry
      };

      // Calculate session age if expiry provided
      if (response.sessionExpiry) {
        const expiryTime = new Date(response.sessionExpiry).getTime();
        const currentTime = Date.now();
        authStatus.sessionAge = Math.max(0, Math.floor((expiryTime - currentTime) / 1000));
      }

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
   * Wait for authentication changes after login redirect
   * Polls for authentication status with configurable timeout
   */
  async waitForAuthChange(timeout = 30000): Promise<AuthStatus> {
    debugLog('Waiting for authentication change...');
    const startTime = Date.now();
    const pollInterval = 1000; // Check every second

    while (Date.now() - startTime < timeout) {
      const status = await this.checkAuthStatus();

      if ('isAuthenticated' in status && status.isAuthenticated) {
        debugLog('Authentication detected:', status);
        return status;
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
        message: 'Administrator privileges required for quote submission',
        requiresLogin: false
      };
    }

    // Check session expiration
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
   * Check if session is near expiration (within 10 minutes)
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
    
    return authStatus.username || 'Unknown user';
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
      return 'Logged in (no admin access)';
    }

    const username = authStatus.username || 'user';
    const sessionInfo = authStatus.sessionAge 
      ? ` (session expires in ${Math.floor(authStatus.sessionAge / 60)}m)`
      : '';

    return `Logged in as ${username}${sessionInfo}`;
  }
}