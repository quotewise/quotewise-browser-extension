/**
 * Background authentication monitoring for Quotewise Chrome extension
 *
 * NOTE: This class is being deprecated in favor of AuthStateManager.
 * AuthStateManager is now the single source of truth for auth state.
 * This class remains for backwards compatibility with existing code
 * that calls getCurrentAuthStatus() or forceAuthCheck().
 *
 * @deprecated Use AuthStateManager instead
 */

import { AuthChecker } from '../auth/auth-checker';
import { apiClient } from '../api/quotewise-api';
import type { AuthStatus, AuthError, AuthChangeEvent, AuthMonitoringConfig } from '../types/auth';
import { debugLog } from '../config/environment';
import { AuthStateManager } from '../auth/auth-state-manager';
import { AuthState } from '../auth/auth-state-machine';

/**
 * Manages background authentication monitoring and badge updates
 * @deprecated Use AuthStateManager instead - this is kept for backwards compatibility
 */
export class AuthenticationMonitor {
  private authChecker: AuthChecker;
  private lastAuthStatus: AuthStatus | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private config: AuthMonitoringConfig;
  private retryCount = 0;

  constructor(config: Partial<AuthMonitoringConfig> = {}) {
    this.authChecker = new AuthChecker(apiClient);
    this.config = {
      checkInterval: config.checkInterval || 1800000, // 30 minutes
      maxRetries: config.maxRetries || 3,
      timeoutDuration: config.timeoutDuration || 10000 // 10 seconds
    };

    // Note: Message listeners are now handled by AuthStateManager
    // Note: Periodic monitoring is now handled by AuthStateManager
    debugLog('AuthenticationMonitor initialized (deprecated - use AuthStateManager)');
  }

  /**
   * Start periodic authentication monitoring
   * @deprecated AuthStateManager handles periodic monitoring now
   */
  startMonitoring(): void {
    debugLog('startMonitoring() called - delegating to AuthStateManager');
    // AuthStateManager handles periodic monitoring via alarms
    // Just trigger an initial check
    if (AuthStateManager.isInitialized()) {
      AuthStateManager.getInstance().checkAuthState();
    }
  }

  /**
   * Stop authentication monitoring
   * @deprecated AuthStateManager handles monitoring now
   */
  stopMonitoring(): void {
    debugLog('stopMonitoring() called - no-op (AuthStateManager handles monitoring)');
    // No-op - AuthStateManager manages its own alarms
  }

  /**
   * Check current authentication status
   */
  private async checkAuthenticationStatus(): Promise<void> {
    try {
      debugLog('Checking authentication status (background)...');
      
      const authResult = await this.authChecker.checkAuthStatus();
      
      if ('type' in authResult) {
        // Authentication error
        this.handleAuthError(authResult);
      } else {
        // Valid authentication status
        this.handleAuthSuccess(authResult);
        this.retryCount = 0; // Reset retry count on success
      }

    } catch (error) {
      console.error('Background auth check failed:', error);
      this.retryCount++;
      
      if (this.retryCount <= this.config.maxRetries) {
        debugLog(`Retrying auth check (${this.retryCount}/${this.config.maxRetries})`);
        // Retry with exponential backoff
        setTimeout(() => {
          this.checkAuthenticationStatus();
        }, Math.min(1000 * Math.pow(2, this.retryCount), 30000));
      } else {
        // Max retries exceeded
        console.warn('Max auth check retries exceeded');
        this.retryCount = 0; // Reset for next interval
      }
    }
  }

  /**
   * Handle successful authentication result
   */
  private handleAuthSuccess(authStatus: AuthStatus): void {
    const statusChanged = this.hasAuthStatusChanged(authStatus);
    
    if (statusChanged) {
      debugLog('Authentication status changed:', authStatus);
      
      const changeEvent: AuthChangeEvent = {
        type: 'AUTH_STATUS_CHANGED',
        previousStatus: this.lastAuthStatus,
        currentStatus: authStatus,
        timestamp: Date.now()
      };

      // Notify interested parties
      this.notifyAuthStatusChange(changeEvent);
      
      this.lastAuthStatus = authStatus;
    }
  }

  /**
   * Handle authentication error
   */
  private handleAuthError(authError: AuthError): void {
    debugLog('Authentication error (background):', authError);
    
    // If we had a previous authenticated status, notify about the change
    if (this.lastAuthStatus && this.lastAuthStatus.isAuthenticated) {
      const changeEvent: AuthChangeEvent = {
        type: 'AUTH_STATUS_CHANGED',
        previousStatus: this.lastAuthStatus,
        currentStatus: {
          isAuthenticated: false,
          isStaff: false
        },
        timestamp: Date.now()
      };

      this.notifyAuthStatusChange(changeEvent);
      this.lastAuthStatus = null;
    }
  }

  /**
   * Check if authentication status has meaningfully changed
   */
  private hasAuthStatusChanged(newStatus: AuthStatus): boolean {
    if (!this.lastAuthStatus) return true;

    return (
      this.lastAuthStatus.isAuthenticated !== newStatus.isAuthenticated ||
      this.lastAuthStatus.isStaff !== newStatus.isStaff ||
      this.lastAuthStatus.username !== newStatus.username
    );
  }

  /**
   * Notify about authentication status changes
   */
  private notifyAuthStatusChange(changeEvent: AuthChangeEvent): void {
    // Send message to popup if it's open
    chrome.runtime.sendMessage(changeEvent).catch(() => {
      // Ignore errors - popup might not be open
    });

    // Store latest auth status for popup access
    chrome.storage.local.set({
      lastAuthCheck: {
        status: changeEvent.currentStatus,
        timestamp: changeEvent.timestamp
      }
    });
  }

  /**
   * Set up message listeners for authentication requests
   */
  private setupMessageListeners(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_AUTH_STATUS') {
        // Provide current auth status immediately
        if (this.lastAuthStatus) {
          sendResponse(this.lastAuthStatus);
        } else {
          // Trigger immediate check if no cached status
          this.checkAuthenticationStatus().then(() => {
            sendResponse(this.lastAuthStatus);
          }).catch((error) => {
            sendResponse({ error: error.message });
          });
        }
        return true; // Indicate async response
      }

      if (message.type === 'REFRESH_AUTH_STATUS') {
        // Force immediate auth check
        this.checkAuthenticationStatus().then(() => {
          sendResponse({ success: true, status: this.lastAuthStatus });
        }).catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
        return true; // Indicate async response
      }
    });
  }

  /**
   * Get current authentication status (for external access)
   * @deprecated Use AuthStateManager.getInstance().getStateData() instead
   */
  getCurrentAuthStatus(): AuthStatus | null {
    // Delegate to AuthStateManager if available
    if (AuthStateManager.isInitialized()) {
      const stateData = AuthStateManager.getInstance().getStateData();
      if (stateData.state === AuthState.AUTHENTICATED) {
        return {
          isAuthenticated: true,
          isStaff: stateData.scopes?.includes('quotes:write') ?? false,
          username: stateData.username,
          scopes: stateData.scopes,
        };
      }
      return {
        isAuthenticated: false,
        isStaff: false,
      };
    }
    return this.lastAuthStatus;
  }

  /**
   * Force immediate authentication check
   */
  async forceAuthCheck(): Promise<AuthStatus | AuthError> {
    return await this.authChecker.checkAuthStatus();
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(newConfig: Partial<AuthMonitoringConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart monitoring with new config
    if (this.monitoringInterval) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }
}
