/**
 * Background authentication monitoring for Quotewise Chrome extension
 * Monitors OAuth token status and updates extension badge
 */

import { AuthChecker } from '../auth/auth-checker';
import { apiClient } from '../api/quotewise-api';
import type { AuthStatus, AuthError, AuthChangeEvent, AuthBadgeState, AuthMonitoringConfig } from '../types/auth';
import { debugLog } from '../config/environment';

/**
 * Manages background authentication monitoring and badge updates
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
      checkInterval: config.checkInterval || 1800000, // 30 minutes (reduced from 5 minutes)
      maxRetries: config.maxRetries || 3,
      timeoutDuration: config.timeoutDuration || 10000 // 10 seconds
    };

    this.setupMessageListeners();
    // Only start monitoring when explicitly needed
    // this.startMonitoring();
  }

  /**
   * Start periodic authentication monitoring
   */
  startMonitoring(): void {
    debugLog('Starting authentication monitoring...');
    
    // Do initial check
    this.checkAuthenticationStatus();

    // Set up periodic monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.checkAuthenticationStatus();
    }, this.config.checkInterval);

    debugLog(`Authentication monitoring started with ${this.config.checkInterval / 1000}s interval`);
  }

  /**
   * Stop authentication monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      debugLog('Authentication monitoring stopped');
    }
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
        this.updateBadgeState('unauthenticated');
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

    // Update badge based on current status
    this.updateBadgeFromAuthStatus(authStatus);
  }

  /**
   * Handle authentication error
   */
  private handleAuthError(authError: AuthError): void {
    debugLog('Authentication error (background):', authError);
    
    // Update badge to show unauthenticated state
    this.updateBadgeState('unauthenticated');

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
   * Update extension badge based on authentication status
   */
  private updateBadgeFromAuthStatus(authStatus: AuthStatus): void {
    if (!authStatus.isAuthenticated) {
      this.updateBadgeState('unauthenticated');
    } else if (!authStatus.isStaff) {
      this.updateBadgeState('insufficient_privileges');
    } else {
      this.updateBadgeState('authenticated');
    }
  }

  /**
   * Update extension badge and title (global state, doesn't override tab-specific badges)
   */
  private async updateBadgeState(state: AuthBadgeState): Promise<void> {
    const badgeConfig = this.getBadgeConfig(state);
    
    try {
      // Get the active tab to check if it has a tab-specific badge
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        if (tabId) {
          // Check if this tab already has a tab-specific badge (from tweet processing)
          const tabBadge = await chrome.action.getBadgeText({ tabId });
          if (tabBadge && (tabBadge === '✓' || tabBadge === '○')) {
            // Don't override tweet processing badges, just update the default state
            chrome.action.setBadgeText({ text: badgeConfig.text });
            chrome.action.setBadgeBackgroundColor({ color: badgeConfig.color });
            chrome.action.setTitle({ title: badgeConfig.title });
            return;
          }
        }
      }
      
      // Set global badge state (will be used when no tab-specific badge exists)
      chrome.action.setBadgeText({ text: badgeConfig.text });
      chrome.action.setBadgeBackgroundColor({ color: badgeConfig.color });
      chrome.action.setTitle({ title: badgeConfig.title });
    } catch (error) {
      // Fallback to simple badge update if tab querying fails
      console.error('Error checking tab badge state:', error);
      chrome.action.setBadgeText({ text: badgeConfig.text });
      chrome.action.setBadgeBackgroundColor({ color: badgeConfig.color });
      chrome.action.setTitle({ title: badgeConfig.title });
    }
  }

  /**
   * Get badge configuration for auth state
   */
  private getBadgeConfig(state: AuthBadgeState): { text: string; color: string; title: string } {
    switch (state) {
      case 'authenticated':
        return {
          text: '', // No badge text - just regular colored icon
          color: '#1a73e8', // Regular blue color when authenticated
          title: 'Quotewise Extension - Authenticated and ready'
        };
      
      case 'unauthenticated':
        return {
          text: '', // No badge text - greyed out icon
          color: '#9AA0A6', // Grey color for unauthenticated
          title: 'Quotewise Extension - Login required'
        };
      
      case 'insufficient_privileges':
        return {
          text: '?',
          color: '#FF9800',
          title: 'Quotewise Extension - Admin privileges required'
        };
      
      case 'checking':
        return {
          text: '…',
          color: '#2196F3',
          title: 'Quotewise Extension - Checking authentication'
        };
      
      default:
        return {
          text: '',
          color: '#607D8B',
          title: 'Quotewise Extension'
        };
    }
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
   */
  getCurrentAuthStatus(): AuthStatus | null {
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