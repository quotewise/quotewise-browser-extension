/**
 * Authentication types for Quotewise Chrome extension
 * Matches Django session authentication patterns
 */

// Authentication status interface matching Django user model
export interface AuthStatus {
  isAuthenticated: boolean;
  isStaff: boolean;           // Required for quote submission (user.is_staff)
  username?: string;
  sessionAge?: number;        // Time until session expires in seconds
  sessionExpiry?: string;     // ISO date string for session expiration
}

// Authentication error types
export interface AuthError {
  type: 'session_expired' | 'not_authenticated' | 'insufficient_privileges' | 'network_error';
  message: string;
  requiresLogin: boolean;
}

// Django API response format for auth status endpoint
export interface AuthStatusResponse {
  is_authenticated: boolean;
  is_staff: boolean;
  username: string;
  session_age: number;
}

// Login configuration for different environments
export interface LoginConfig {
  loginUrl: string;           // "/accounts/login/" from Django settings
  redirectUrl: string;        // "/" from LOGIN_REDIRECT_URL
  environment: 'development' | 'staging' | 'production';
}

// Tab monitoring for login flow
export interface LoginTabInfo {
  tabId: number;
  loginUrl: string;
  redirectUrl: string;
  startTime: number;
}

// Background authentication monitoring
export interface AuthMonitoringConfig {
  checkInterval: number;      // Milliseconds between auth checks
  maxRetries: number;         // Maximum retry attempts for failed checks
  timeoutDuration: number;    // Timeout for auth operations
}

// Extension badge state
export type AuthBadgeState = 'authenticated' | 'unauthenticated' | 'insufficient_privileges' | 'checking';

// Authentication change event
export interface AuthChangeEvent {
  type: 'AUTH_STATUS_CHANGED';
  previousStatus: AuthStatus | null;
  currentStatus: AuthStatus;
  timestamp: number;
}