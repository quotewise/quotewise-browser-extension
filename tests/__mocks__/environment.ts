/**
 * Mock environment module for testing
 */

export const DEBUG_MODE = true;

export const debugLog = jest.fn();

function detectMockEnvironment(): 'development' | 'staging' | 'production' {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    const manifest = chrome.runtime.getManifest();
    const name = manifest.name ?? '';
    const version = manifest.version ?? '';

    if (name.toLowerCase().includes('dev') || version.includes('-dev') || version.includes('-alpha')) {
      return 'development';
    }

    if (name.toLowerCase().includes('staging')) {
      return 'staging';
    }

    return 'production';
  }

  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

export const detectEnvironment = jest.fn(() => detectMockEnvironment());

export const isDevelopment = jest.fn(() => detectEnvironment() === 'development');

export const isProduction = jest.fn(() => detectEnvironment() === 'production');

export const getEnvironmentConfig = jest.fn((env?: string) => {
  if (env === 'production') {
    return {
      apiBaseUrl: 'https://api.quotewise.io',
      webBaseUrl: 'https://quotewise.io',
      sessionCookieName: 'sessionid',
      environment: 'production'
    };
  }
  if (env === 'staging') {
    return {
      apiBaseUrl: 'https://api.staging.quotewise.io',
      webBaseUrl: 'https://staging.quotewise.io',
      sessionCookieName: 'sessionid',
      environment: 'staging'
    };
  }
  // Default to development
  return {
    apiBaseUrl: 'http://api.quotewise.test:8000',
    webBaseUrl: 'http://quotewise.test:8000',
    sessionCookieName: 'sessionid',
    environment: 'development'
  };
});

export const getSessionConfig = jest.fn(() => ({
  cleanupInterval: 3600000,
  maxAge: {
    tweets: 86400000,
    authChecks: 1800000,
    searchHistory: 604800000
  }
}));

export const getWebBaseUrl = jest.fn(() => 'http://quotewise.test:8000');
