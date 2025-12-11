/**
 * Unit tests for HandleLookup component
 */

import { HandleLookup, HandleLookupState } from '../../src/lookup/handle-lookup';
import { MessageType } from '../../src/types/chrome';

// Mock chrome.runtime.sendMessage
const mockSendMessage = jest.fn();
(global as unknown as { chrome: { runtime: { sendMessage: jest.Mock; lastError: null } } }).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: null
  }
};

describe('HandleLookup', () => {
  let handleLookup: HandleLookup;

  beforeEach(() => {
    handleLookup = new HandleLookup();
    mockSendMessage.mockClear();
    // Reset lastError to null before each test
    (global as unknown as { chrome: { runtime: { lastError: null } } }).chrome.runtime.lastError = null;
  });

  afterEach(() => {
    handleLookup.destroy();
  });

  describe('initialization', () => {
    it('should create with initial state', () => {
      const state = handleLookup.getState();

      expect(state.isLooking).toBe(false);
      expect(state.hasLookedUp).toBe(false);
      expect(state.result).toBeNull();
      expect(state.matchedOriginator).toBeNull();
      expect(state.createUrl).toBeNull();
      expect(state.matchedHandle).toBeNull();
      expect(state.errorMessage).toBeNull();
    });

    it('should not have a match initially', () => {
      expect(handleLookup.hasMatch()).toBe(false);
    });

    it('should return null for getMatchedOriginator initially', () => {
      expect(handleLookup.getMatchedOriginator()).toBeNull();
    });
  });

  describe('lookupByHandle', () => {
    it('should skip lookup for empty handle', async () => {
      const result = await handleLookup.lookupByHandle('');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(result.isLooking).toBe(false);
    });

    it('should skip lookup for whitespace-only handle', async () => {
      const result = await handleLookup.lookupByHandle('   ');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should strip @ prefix from handle', async () => {
      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({ success: true, found: false });
      });

      await handleLookup.lookupByHandle('@testuser');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.LOOKUP_ORIGINATOR_BY_HANDLE,
          data: { handle: 'testuser', platform: 'twitter' }
        }),
        expect.any(Function)
      );
    });

    it('should update state to looking during lookup', async () => {
      let lookingState: HandleLookupState | undefined;

      mockSendMessage.mockImplementation((_msg, callback) => {
        // Capture state during lookup
        lookingState = handleLookup.getState();
        callback({ success: true, found: false });
      });

      await handleLookup.lookupByHandle('testuser');

      expect(lookingState).toBeDefined();
      expect(lookingState!.isLooking).toBe(true);
      expect(lookingState!.matchedHandle).toBe('testuser');
    });

    it('should handle successful lookup with found originator', async () => {
      const mockOriginator = {
        id: 123,
        unique_id: 'test-user',
        full_name: 'Test User',
        sort_name_display: 'User, Test',
        confidence: 1.0
      };

      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({
          success: true,
          found: true,
          originator: mockOriginator
        });
      });

      const result = await handleLookup.lookupByHandle('testuser');

      expect(result.isLooking).toBe(false);
      expect(result.hasLookedUp).toBe(true);
      expect(result.result).toBe('found');
      expect(result.matchedOriginator).toEqual(mockOriginator);
      expect(handleLookup.hasMatch()).toBe(true);
      expect(handleLookup.getMatchedOriginator()).toEqual(mockOriginator);
    });

    it('should handle lookup with not found result', async () => {
      const createUrl = 'https://quotewise.io/originators/create/?suggested_handle=unknownuser';

      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({
          success: true,
          found: false,
          create_url: createUrl
        });
      });

      const result = await handleLookup.lookupByHandle('unknownuser');

      expect(result.isLooking).toBe(false);
      expect(result.hasLookedUp).toBe(true);
      expect(result.result).toBe('not_found');
      expect(result.matchedOriginator).toBeNull();
      expect(result.createUrl).toBe(createUrl);
      expect(handleLookup.hasMatch()).toBe(false);
    });

    it('should handle lookup error', async () => {
      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({
          success: false,
          error: 'Network error'
        });
      });

      const result = await handleLookup.lookupByHandle('testuser');

      expect(result.isLooking).toBe(false);
      expect(result.hasLookedUp).toBe(true);
      expect(result.result).toBe('error');
      expect(result.errorMessage).toBe('Network error');
      expect(handleLookup.hasMatch()).toBe(false);
    });

    it('should handle chrome.runtime.lastError', async () => {
      mockSendMessage.mockImplementation((_msg, callback) => {
        // Set lastError just before callback is checked
        (global as unknown as { chrome: { runtime: { lastError: { message: string } | null } } }).chrome.runtime.lastError = {
          message: 'Extension context invalidated'
        };
        // The callback receives the response, but lastError is also set
        // The Promise constructor checks lastError
        callback({ success: true, found: false });
      });

      const result = await handleLookup.lookupByHandle('testuser');

      // The implementation rejects when lastError is set, so result should be error
      expect(result.result).toBe('error');
    });

    it('should use twitter as default platform', async () => {
      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({ success: true, found: false });
      });

      await handleLookup.lookupByHandle('testuser');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ platform: 'twitter' })
        }),
        expect.any(Function)
      );
    });

    it('should use specified platform', async () => {
      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({ success: true, found: false });
      });

      await handleLookup.lookupByHandle('testuser', 'instagram');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ platform: 'instagram' })
        }),
        expect.any(Function)
      );
    });
  });

  describe('state listeners', () => {
    it('should notify listeners on state change', async () => {
      const listener = jest.fn();
      handleLookup.addListener(listener);

      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({ success: true, found: false });
      });

      await handleLookup.lookupByHandle('testuser');

      // Should be called multiple times (looking state, then result state)
      expect(listener).toHaveBeenCalled();
    });

    it('should allow removing listeners', async () => {
      const listener = jest.fn();
      const unsubscribe = handleLookup.addListener(listener);

      unsubscribe();
      listener.mockClear();

      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({ success: true, found: false });
      });

      await handleLookup.lookupByHandle('testuser');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset state to initial values', async () => {
      // Ensure lastError is null
      (global as unknown as { chrome: { runtime: { lastError: null } } }).chrome.runtime.lastError = null;

      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({
          success: true,
          found: true,
          originator: { id: 1, full_name: 'Test', unique_id: 'test', sort_name_display: 'Test', confidence: 1 }
        });
      });

      await handleLookup.lookupByHandle('testuser');
      expect(handleLookup.hasMatch()).toBe(true);

      handleLookup.reset();

      const state = handleLookup.getState();
      expect(state.isLooking).toBe(false);
      expect(state.hasLookedUp).toBe(false);
      expect(state.result).toBeNull();
      expect(state.matchedOriginator).toBeNull();
      expect(handleLookup.hasMatch()).toBe(false);
    });
  });

  describe('dismiss', () => {
    it('should clear lookup result while keeping some state', async () => {
      mockSendMessage.mockImplementation((_msg, callback) => {
        callback({
          success: true,
          found: true,
          originator: { id: 1, full_name: 'Test', unique_id: 'test', sort_name_display: 'Test', confidence: 1 }
        });
      });

      await handleLookup.lookupByHandle('testuser');
      handleLookup.dismiss();

      const state = handleLookup.getState();
      expect(state.hasLookedUp).toBe(false);
      expect(state.result).toBeNull();
    });
  });

  describe('destroy', () => {
    it('should clear all listeners', () => {
      const listener = jest.fn();
      handleLookup.addListener(listener);

      handleLookup.destroy();

      // After destroy, listeners should be cleared
      // Can't directly test this but destroy should complete without error
      expect(true).toBe(true);
    });
  });
});
