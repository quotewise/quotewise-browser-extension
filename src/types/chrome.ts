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
  
  // General responses
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export interface ExtensionMessage {
  type: MessageType;
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
export interface ApiResponse<T = any> {
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
    public details?: any
  ) {
    super(message);
    this.name = 'ExtensionError';
  }
}

export class ApiError extends ExtensionError {
  constructor(
    message: string,
    public statusCode?: number,
    details?: any
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
  data?: any;
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
  data?: any;
}