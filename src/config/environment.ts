/**
 * Environment configuration for different deployment targets
 */

export interface EnvironmentConfig {
  apiBaseUrl: string;
  sessionCookieName: string;
  secure: boolean;
  environment: 'development' | 'staging' | 'production';
}

export const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
  development: {
    apiBaseUrl: 'http://localhost:8001',
    sessionCookieName: 'sessionid',
    secure: false,
    environment: 'development'
  },
  staging: {
    apiBaseUrl: 'https://staging.quotosaurus.com',
    sessionCookieName: 'stagingsessionid',
    secure: true,
    environment: 'staging'
  },
  production: {
    apiBaseUrl: 'https://quotosaurus.com',
    sessionCookieName: 'sessionid',
    secure: true,
    environment: 'production'
  }
};

/**
 * Get current environment configuration
 */
export function getCurrentEnvironment(): EnvironmentConfig {
  // In production extension, this would typically be 'production'
  // For development, you might want to make this configurable
  const envName = process.env.NODE_ENV === 'development' ? 'development' : 'production';
  
  return ENVIRONMENTS[envName] || ENVIRONMENTS.production;
}

/**
 * Get environment configuration by name
 */
export function getEnvironment(name: string): EnvironmentConfig {
  return ENVIRONMENTS[name] || ENVIRONMENTS.production;
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return getCurrentEnvironment().environment === 'development';
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return getCurrentEnvironment().environment === 'production';
}

/**
 * Get API base URL for current environment
 */
export function getApiBaseUrl(): string {
  return getCurrentEnvironment().apiBaseUrl;
}

/**
 * Get session cookie name for current environment
 */
export function getSessionCookieName(): string {
  return getCurrentEnvironment().sessionCookieName;
}