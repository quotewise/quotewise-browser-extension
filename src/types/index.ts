/**
 * Shared type definitions for the Quotewise Chrome Extension
 */

// Export Chrome extension specific types
export * from './chrome';

// Re-export API types
export * from './api';

// Extension configuration
export interface ExtensionSettings {
  environment: 'development' | 'staging' | 'production';
  autoCapture: boolean;
  duplicateCheck: boolean;
  defaultAttribution: 'DIRECT' | 'POPULARIZED' | 'DISPUTED';
}

// Cached data structures
export interface CachedOriginator {
  id: string;
  full_name: string;
  sort_name: string | null;
  birth_year: number | null;
  death_year: number | null;
  quote_count?: number;
  lastUsed: string;
  searchTerms: string[];
}