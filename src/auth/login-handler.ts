/**
 * Login handler for Quotewise Chrome extension
 * Manages login redirect flow and tab monitoring
 */

import type { LoginConfig, LoginTabInfo } from '../types/auth';
import { getEnvironmentConfig, detectEnvironment, debugLog } from '../config/environment';

/**
 * Handles login redirects and monitors login completion
 * Based on Django LOGIN_URL and LOGIN_REDIRECT_URL settings
 */
export class LoginHandler {
  private config: LoginConfig;
  private activeLoginTabs = new Map<number, LoginTabInfo>();

  constructor(environment?: string) {
    this.config = this.getLoginConfig(environment || detectEnvironment());
    this.setupTabListeners();
  }

  /**
   * Get login configuration for specified environment
   * Based on Django settings from quotewise/settings/base.py
   */
  private getLoginConfig(env: string): LoginConfig {
    const environmentConfig = getEnvironmentConfig(env);
    
    return {
      loginUrl: `${environmentConfig.apiBaseUrl}/accounts/login/`,      // Django LOGIN_URL
      redirectUrl: `${environmentConfig.apiBaseUrl}/`,                  // Django LOGIN_REDIRECT_URL
      environment: env as 'development' | 'staging' | 'production'
    };
  }

  /**
   * Open login page in new tab and monitor for completion
   */
  async openLoginPage(): Promise<void> {
    debugLog('Opening login page:', this.config.loginUrl);

    return new Promise((resolve, reject) => {
      chrome.tabs.create(
        { 
          url: this.config.loginUrl, 
          active: true 
        },
        (tab) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to create login tab:', chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!tab.id) {
            reject(new Error('Login tab created but no tab ID received'));
            return;
          }

          debugLog('Login tab created:', tab.id);
          
          // Store tab info for monitoring
          const loginTabInfo: LoginTabInfo = {
            tabId: tab.id,
            loginUrl: this.config.loginUrl,
            redirectUrl: this.config.redirectUrl,
            startTime: Date.now()
          };
          
          this.activeLoginTabs.set(tab.id, loginTabInfo);

          // Set up completion monitoring
          this.watchForLoginCompletion(tab.id, resolve, reject);
        }
      );
    });
  }

  /**
   * Monitor tab for login completion
   * Resolves when user is redirected to success page
   */
  private watchForLoginCompletion(
    tabId: number,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    debugLog('Watching for login completion on tab:', tabId);

    const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId !== tabId) return;

      // Only check when page has finished loading
      if (changeInfo.status === 'complete' && tab.url) {
        debugLog('Tab updated:', updatedTabId, tab.url);

        // Check if redirected to success page
        if (this.isSuccessfulLoginRedirect(tab.url)) {
          debugLog('Login success detected, cleaning up tab monitoring');
          this.cleanupTabMonitoring(tabId, onUpdated, onRemoved);
          resolve();
        }
        // Check if still on login page with error indicators
        else if (this.isLoginError(tab.url)) {
          debugLog('Login error detected:', tab.url);
          // Continue monitoring - don't fail yet, user might retry
        }
      }
    };

    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) {
        debugLog('Login tab was closed:', removedTabId);
        this.cleanupTabMonitoring(tabId, onUpdated, onRemoved);
        reject(new Error('Login tab was closed by user'));
      }
    };

    // Start monitoring
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    // Set timeout for login process (5 minutes)
    setTimeout(() => {
      if (this.activeLoginTabs.has(tabId)) {
        debugLog('Login timeout for tab:', tabId);
        this.cleanupTabMonitoring(tabId, onUpdated, onRemoved);
        reject(new Error('Login timeout - no login completion detected within 5 minutes'));
      }
    }, 300000); // 5 minutes
  }

  /**
   * Check if URL indicates successful login redirect
   */
  private isSuccessfulLoginRedirect(url: string): boolean {
    // Don't consider login pages as successful redirects
    if (url.includes('/accounts/login')) {
      return false;
    }

    // Check if redirected to main site (LOGIN_REDIRECT_URL)
    if (url.startsWith(this.config.redirectUrl)) {
      return true;
    }

    // Also check for common success patterns (but only if not on login page)
    const successPatterns = [
      '/dashboard',
      '/admin',
      '/?login=success'
    ];

    return successPatterns.some(pattern => url.includes(pattern));
  }

  /**
   * Check if URL indicates login error
   */
  private isLoginError(url: string): boolean {
    const errorPatterns = [
      'error=',
      'login_failed',
      'invalid_credentials',
      'account_disabled'
    ];

    return errorPatterns.some(pattern => url.includes(pattern));
  }

  /**
   * Clean up tab monitoring resources
   */
  private cleanupTabMonitoring(
    tabId: number,
    onUpdated: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void,
    onRemoved: (tabId: number) => void
  ): void {
    debugLog('Cleaning up tab monitoring for:', tabId);
    
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    this.activeLoginTabs.delete(tabId);
  }

  /**
   * Set up global tab listeners for cleanup
   */
  private setupTabListeners(): void {
    // Clean up any orphaned tab monitoring
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (this.activeLoginTabs.has(tabId)) {
        debugLog('Cleaning up orphaned login tab monitoring:', tabId);
        this.activeLoginTabs.delete(tabId);
      }
    });
  }

  /**
   * Get current login URL for the configured environment
   */
  getLoginUrl(): string {
    return this.config.loginUrl;
  }

  /**
   * Get redirect URL for the configured environment
   */
  getRedirectUrl(): string {
    return this.config.redirectUrl;
  }

  /**
   * Check if there are any active login tabs
   */
  hasActiveLoginTabs(): boolean {
    return this.activeLoginTabs.size > 0;
  }

  /**
   * Get information about active login tabs
   */
  getActiveLoginTabs(): LoginTabInfo[] {
    return Array.from(this.activeLoginTabs.values());
  }

  /**
   * Force cleanup of specific login tab
   */
  forceCleanupTab(tabId: number): void {
    if (this.activeLoginTabs.has(tabId)) {
      debugLog('Force cleaning up login tab:', tabId);
      this.activeLoginTabs.delete(tabId);
    }
  }

  /**
   * Open specific environment login (for testing/debugging)
   */
  async openEnvironmentLogin(environment: 'development' | 'staging' | 'production'): Promise<void> {
    const originalConfig = this.config;
    
    try {
      // Temporarily switch environment
      this.config = this.getLoginConfig(environment);
      await this.openLoginPage();
    } finally {
      // Restore original config
      this.config = originalConfig;
    }
  }
}