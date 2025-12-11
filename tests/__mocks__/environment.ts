/**
 * Mock environment module for testing
 */

export const DEBUG_MODE = true;

export const debugLog = jest.fn();

export const detectEnvironment = jest.fn(() => 'development');

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
