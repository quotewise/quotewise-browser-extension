/**
 * Environment configuration for Quotewise Chrome extension
 * Supports multiple environments matching Django settings
 */

import type { EnvironmentConfig, SessionConfig } from '../types/api';

/**
 * Debug mode flag - enables console logging in non-production environments
 * Active when:
 * - NODE_ENV is 'development'
 * - Manifest name contains '[DEV]' or '[STAGING]'
 */
function isDebugMode(): boolean {
  // Check NODE_ENV first
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    return true;
  }

  // Check manifest name for environment indicators
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    const manifest = chrome.runtime.getManifest();
    if (manifest.name?.includes('[DEV]') ||
        manifest.name?.includes('[STAGING]') ||
        manifest.name?.toLowerCase().includes('dev')) {
      return true;
    }
  }

  return false;
}

export const DEBUG_MODE = isDebugMode();

/**
 * Debug logging function - only logs in debug mode
 * Use this instead of console.log for development logging
 */
export function debugLog(...args: unknown[]): void {
  if (DEBUG_MODE) {
    // eslint-disable-next-line no-console
    console.log('[Quotewise]', ...args);
  }
}

// Environment configurations matching Django settings
export const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
    development: {
        apiBaseUrl: 'http://127.0.0.1:8000',
        sessionCookieName: 'sessionid',
        secure: false  // Based on settings/test.py:153
    },
    staging: {
        apiBaseUrl: 'https://staging.quotosaurus.com',
        sessionCookieName: 'stagingsessionid',  // settings/staging.py:78
        secure: true  // settings/staging.py:33
    },
    production: {
        apiBaseUrl: 'https://quotosaurus.com',
        sessionCookieName: 'sessionid',
        secure: true  // settings/production.py:120
    }
};

/**
 * Get session configuration for environment
 * Based on Django settings in quotewise/settings/deploy.py (lines 216-220)
 */
export function getSessionConfig(environment: 'development' | 'staging' | 'production'): SessionConfig {
    return {
        cookieName: environment === 'staging' ? 'stagingsessionid' : 'sessionid',
        maxAge: 1814400, // 3 weeks in seconds
        secure: environment !== 'development',
        httpOnly: true
    };
}

/**
 * Detect current environment based on extension context
 */
export function detectEnvironment(): 'development' | 'staging' | 'production' {
    // Prefer explicit env flag (set via build)
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
        return 'development';
    }

    // Check if we're in a Chrome extension context
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        const manifest = chrome.runtime.getManifest();
        
        // Check manifest for environment indicators
        if (manifest.name?.includes('dev') || manifest.name?.includes('Dev')) {
            return 'development';
        }
        
        if (manifest.name?.includes('staging') || manifest.name?.includes('Staging')) {
            return 'staging';
        }
        
        // Check version for development builds (e.g., "1.0.0-dev")
        if (manifest.version?.includes('-dev') || manifest.version?.includes('-alpha')) {
            return 'development';
        }
        
        if (manifest.version?.includes('-staging') || manifest.version?.includes('-beta')) {
            return 'staging';
        }
    }
    
    // Check process.env if available (webpack builds)
    if (typeof process !== 'undefined' && process.env) {
        if (process.env.NODE_ENV === 'development') {
            return 'development';
        }
        
        if (process.env.NODE_ENV === 'staging') {
            return 'staging';
        }
        
        if (process.env.NODE_ENV === 'production') {
            return 'production';
        }
    }
    
    // Check current domain if we're on a web page
    if (typeof window !== 'undefined' && window.location) {
        const hostname = window.location.hostname;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'development';
        }
        
        if (hostname.includes('staging')) {
            return 'staging';
        }
        
        if (hostname === 'quotosaurus.com') {
            return 'production';
        }
    }
    
    // Default to development for safety
    return 'development';
}

/**
 * Get environment configuration
 */
export function getEnvironmentConfig(environment?: string): EnvironmentConfig {
    const env = environment || detectEnvironment();
    const config = ENVIRONMENTS[env];
    
    if (!config) {
        console.warn(`Unknown environment: ${env}, falling back to development`);
        return ENVIRONMENTS.development;
    }
    
    return config;
}

/**
 * Validate environment configuration
 */
export function validateEnvironmentConfig(config: EnvironmentConfig): boolean {
    if (!config.apiBaseUrl) {
        console.error('Environment config missing apiBaseUrl');
        return false;
    }
    
    if (!config.sessionCookieName) {
        console.error('Environment config missing sessionCookieName');
        return false;
    }
    
    // Validate URL format
    try {
        new URL(config.apiBaseUrl);
    } catch (error) {
        console.error('Invalid apiBaseUrl in environment config:', config.apiBaseUrl);
        return false;
    }
    
    return true;
}

// Legacy functions for backwards compatibility
export function getCurrentEnvironment(): EnvironmentConfig {
    return getEnvironmentConfig();
}

export function getEnvironment(name: string): EnvironmentConfig {
    return ENVIRONMENTS[name] || ENVIRONMENTS.production;
}

export function isDevelopment(): boolean {
    return detectEnvironment() === 'development';
}

export function isProduction(): boolean {
    return detectEnvironment() === 'production';
}

export function getApiBaseUrl(): string {
    return getEnvironmentConfig().apiBaseUrl;
}

export function getSessionCookieName(): string {
    return getEnvironmentConfig().sessionCookieName;
}
