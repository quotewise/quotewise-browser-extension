/**
 * Handle Lookup Component for Quotewise Chrome Extension
 * Automatically looks up originators by Twitter handle
 */

import type { OriginatorSearchResult } from '../types/api';
import { MessageType } from '../types/chrome';
import { debugLog } from '../config/environment';

export interface HandleLookupState {
  isLooking: boolean;
  hasLookedUp: boolean;
  result: 'found' | 'not_found' | 'error' | null;
  matchedOriginator: OriginatorSearchResult | null;
  createUrl: string | null;
  matchedHandle: string | null;
  errorMessage: string | null;
}

export type HandleLookupListener = (state: HandleLookupState) => void;

/**
 * HandleLookup manages the state and API calls for looking up
 * originators by their social media handle.
 */
export class HandleLookup {
  private state: HandleLookupState;
  private listeners: HandleLookupListener[] = [];
  private currentLookupHandle: string | null = null;

  constructor() {
    this.state = this.getInitialState();
  }

  private getInitialState(): HandleLookupState {
    return {
      isLooking: false,
      hasLookedUp: false,
      result: null,
      matchedOriginator: null,
      createUrl: null,
      matchedHandle: null,
      errorMessage: null
    };
  }

  /**
   * Add state change listener
   */
  addListener(listener: HandleLookupListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get current state
   */
  getState(): HandleLookupState {
    return { ...this.state };
  }

  /**
   * Get matched originator if found
   */
  getMatchedOriginator(): OriginatorSearchResult | null {
    return this.state.matchedOriginator;
  }

  /**
   * Check if lookup found an originator
   */
  hasMatch(): boolean {
    return this.state.result === 'found' && this.state.matchedOriginator !== null;
  }

  /**
   * Perform lookup by Twitter handle
   */
  async lookupByHandle(
    handle: string,
    platform: string = 'twitter'
  ): Promise<HandleLookupState> {
    if (!handle?.trim()) {
      return this.state;
    }

    const cleanHandle = handle.trim().replace(/^@/, '');

    // If we're already looking up this handle, don't start another request
    if (this.state.isLooking && this.currentLookupHandle === cleanHandle) {
      return this.state;
    }

    this.currentLookupHandle = cleanHandle;

    this.updateState({
      isLooking: true,
      hasLookedUp: false,
      result: null,
      matchedOriginator: null,
      createUrl: null,
      matchedHandle: cleanHandle,
      errorMessage: null
    });

    try {
      debugLog(`Looking up originator by handle: @${cleanHandle}`);

      interface LookupResponse {
        success?: boolean;
        error?: string;
        found: boolean;
        originator?: OriginatorSearchResult;
        create_url?: string;
      }

      const response = await new Promise<LookupResponse>((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: MessageType.LOOKUP_ORIGINATOR_BY_HANDLE,
          data: { handle: cleanHandle, platform }
        }, (response: LookupResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      // Check if this is still the current lookup (handle race conditions)
      if (this.currentLookupHandle !== cleanHandle) {
        debugLog(`Ignoring stale lookup response for @${cleanHandle}`);
        return this.state;
      }

      if (response.success === false) {
        throw new Error(response.error || 'Lookup failed');
      }

      if (response.found && response.originator) {
        debugLog(`Found originator: ${response.originator.full_name}`);
        this.updateState({
          isLooking: false,
          hasLookedUp: true,
          result: 'found',
          matchedOriginator: response.originator,
          createUrl: null,
          matchedHandle: cleanHandle,
          errorMessage: null
        });
      } else {
        debugLog(`No originator found for @${cleanHandle}`);
        this.updateState({
          isLooking: false,
          hasLookedUp: true,
          result: 'not_found',
          matchedOriginator: null,
          createUrl: response.create_url || null,
          matchedHandle: cleanHandle,
          errorMessage: null
        });
      }

      return this.state;

    } catch (error) {
      // Check if this is still the current lookup
      if (this.currentLookupHandle !== cleanHandle) {
        return this.state;
      }

      console.error('Handle lookup error:', error);
      this.updateState({
        isLooking: false,
        hasLookedUp: true,
        result: 'error',
        matchedOriginator: null,
        createUrl: null,
        matchedHandle: cleanHandle,
        errorMessage: error instanceof Error ? error.message : 'Lookup failed'
      });

      return this.state;
    }
  }

  /**
   * Reset lookup state
   */
  reset(): void {
    this.currentLookupHandle = null;
    this.state = this.getInitialState();
    this.notifyListeners();
  }

  /**
   * Dismiss the lookup result (user chooses to search manually)
   */
  dismiss(): void {
    this.updateState({
      hasLookedUp: false,
      result: null
    });
  }

  private updateState(updates: Partial<HandleLookupState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('Error in handle lookup listener:', error);
      }
    });
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.currentLookupHandle = null;
    this.listeners.length = 0;
  }
}
