/**
 * Storage cleanup service for Chrome extension
 * Handles periodic cleanup of stale data in chrome.storage.local
 */

import { debugLog } from '../config/environment';

/**
 * chrome.alarms name for the recurring storage-cleanup pass. Used here to
 * schedule the alarm and by the service worker's top-level onAlarm listener
 * to dispatch it (MV3-safe; see startPeriodicCleanup).
 */
export const STORAGE_CLEANUP_ALARM = 'storage-cleanup';

export const USER_IDENTIFYING_CACHE_KEYS = [
  'currentPost',
  'currentTweet',
  'preloadedOriginator',
  'preloadedDuplicateCheck',
  'collectionsCache',
  'lastAuthCheck',
  'originator_search_history',
] as const;

interface StoredTweetData {
  data: Record<string, unknown>;
  timestamp: number;
  url: string;
}

interface StoredAuthCheck {
  status: Record<string, unknown>;
  timestamp: number;
}

interface StorageCleanupConfig {
  // How often to run cleanup (in milliseconds)
  cleanupInterval: number;
  // Max age for different data types (in milliseconds)
  maxAge: {
    tweets: number;
    authChecks: number;
    searchHistory: number;
  };
}

/**
 * Storage cleanup service
 */
export class StorageCleanupService {
  private config: StorageCleanupConfig;
  
  constructor(config?: Partial<StorageCleanupConfig>) {
    // 3 weeks in milliseconds (matches typical session/token lifetime)
    const threeWeeksMs = 3 * 7 * 24 * 60 * 60 * 1000;

    this.config = {
      // Run cleanup every 6 hours
      cleanupInterval: 6 * 60 * 60 * 1000,
      maxAge: {
        // Tweet data expires after 24 hours (tweets change frequently)
        tweets: 24 * 60 * 60 * 1000,
        // Auth checks expire after 1 hour (auth status changes)
        authChecks: 60 * 60 * 1000,
        // Search history expires after 3 weeks
        searchHistory: threeWeeksMs
      },
      ...config
    };
  }
  
  /**
   * Start periodic cleanup.
   *
   * Schedules recurring cleanup via chrome.alarms rather than setInterval: MV3
   * service workers are ephemeral and a setInterval timer is canceled when the
   * worker terminates, so periodic cleanup would silently stop. The alarm
   * survives worker restarts. Creation is idempotent by name — only (re)create
   * the alarm when it is missing so we don't reset the schedule on every wake.
   * The alarm fires StorageCleanupService.runCleanup() via the service worker's
   * top-level onAlarm listener.
   *
   * @param quiet - If true, suppress startup logs (used during service worker init)
   */
  public async startPeriodicCleanup(quiet = false): Promise<void> {
    // Run cleanup immediately (quiet on startup)
    await this.runCleanup(quiet);

    const existing = await chrome.alarms.get(STORAGE_CLEANUP_ALARM);
    if (!existing) {
      chrome.alarms.create(STORAGE_CLEANUP_ALARM, {
        periodInMinutes: this.config.cleanupInterval / 60_000,
      });
    }
  }

  /**
   * Stop periodic cleanup by clearing the recurring alarm.
   */
  public stopPeriodicCleanup(): void {
    void chrome.alarms.clear(STORAGE_CLEANUP_ALARM);
    debugLog('Periodic storage cleanup alarm cleared');
  }
  
  /**
   * Run cleanup immediately
   * @param quiet - If true, suppress logs unless items were cleaned
   */
  public async runCleanup(quiet = false): Promise<void> {
    try {
      const now = Date.now();
      let totalCleaned = 0;

      // Clean up tweets
      totalCleaned += await this.cleanupTweets(now);

      // Clean up auth checks
      totalCleaned += await this.cleanupAuthChecks(now);

      // Clean up search history
      totalCleaned += await this.cleanupSearchHistory(now);

      // Only log if items were actually cleaned (or if not quiet mode)
      if (totalCleaned > 0 || !quiet) {
        debugLog(`Storage cleanup: ${totalCleaned} items cleaned`);
      }
    } catch (error) {
      console.error('Error during storage cleanup:', error);
    }
  }
  
