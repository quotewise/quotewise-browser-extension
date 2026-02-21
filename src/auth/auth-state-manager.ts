/**
 * Auth State Manager - Centralized authentication state for service worker
 * Single source of truth for auth state across the entire extension
 *
 * Key design principles:
 * - State persisted to chrome.storage.local (survives browser restarts)
 * - Broadcasts state changes to all listeners (popup, overlay, content scripts)
 * - Integrates with existing AuthChecker for token validation
 */

import {
  AuthState,
  AuthStateData,
  AUTH_STATE_STORAGE_KEY,
  createInitialAuthState,
  isValidTransition,
  getStateBadgeText,
  getStateBadgeColor,
  getStateMessage,
} from './auth-state-machine';
import { AuthChecker } from './auth-checker';
import { apiClient } from '../api/quotewise-api';
import { debugLog } from '../config/environment';
import { MessageType } from '../types/chrome';
import {
  getStoredTokens,
  hasValidRefreshToken,
} from './token-storage';

/**
 * Singleton AuthStateManager for the service worker
 * Call initializeAuthStateManager() once at service worker startup
 */
let instance: AuthStateManager | null = null;

export class AuthStateManager {
  private stateData: AuthStateData;
  private authChecker: AuthChecker;
  private refreshCheckAlarmName = 'auth-state-refresh-check';

  private constructor() {
    this.stateData = createInitialAuthState();
    this.authChecker = new AuthChecker(apiClient);
  }

  /**
   * Initialize the auth state manager
   * Call this ONCE at service worker startup
   */
  static async initialize(): Promise<AuthStateManager> {
    if (instance) {
      debugLog('AuthStateManager already initialized');
      return instance;
    }

    instance = new AuthStateManager();
    await instance.restoreState();
    instance.setupMessageListeners();
    instance.setupAlarms();

    debugLog('AuthStateManager initialized, state:', instance.stateData.state);
    return instance;
  }

  /**
   * Get the singleton instance
   * Throws if not initialized
   */
  static getInstance(): AuthStateManager {
    if (!instance) {
      throw new Error('AuthStateManager not initialized. Call initialize() first.');
    }
    return instance;
  }

  /**
   * Check if manager is initialized
   */
  static isInitialized(): boolean {
    return instance !== null;
  }

