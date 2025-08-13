/**
 * Unit tests for AuthChecker
 * Tests Django session authentication integration
 */

import { AuthChecker } from '../../src/auth/auth-checker';
import type { QuotewiseApiClient } from '../../src/types/api';
import type { AuthStatus, AuthError } from '../../src/types/auth';

// Mock API client
const mockApiClient = {
  baseUrl: 'http://localhost:8001',
  checkAuthStatus: jest.fn(),
  searchOriginators: jest.fn(),
  checkQuoteDuplicate: jest.fn(),
  submitQuote: jest.fn()
} as jest.Mocked<QuotewiseApiClient>;

describe('AuthChecker', () => {
  let authChecker: AuthChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    authChecker = new AuthChecker(mockApiClient);
  });

  describe('checkAuthStatus', () => {
    test('returns authenticated status for valid session', async () => {
      const mockResponse = {
        isAuthenticated: true,
        userInfo: {
          username: 'testuser',
          isAdmin: true
        },
        sessionExpiry: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
      };

      mockApiClient.checkAuthStatus.mockResolvedValue(mockResponse);

      const result = await authChecker.checkAuthStatus();

      expect('isAuthenticated' in result).toBe(true);
      if ('isAuthenticated' in result) {
        expect(result.isAuthenticated).toBe(true);
        expect(result.isStaff).toBe(true);
        expect(result.username).toBe('testuser');
        expect(result.sessionExpiry).toBe('2025-01-14T12:00:00Z');
        expect(result.sessionAge).toBeGreaterThan(0);
      }
    });

    test('returns auth error for unauthenticated request', async () => {
      const mockResponse = {
        isAuthenticated: false
      };

      mockApiClient.checkAuthStatus.mockResolvedValue(mockResponse);

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('not_authenticated');
        expect(result.message).toBe('Please log in to Quotewise');
        expect(result.requiresLogin).toBe(true);
      }
    });

    test('handles authentication errors gracefully', async () => {
      const authError = new Error('Authentication required');
      authError.name = 'AuthenticationError';
      mockApiClient.checkAuthStatus.mockRejectedValue(authError);

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('not_authenticated');
        expect(result.message).toBe('Please log in to Quotewise');
        expect(result.requiresLogin).toBe(true);
      }
    });

    test('handles network errors gracefully', async () => {
      mockApiClient.checkAuthStatus.mockRejectedValue(new Error('Network error'));

      const result = await authChecker.checkAuthStatus();

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('network_error');
        expect(result.message).toBe('Unable to check authentication status');
        expect(result.requiresLogin).toBe(false);
      }
    });
  });

  describe('waitForAuthChange', () => {
    test('resolves when authentication is detected', async () => {
      // Mock first call as unauthenticated, second as authenticated
      mockApiClient.checkAuthStatus
        .mockResolvedValueOnce({ isAuthenticated: false })
        .mockResolvedValueOnce({
          isAuthenticated: true,
          userInfo: { username: 'testuser', isAdmin: true }
        });

      const result = await authChecker.waitForAuthChange(2000);

      expect(result.isAuthenticated).toBe(true);
      expect(result.username).toBe('testuser');
      expect(mockApiClient.checkAuthStatus).toHaveBeenCalledTimes(2);
    });

    test('throws timeout error when no authentication detected', async () => {
      mockApiClient.checkAuthStatus.mockResolvedValue({ isAuthenticated: false });

      await expect(authChecker.waitForAuthChange(1000))
        .rejects
        .toThrow('Authentication timeout');

      expect(mockApiClient.checkAuthStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('validatePrivileges', () => {
    test('returns null for authenticated user with staff privileges', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        username: 'admin',
        sessionAge: 3600
      };

      const result = authChecker.validatePrivileges(authStatus);
      expect(result).toBeNull();
    });

    test('returns not_authenticated error for unauthenticated user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: false,
        isStaff: false
      };

      const result = authChecker.validatePrivileges(authStatus);
      expect(result).toEqual({
        type: 'not_authenticated',
        message: 'Please log in to Quotewise',
        requiresLogin: true
      });
    });

    test('returns insufficient_privileges error for non-staff user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: false,
        username: 'user'
      };

      const result = authChecker.validatePrivileges(authStatus);
      expect(result).toEqual({
        type: 'insufficient_privileges',
        message: 'Administrator privileges required for quote submission',
        requiresLogin: false
      });
    });

    test('returns session_expired error for expired session', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        username: 'admin',
        sessionAge: 0
      };

      const result = authChecker.validatePrivileges(authStatus);
      expect(result).toEqual({
        type: 'session_expired',
        message: 'Your session has expired. Please log in again.',
        requiresLogin: true
      });
    });
  });

  describe('isSessionNearExpiry', () => {
    test('returns true for sessions expiring within 10 minutes', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        sessionAge: 300 // 5 minutes
      };

      const result = authChecker.isSessionNearExpiry(authStatus);
      expect(result).toBe(true);
    });

    test('returns false for sessions with more than 10 minutes remaining', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        sessionAge: 900 // 15 minutes
      };

      const result = authChecker.isSessionNearExpiry(authStatus);
      expect(result).toBe(false);
    });

    test('returns false when no session age provided', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true
      };

      const result = authChecker.isSessionNearExpiry(authStatus);
      expect(result).toBe(false);
    });
  });

  describe('getUserDisplayName', () => {
    test('returns username for authenticated user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        username: 'testuser'
      };

      const result = authChecker.getUserDisplayName(authStatus);
      expect(result).toBe('testuser');
    });

    test('returns "Not logged in" for unauthenticated user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: false,
        isStaff: false
      };

      const result = authChecker.getUserDisplayName(authStatus);
      expect(result).toBe('Not logged in');
    });

    test('returns "Unknown user" when no username provided', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true
      };

      const result = authChecker.getUserDisplayName(authStatus);
      expect(result).toBe('Unknown user');
    });
  });

  describe('getStatusSummary', () => {
    test('returns error message for AuthError', () => {
      const authError: AuthError = {
        type: 'not_authenticated',
        message: 'Please log in',
        requiresLogin: true
      };

      const result = authChecker.getStatusSummary(authError);
      expect(result).toBe('Please log in');
    });

    test('returns detailed status for authenticated admin user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: true,
        username: 'admin',
        sessionAge: 1800 // 30 minutes
      };

      const result = authChecker.getStatusSummary(authStatus);
      expect(result).toBe('Logged in as admin (session expires in 30m)');
    });

    test('returns status for authenticated non-admin user', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: true,
        isStaff: false,
        username: 'user'
      };

      const result = authChecker.getStatusSummary(authStatus);
      expect(result).toBe('Logged in (no admin access)');
    });

    test('returns not authenticated status', () => {
      const authStatus: AuthStatus = {
        isAuthenticated: false,
        isStaff: false
      };

      const result = authChecker.getStatusSummary(authStatus);
      expect(result).toBe('Not authenticated');
    });
  });
});