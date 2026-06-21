/**
 * Chrome extension API type extensions and custom types
 */

import type { DuplicateSightingState } from '../utils/duplicate-status';

// Extend Chrome API types as needed
declare namespace chrome {
  namespace runtime {
    interface ExtensionMessageEvent extends MessageEvent {
      data: ExtensionMessage;
    }
  }
  
  namespace tabs {
    interface TabInfo {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
    }
  }
}

// Extension-specific message types
export enum MessageType {
  // Content script to background
  TWEET_DATA_EXTRACTED = 'TWEET_DATA_EXTRACTED',
  
  // Background to content script
  EXTRACT_TWEET_DATA = 'EXTRACT_TWEET_DATA',
  
  // Popup to background
  GET_TWEET_DATA = 'GET_TWEET_DATA',
  CHECK_AUTH_STATUS = 'CHECK_AUTH_STATUS',
  SUBMIT_QUOTE = 'SUBMIT_QUOTE',
  SEARCH_ORIGINATORS = 'SEARCH_ORIGINATORS',
  CHECK_DUPLICATE = 'CHECK_DUPLICATE',
  LOOKUP_ORIGINATOR_BY_HANDLE = 'LOOKUP_ORIGINATOR_BY_HANDLE',
  PREFLIGHT_CHECK = 'PREFLIGHT_CHECK',
  
  // Badge updates
  UPDATE_COLLECTION_BADGE = 'UPDATE_COLLECTION_BADGE',
  ORIGINATOR_LOOKUP_STATUS = 'ORIGINATOR_LOOKUP_STATUS',
  
  // Storage management
  CLEANUP_STORAGE = 'CLEANUP_STORAGE',
  GET_STORAGE_STATS = 'GET_STORAGE_STATS',
  GET_DIAGNOSTICS = 'GET_DIAGNOSTICS',

  // UI control
  OPEN_POPUP = 'OPEN_POPUP',
  SHOW_OVERLAY = 'SHOW_OVERLAY',
  OPEN_OPTIONS_PAGE = 'OPEN_OPTIONS_PAGE',
  OPEN_FEEDBACK_PAGE = 'OPEN_FEEDBACK_PAGE',
  CHECK_NOW = 'CHECK_NOW',

  // OAuth authentication
  OAUTH_LOGIN = 'OAUTH_LOGIN',
  OAUTH_LOGOUT = 'OAUTH_LOGOUT',

  // Privacy and settings
  CLEAR_USER_DATA = 'CLEAR_USER_DATA',
  LIST_COLLECTIONS = 'LIST_COLLECTIONS',

  // Auth state management (centralized)
  AUTH_STATE_GET = 'AUTH_STATE_GET',           // Request current auth state
  AUTH_STATE_CHANGED = 'AUTH_STATE_CHANGED',   // Broadcast state change to all listeners
  AUTH_STATE_SUBSCRIBE = 'AUTH_STATE_SUBSCRIBE', // Subscribe to state changes (content scripts)

  // General responses
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export interface ExtensionMessage {
  type: MessageType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  requestId?: string;
}

export interface Settings {
  privateMode: boolean;
  autoAddToCollection: boolean;
  defaultCollectionId: string | null;
  firstRunNoticeShown: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  privateMode: false,
  autoAddToCollection: false,
  defaultCollectionId: null,
  firstRunNoticeShown: false,
};

// Twitter/X specific types
export interface TwitterData {
  text: string;
  author: {
    username: string;
    displayName: string;
    verified?: boolean;
    profileUrl?: string;
    avatarUrl?: string;
  };
  retweeter?: {
    username: string;
    displayName: string;
  };
  url: string;
  date: string | null;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  bookmarks: number;
  tweetType: 'original' | 'reply' | 'retweet' | 'quote';
  language?: string;
  isProtected?: boolean;
  /** True when the post is a long-form X Article (read-view), where capture requires an explicit text selection. */
  isArticle?: boolean;
  platform_data: {
    tweet_id: string | null;
    reply_count: number;
    retweet_count: number;
    quote_count?: number;
    bookmark_count: number;
    view_count: number;
    is_protected?: boolean;
    thread_position?: number;
    has_media?: boolean;
    reply_to_tweet_id?: string;
    quoted_tweet_id?: string;
    retweeter_username?: string;
    retweeter_display_name?: string;
  };
}

// Extension storage types
export interface ExtensionStorage {
  currentTweet?: {
    data: TwitterData;
    timestamp: number;
    url: string;
  };
  settings?: {
    environment: 'development' | 'staging' | 'production';
    autoCapture: boolean;
    duplicateCheck: boolean;
  };
  authStatus?: {
    isAuthenticated: boolean;
    lastCheck: number;
    userId?: string;
  };
}

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AuthStatusResponse {
  isAuthenticated: boolean;
  userId?: string;
  username?: string;
  isAdmin?: boolean;
}

// Error types
export class ExtensionError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ExtensionError';
  }
}

export class ApiError extends ExtensionError {
  constructor(
    message: string,
    public statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(message, 'API_ERROR', details);
    this.name = 'ApiError';
  }
}

export class AuthenticationError extends ExtensionError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
  }
}

// Badge types
export type CollectionBadgeState = 'already_collected' | 'exists_not_collected' | 'new_quote' | 'processing' | 'ready';

export interface CollectionBadgeInfo {
  state: CollectionBadgeState;
  quoteText?: string; // For title display
  duplicateSightingState?: DuplicateSightingState;
}

// Utility types
export type Platform = 'twitter' | 'x' | 'unknown';

export interface PlatformDetection {
  platform: Platform;
  isSupported: boolean;
  isTweetPage: boolean;
  tweetId?: string;
}

// Content script injection types
export interface ContentScriptMessage {
  type: string;
  data?: Record<string, unknown>;
  source: 'quotewise-extension';
}

// Popup state management
export type PopupState = 
  | 'loading'
  | 'auth-required' 
  | 'quote-capture'
  | 'error'
  | 'success';

export interface PopupStateData {
  state: PopupState;
  message?: string;
  data?: Record<string, unknown>;
}
