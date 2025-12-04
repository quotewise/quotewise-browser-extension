/**
 * Chrome extension API type extensions and custom types
 */

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
  
  // Badge updates
  UPDATE_COLLECTION_BADGE = 'UPDATE_COLLECTION_BADGE',
  
  // Storage management
  CLEANUP_STORAGE = 'CLEANUP_STORAGE',
  GET_STORAGE_STATS = 'GET_STORAGE_STATS',

  // UI control
  OPEN_POPUP = 'OPEN_POPUP',
  SHOW_OVERLAY = 'SHOW_OVERLAY',
  
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
export type CollectionBadgeState = 'already_collected' | 'should_collect' | 'new_quote' | 'processing' | 'ready';

export interface CollectionBadgeInfo {
  state: CollectionBadgeState;
  quoteText?: string; // For title display
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
