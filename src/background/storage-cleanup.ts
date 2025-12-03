/**
 * Storage cleanup service for Chrome extension
 * Handles periodic cleanup of stale data in chrome.storage.local
 */

import { getSessionConfig, detectEnvironment, debugLog } from '../config/environment';

interface StoredTweetData {
  data: any;
  timestamp: number;
  url: string;
}

interface StoredAuthCheck {
  status: any;
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
  private cleanupInterval: NodeJS.Timeout | null = null;
  private config: StorageCleanupConfig;
  
  constructor(config?: Partial<StorageCleanupConfig>) {
    // Get session max age from environment config (3 weeks = 1814400 seconds)
    const sessionConfig = getSessionConfig(detectEnvironment());
    const maxAgeMs = sessionConfig.maxAge * 1000; // Convert to milliseconds
    
    this.config = {
      // Run cleanup every 6 hours
      cleanupInterval: 6 * 60 * 60 * 1000,
      maxAge: {
        // Tweet data expires after 24 hours (tweets change frequently)
        tweets: 24 * 60 * 60 * 1000,
        // Auth checks expire after 1 hour (auth status changes)
        authChecks: 60 * 60 * 1000,
        // Search history expires after session max age (3 weeks)
        searchHistory: maxAgeMs
      },
      ...config
    };
    
    debugLog('Storage cleanup service initialized:', {
      cleanupInterval: this.config.cleanupInterval / (60 * 60 * 1000) + ' hours',
      maxAge: {
        tweets: this.config.maxAge.tweets / (60 * 60 * 1000) + ' hours',
        authChecks: this.config.maxAge.authChecks / (60 * 60 * 1000) + ' hours',
        searchHistory: this.config.maxAge.searchHistory / (24 * 60 * 60 * 1000) + ' days'
      }
    });
  }
  
  /**
   * Start periodic cleanup
   */
  public startPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      debugLog('Storage cleanup already running');
      return;
    }

    debugLog('Starting periodic storage cleanup...');
    
    // Run cleanup immediately
    this.runCleanup();
    
    // Set up periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, this.config.cleanupInterval);
    
    debugLog(`Periodic storage cleanup started with ${this.config.cleanupInterval / (60 * 60 * 1000)}h interval`);
  }
  
  /**
   * Stop periodic cleanup
   */
  public stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      debugLog('Periodic storage cleanup stopped');
    }
  }
  
  /**
   * Run cleanup immediately
   */
  public async runCleanup(): Promise<void> {
    debugLog('Running storage cleanup...');
    
    try {
      const now = Date.now();
      let totalCleaned = 0;
      
      // Clean up tweets
      totalCleaned += await this.cleanupTweets(now);
      
      // Clean up auth checks  
      totalCleaned += await this.cleanupAuthChecks(now);
      
      // Clean up search history
      totalCleaned += await this.cleanupSearchHistory(now);
      
      debugLog(`Storage cleanup completed. Cleaned ${totalCleaned} items.`);
    } catch (error) {
      console.error('Error during storage cleanup:', error);
    }
  }
  
  /**
   * Clean up stale tweet data
   */
  private async cleanupTweets(now: number): Promise<number> {
    try {
      const result = await chrome.storage.local.get(['currentTweet']);
      const currentTweet = result.currentTweet as StoredTweetData | undefined;
      
      if (!currentTweet) {
        return 0;
      }
      
      const age = now - currentTweet.timestamp;
      if (age > this.config.maxAge.tweets) {
        await chrome.storage.local.remove(['currentTweet']);
        debugLog(`Cleaned up stale tweet data (age: ${Math.round(age / (60 * 60 * 1000))}h)`);
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
      const filteredHistory = searchHistory.filter((item: any) => {
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
        'currentTweet',
        'lastAuthCheck', 
        'originator_search_history'
      ]);
      
      // Check tweets
      if (result.currentTweet) {
        stats.tweets.count = 1;
        stats.tweets.oldestAge = now - result.currentTweet.timestamp;
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
            .map((item: any) => new Date(item.searchedAt).getTime())
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