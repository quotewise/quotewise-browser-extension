/**
 * Mock environment module for testing
 */

export const DEBUG_MODE = true;

export const debugLog = jest.fn();

export const detectEnvironment = jest.fn(() => 'development');

export const getEnvironmentConfig = jest.fn((env?: string) => {
  if (env === 'production') {
    return {
      apiBaseUrl: 'https://quotosaurus.com',
      sessionCookieName: 'sessionid',
      environment: 'production'
    };
  }
  if (env === 'staging') {
    return {
      apiBaseUrl: 'https://staging.quotosaurus.com',
      sessionCookieName: 'sessionid',
      environment: 'staging'
    };
  }
  // Default to development
  return {
    apiBaseUrl: 'http://localhost:8001',
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