  /**
   * Clean up stale tweet data
   */
  private async cleanupTweets(now: number): Promise<number> {
    try {
      const result = await chrome.storage.local.get(['currentPost', 'currentTweet']);
      const currentPost = result.currentPost as StoredTweetData | undefined;
      const currentTweet = result.currentTweet as StoredTweetData | undefined;
      const storedPost = currentPost ?? currentTweet;
      
      if (!storedPost) {
        return 0;
      }
      
      const age = now - storedPost.timestamp;
      if (age > this.config.maxAge.tweets) {
        await chrome.storage.local.remove(['currentPost', 'currentTweet']);
        debugLog(`Cleaned up stale post data (age: ${Math.round(age / (60 * 60 * 1000))}h)`);
        return 1;
      }
      
      return 0;
    } catch (error) {
      console.error('Error cleaning up tweets:', error);
      return 0;
    }
  }
  
  /**
   * Clean up stale auth check data
   */
  private async cleanupAuthChecks(now: number): Promise<number> {
    try {
      const result = await chrome.storage.local.get(['lastAuthCheck']);
      const lastAuthCheck = result.lastAuthCheck as StoredAuthCheck | undefined;
      
      if (!lastAuthCheck) {
        return 0;
      }
      
      const age = now - lastAuthCheck.timestamp;
      if (age > this.config.maxAge.authChecks) {
        await chrome.storage.local.remove(['lastAuthCheck']);
        debugLog(`Cleaned up stale auth check (age: ${Math.round(age / (60 * 1000))}m)`);
        return 1;
      }
      
      return 0;
    } catch (error) {
      console.error('Error cleaning up auth checks:', error);
      return 0;
    }
  }
  
  /**
   * Clean up stale search history
   */
  private async cleanupSearchHistory(now: number): Promise<number> {
    try {
      const result = await chrome.storage.local.get(['originator_search_history']);
      const searchHistory = result.originator_search_history;
      
      if (!searchHistory || !Array.isArray(searchHistory)) {
        return 0;
      }
      
      const originalLength = searchHistory.length;
      const filteredHistory = searchHistory.filter((item: { searchedAt?: string }) => {
        if (!item.searchedAt) {
          return false; // Remove items without timestamp
        }

        const searchTime = new Date(item.searchedAt).getTime();
        const age = now - searchTime;
        return age <= this.config.maxAge.searchHistory;
      });
      
      const cleanedCount = originalLength - filteredHistory.length;
      
      if (cleanedCount > 0) {
        await chrome.storage.local.set({
          originator_search_history: filteredHistory
        });
        debugLog(`Cleaned up ${cleanedCount} stale search history items`);
      }
      
      return cleanedCount;
    } catch (error) {
      console.error('Error cleaning up search history:', error);
      return 0;
    }
  }
  
  /**
   * Get storage usage statistics
   */
  public async getStorageStats(): Promise<{
    tweets: { count: number; oldestAge: number | null };
    authChecks: { count: number; age: number | null };
    searchHistory: { count: number; oldestAge: number | null };
  }> {
    const now = Date.now();
    const stats = {
      tweets: { count: 0, oldestAge: null as number | null },
      authChecks: { count: 0, age: null as number | null },
      searchHistory: { count: 0, oldestAge: null as number | null }
    };
    
    try {
      const result = await chrome.storage.local.get([
        'currentPost',
        'currentTweet',
        'lastAuthCheck', 
        'originator_search_history'
      ]);
      
      // Check tweets
      if (result.currentPost || result.currentTweet) {
        stats.tweets.count = 1;
        stats.tweets.oldestAge = now - (result.currentPost ?? result.currentTweet).timestamp;
      }
      
      // Check auth
      if (result.lastAuthCheck) {
        stats.authChecks.count = 1;
        stats.authChecks.age = now - result.lastAuthCheck.timestamp;
      }
      
      // Check search history
      if (result.originator_search_history && Array.isArray(result.originator_search_history)) {
        const history = result.originator_search_history;
        stats.searchHistory.count = history.length;
        
        if (history.length > 0) {
          const timestamps = history
            .map((item: { searchedAt?: string }) => new Date(item.searchedAt || '').getTime())
            .filter((time: number) => !isNaN(time));
          
          if (timestamps.length > 0) {
            const oldestTime = Math.min(...timestamps);
            stats.searchHistory.oldestAge = now - oldestTime;
          }
        }
      }
      
      return stats;
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return stats;
    }
  }
}

/**
 * Global storage cleanup service instance
 */
let storageCleanupService: StorageCleanupService | null = null;

/**
 * Initialize storage cleanup service
 */
export function initializeStorageCleanup(config?: Partial<StorageCleanupConfig>): StorageCleanupService {
  if (!storageCleanupService) {
    storageCleanupService = new StorageCleanupService(config);
  }
  return storageCleanupService;
}

/**
 * Get the current storage cleanup service instance
 */
export function getStorageCleanupService(): StorageCleanupService | null {
  return storageCleanupService;
}