  /**
   * Restore state from chrome.storage.local after service worker or browser restart
   */
  private async restoreState(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(AUTH_STATE_STORAGE_KEY);
      const storedState = stored[AUTH_STATE_STORAGE_KEY] as AuthStateData | undefined;

      if (storedState) {
        this.stateData = storedState;
        debugLog('Restored auth state from storage:', storedState.state);

        // Re-check if state is transitional OR if we claim to be authenticated
        // (need to re-validate tokens on service worker restart to catch expired sessions)
        if (
          storedState.state === AuthState.CHECKING ||
          storedState.state === AuthState.AUTHENTICATING ||
          storedState.state === AuthState.UNKNOWN ||
          storedState.state === AuthState.AUTHENTICATED
        ) {
          await this.checkAuthState();
        }
      } else {
        // No stored state, do initial check
        await this.checkAuthState();
      }
    } catch (error) {
      console.error('Error restoring auth state:', error);
      await this.checkAuthState();
    }
  }

  /**
   * Persist current state to chrome.storage.local
   */
  private async persistState(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [AUTH_STATE_STORAGE_KEY]: this.stateData,
      });
    } catch (error) {
      console.error('Error persisting auth state:', error);
    }
  }

  /**
   * Transition to a new state with validation
   */
  private async transitionTo(
    newState: AuthState,
    data?: Partial<Omit<AuthStateData, 'state' | 'lastCheckedAt'>>
  ): Promise<void> {
    const oldState = this.stateData.state;

    // Allow same-state updates (e.g., refreshing auth data)
    if (oldState !== newState && !isValidTransition(oldState, newState)) {
      console.warn(`Invalid state transition: ${oldState} -> ${newState}`);
      return;
    }

    this.stateData = {
      ...this.stateData,
      ...data,
      state: newState,
      lastCheckedAt: Date.now(),
    };

    await this.persistState();
    await this.updateBadge();

    // Broadcast state change to all listeners
    if (oldState !== newState) {
      debugLog(`Auth state transition: ${oldState} -> ${newState}`);
      await this.broadcastStateChange();
    }
  }

  /**
   * Check authentication state using tokens
   */
  async checkAuthState(): Promise<AuthState> {
    await this.transitionTo(AuthState.CHECKING);

    try {
      // Quick check: do we have any refresh token?
      const hasRefresh = await hasValidRefreshToken();

      if (!hasRefresh) {
        await this.transitionTo(AuthState.UNAUTHENTICATED);
        return AuthState.UNAUTHENTICATED;
      }

      // Check access token validity
      const authResult = await this.authChecker.checkAuthStatus();

      if ('type' in authResult) {
        // AuthError returned
        switch (authResult.type) {
          case 'session_expired':
            await this.transitionTo(AuthState.SESSION_EXPIRED, {
              error: authResult.message,
            });
            return AuthState.SESSION_EXPIRED;

          case 'insufficient_privileges':
            await this.transitionTo(AuthState.INSUFFICIENT_PRIVILEGES, {
              error: authResult.message,
            });
            return AuthState.INSUFFICIENT_PRIVILEGES;

          case 'network_error':
            // Network error is transient. If we were previously authenticated,
            // stay authenticated rather than forcing re-login. The user still
            // has a valid refresh token - the server is just temporarily unreachable.
            if (this.stateData.state === AuthState.CHECKING) {
              // We were checking from a previously-known state.
              // Check if we have a valid refresh token (sign we were authenticated).
              const hasRefresh = await hasValidRefreshToken();
              if (hasRefresh) {
                debugLog('Network error during auth check, but refresh token exists - preserving auth state');
                await this.transitionTo(AuthState.AUTHENTICATED, {
                  error: 'Network error - using cached credentials',
                });
                return AuthState.AUTHENTICATED;
              }
            }
            // Fall through to UNAUTHENTICATED if no refresh token
            await this.transitionTo(AuthState.UNAUTHENTICATED, {
              error: authResult.message,
            });
            return AuthState.UNAUTHENTICATED;

          case 'not_authenticated':
          default:
            await this.transitionTo(AuthState.UNAUTHENTICATED, {
              error: authResult.message,
            });
            return AuthState.UNAUTHENTICATED;
        }
      }

      // AuthStatus returned - authenticated
      const tokens = await getStoredTokens();

      await this.transitionTo(AuthState.AUTHENTICATED, {
        username: authResult.username,
        scopes: tokens?.scopes,
        expiresAt: tokens?.accessTokenExpiresAt,
        error: undefined,
      });

      return AuthState.AUTHENTICATED;

    } catch (error) {
      console.error('Error checking auth state:', error);
      await this.transitionTo(AuthState.UNAUTHENTICATED, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return AuthState.UNAUTHENTICATED;
    }
  }

  /**
   * Called when OAuth flow is starting
   */
  async startAuthenticating(): Promise<void> {
    await this.transitionTo(AuthState.AUTHENTICATING);
  }

  /**
   * Called when OAuth flow completes successfully
   */
  async onAuthSuccess(username?: string, scopes?: string[]): Promise<void> {
    const tokens = await getStoredTokens();
    await this.transitionTo(AuthState.AUTHENTICATED, {
      username,
      scopes: scopes || tokens?.scopes,
      expiresAt: tokens?.accessTokenExpiresAt,
      error: undefined,
    });
  }

  /**
   * Called when OAuth flow fails or is cancelled
   */
  async onAuthFailure(error?: string): Promise<void> {
    await this.transitionTo(AuthState.UNAUTHENTICATED, {
      error,
    });
  }

  /**
   * Called when user logs out
   */
  async onLogout(): Promise<void> {
    await this.transitionTo(AuthState.UNAUTHENTICATED, {
      username: undefined,
      scopes: undefined,
      expiresAt: undefined,
      error: undefined,
    });
  }

  /**
   * Called when token refresh succeeds
   */
  async onTokenRefreshed(): Promise<void> {
    const tokens = await getStoredTokens();
    await this.transitionTo(AuthState.AUTHENTICATED, {
      expiresAt: tokens?.accessTokenExpiresAt,
    });
  }

  /**
   * Called when token refresh fails
   */
  async onTokenRefreshFailed(): Promise<void> {
    await this.transitionTo(AuthState.SESSION_EXPIRED, {
      error: 'Session expired, please log in again',
    });
  }

  /**
   * Get current state
   */
  getState(): AuthState {
    return this.stateData.state;
  }

  /**
   * Get full state data
   */
  getStateData(): AuthStateData {
    return { ...this.stateData };
  }

  /**
   * Check if currently authenticated
   */
  isAuthenticated(): boolean {
    return this.stateData.state === AuthState.AUTHENTICATED;
  }

  /**
   * Update the extension badge based on current state
   * For error states (SESSION_EXPIRED), also update all tab-specific badges
   * so the red "!" shows through everywhere, overriding any tweet-page badges.
   */
  private async updateBadge(): Promise<void> {
    const text = getStateBadgeText(this.stateData.state);
    const color = getStateBadgeColor(this.stateData.state);
    const title = `Quotewise - ${getStateMessage(this.stateData.state)}`;

    try {
      // Set global badge
      await chrome.action.setBadgeText({ text });
      await chrome.action.setBadgeBackgroundColor({ color });
      await chrome.action.setTitle({ title });

      // For SESSION_EXPIRED (actual error), also clear tab-specific badges
      // so the red "!" shows through everywhere (overrides any tweet-page badges)
      if (this.stateData.state === AuthState.SESSION_EXPIRED) {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id) {
            await chrome.action.setBadgeText({ tabId: tab.id, text });
            await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color });
            await chrome.action.setTitle({ tabId: tab.id, title });
          }
        }
      }
    } catch (error) {
      // Badge update may fail if no active tabs
      debugLog('Badge update error:', error);
    }
  }

  /**
   * Broadcast state change to all extension contexts
   */
  private async broadcastStateChange(): Promise<void> {
    const message = {
      type: MessageType.AUTH_STATE_CHANGED,
      data: this.getStateData(),
    };

    // Send to extension pages (popup)
    try {
      await chrome.runtime.sendMessage(message);
    } catch {
      // No listeners, that's fine
    }

    // Send to all content scripts
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, message);
          } catch {
            // Tab doesn't have content script, that's fine
          }
        }
      }
    } catch (error) {
      debugLog('Error broadcasting to tabs:', error);
    }
  }

  /**
   * Setup message listeners for auth state requests
   */
  private setupMessageListeners(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        // Return current state immediately
        sendResponse({
          success: true,
          data: this.getStateData(),
        });
        return false; // Synchronous response
      }

      if (message.type === MessageType.AUTH_STATE_SUBSCRIBE) {
        // Content script wants to subscribe - just send current state
        // They'll get updates via AUTH_STATE_CHANGED broadcasts
        sendResponse({
          success: true,
          data: this.getStateData(),
        });
        return false;
      }

      // Handle legacy CHECK_AUTH_STATUS message
      if (message.type === MessageType.CHECK_AUTH_STATUS) {
        const state = this.getStateData();
        sendResponse({
          isAuthenticated: state.state === AuthState.AUTHENTICATED,
          scopes: state.scopes,
          username: state.username,
        });
        return false;
      }
    });
  }

  /**
   * Setup alarms for periodic auth state checks
   */
  private setupAlarms(): void {
    // Clear any existing alarm
    chrome.alarms.clear(this.refreshCheckAlarmName);

    // Check auth state every 30 minutes
    chrome.alarms.create(this.refreshCheckAlarmName, {
      periodInMinutes: 30,
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === this.refreshCheckAlarmName) {
        debugLog('Periodic auth state check triggered');
        this.checkAuthState();
      }
    });
  }
}

/**
 * Initialize the auth state manager
 * Call this at service worker startup
 */
export async function initializeAuthStateManager(): Promise<AuthStateManager> {
  return AuthStateManager.initialize();
}

/**
 * Get the auth state manager instance
 */
export function getAuthStateManager(): AuthStateManager {
  return AuthStateManager.getInstance();
}
