/**
 * Auth Subscriber - Helper for popup and content scripts to subscribe to auth state
 *
 * Usage:
 *   const subscriber = new AuthSubscriber((state) => {
 *     console.log('Auth state changed:', state);
 *     updateUI(state);
 *   });
 *
 *   // Get initial state
 *   const initialState = await subscriber.getState();
 *
 *   // Cleanup when component unmounts
 *   subscriber.unsubscribe();
 */

import { AuthState, AuthStateData, getStateMessage, isAuthenticated, requiresLogin } from './auth-state-machine';
import { MessageType } from '../types/chrome';
import { debugLog } from '../config/environment';

export type AuthStateCallback = (state: AuthStateData) => void;

/**
 * Helper class for components to subscribe to auth state changes
 */
export class AuthSubscriber {
  private callback: AuthStateCallback;
  private messageListener: ((message: unknown) => void) | null = null;
  private currentState: AuthStateData | null = null;

  constructor(callback: AuthStateCallback) {
    this.callback = callback;
    this.setupMessageListener();
  }

  /**
   * Get current auth state from service worker
   */
  async getState(): Promise<AuthStateData> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.AUTH_STATE_GET,
      });

      if (response?.success && response?.data) {
        this.currentState = response.data as AuthStateData;
        return this.currentState;
      }

      // Fallback to unknown state
      return this.createFallbackState();
    } catch (error) {
      debugLog('Error getting auth state:', error);
      return this.createFallbackState();
    }
  }

  /**
   * Subscribe to state changes and get initial state
   * Returns initial state, then callback is invoked on changes
   */
  async subscribe(): Promise<AuthStateData> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.AUTH_STATE_SUBSCRIBE,
      });

      if (response?.success && response?.data) {
        this.currentState = response.data as AuthStateData;
        return this.currentState;
      }

      return this.createFallbackState();
    } catch (error) {
      debugLog('Error subscribing to auth state:', error);
      return this.createFallbackState();
    }
  }

  /**
   * Trigger OAuth login flow via service worker
   */
  async login(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.OAUTH_LOGIN,
      });

      return {
        success: response?.success === true,
        error: response?.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed',
      };
    }
  }

  /**
   * Trigger logout via service worker
   */
  async logout(): Promise<{ success: boolean }> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.OAUTH_LOGOUT,
      });

      return { success: response?.success === true };
    } catch {
      return { success: false };
    }
  }

  /**
   * Stop listening for state changes
   */
  unsubscribe(): void {
    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
    }
  }

  /**
   * Get cached current state (may be stale)
   */
  getCachedState(): AuthStateData | null {
    return this.currentState;
  }

  /**
   * Check if currently authenticated (from cached state)
   */
  isAuthenticated(): boolean {
    return this.currentState?.state === AuthState.AUTHENTICATED;
  }

  /**
   * Check if login is required (from cached state)
   */
  requiresLogin(): boolean {
    if (!this.currentState) return true;
    return requiresLogin(this.currentState.state);
  }

  /**
   * Get display message for current state
   */
  getStatusMessage(): string {
    if (!this.currentState) return 'Loading...';
    return getStateMessage(this.currentState.state);
  }

  /**
   * Setup message listener for state changes
   */
  private setupMessageListener(): void {
    this.messageListener = (message: unknown) => {
      const msg = message as { type?: MessageType; data?: AuthStateData };

      if (msg.type === MessageType.AUTH_STATE_CHANGED && msg.data) {
        debugLog('Auth state changed notification:', msg.data.state);
        this.currentState = msg.data;
        this.callback(msg.data);
      }
    };

    chrome.runtime.onMessage.addListener(this.messageListener);
  }

  /**
   * Create fallback state when service worker is unavailable
   */
  private createFallbackState(): AuthStateData {
    return {
      state: AuthState.UNKNOWN,
      lastCheckedAt: Date.now(),
      error: 'Unable to connect to service worker',
    };
  }
}

/**
 * Convenience function to check auth state once (no subscription)
 */
export async function checkAuthState(): Promise<AuthStateData> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.AUTH_STATE_GET,
    });

    if (response?.success && response?.data) {
      return response.data as AuthStateData;
    }

    return {
      state: AuthState.UNKNOWN,
      lastCheckedAt: Date.now(),
    };
  } catch (error) {
    debugLog('Error checking auth state:', error);
    return {
      state: AuthState.UNKNOWN,
      lastCheckedAt: Date.now(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Convenience function to check if user is authenticated
 */
export async function isUserAuthenticated(): Promise<boolean> {
  const state = await checkAuthState();
  return state.state === AuthState.AUTHENTICATED;
}

/**
 * Wait for authentication to complete (useful after triggering login)
 */
export async function waitForAuthentication(timeoutMs: number = 30000): Promise<AuthStateData> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const subscriber = new AuthSubscriber((state) => {
      if (state.state === AuthState.AUTHENTICATED) {
        subscriber.unsubscribe();
        resolve(state);
      } else if (
        state.state === AuthState.UNAUTHENTICATED &&
        Date.now() - startTime > 5000 // Give OAuth flow time to start
      ) {
        subscriber.unsubscribe();
        reject(new Error('Authentication failed or was cancelled'));
      }
    });

    // Timeout handler
    setTimeout(() => {
      subscriber.unsubscribe();
      reject(new Error('Authentication timeout'));
    }, timeoutMs);

    // Check initial state
    subscriber.getState().then((state) => {
      if (state.state === AuthState.AUTHENTICATED) {
        subscriber.unsubscribe();
        resolve(state);
      }
    });
  });
}
