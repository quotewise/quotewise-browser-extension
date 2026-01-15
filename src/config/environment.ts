/**
 * Environment configuration for Quotewise Chrome extension
 * Supports multiple environments matching Django settings
 */

import type { EnvironmentConfig, SessionConfig } from '../types/api';
import type { OAuthConfig } from '../types/oauth';

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
        apiBaseUrl: 'http://api.quotewise.test:8000',
        webBaseUrl: 'http://quotewise.test:8000',
        sessionCookieName: 'sessionid',
        secure: false  // Based on settings/test.py:153
    },
    staging: {
        apiBaseUrl: 'https://api.staging.quotewise.io',
        webBaseUrl: 'https://staging.quotewise.io',
        sessionCookieName: 'stagingsessionid',  // settings/staging.py:78
        secure: true  // settings/staging.py:33
    },
    production: {
        apiBaseUrl: 'https://api.quotewise.io',
        webBaseUrl: 'https://quotewise.io',
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

        // No dev/staging indicators in manifest = production
        return 'production';
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
        
        if (hostname === 'quotewise.io' || hostname.endsWith('.quotewise.io')) {
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

export function getWebBaseUrl(): string {
    return getEnvironmentConfig().webBaseUrl;
}

export function getSessionCookieName(): string {
    return getEnvironmentConfig().sessionCookieName;
}

// OAuth Configuration
// Pre-registered OAuth client ID (UUID) - same for all environments
// This client is seeded via migration 0090_seed_chrome_extension_oauth_client.py
// The redirect_uri pattern "https://*.chromiumapp.org/callback" allows any extension ID
const OAUTH_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/**
 * OAuth scopes required by the extension
 */
export const OAUTH_SCOPES = [
    'quotes:read',
    'quotes:write',
    'collections:read',
    'collections:write',
];

/**
 * Get OAuth configuration for current environment
 */
export function getOAuthConfig(): OAuthConfig {
    const envConfig = getEnvironmentConfig();

    // Get extension ID for redirect URI
    // In development, chrome.runtime.id may be undefined
    const extensionId = typeof chrome !== 'undefined' && chrome.runtime?.id
        ? chrome.runtime.id
        : 'development-extension-id';

    return {
        clientId: OAUTH_CLIENT_ID,
        authorizeUrl: `${envConfig.apiBaseUrl}/oauth/authorize`,
        tokenUrl: `${envConfig.apiBaseUrl}/oauth/token`,
        redirectUri: `https://${extensionId}.chromiumapp.org/callback`,
        scopes: OAUTH_SCOPES,
    };
}

/**
 * Get OAuth authorize URL with all parameters
 */
export function getAuthorizeUrl(): string {
    const config = getOAuthConfig();
    return config.authorizeUrl;
}

/**
 * Get OAuth token URL
 */
export function getTokenUrl(): string {
    const config = getOAuthConfig();
    return config.tokenUrl;
}
