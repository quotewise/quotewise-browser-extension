/**
 * Unit tests for input validation utilities
 * Tests security hardening for content script data validation
 */

import {
  validateTwitterData,
  isValidTwitterData,
  validateExtensionMessage,
  isValidExtensionMessage,
  ValidationError
} from '../../src/utils/validators';
import type { TwitterData } from '../../src/types/chrome';

describe('validateTwitterData', () => {
  // Helper to create valid TwitterData for modification
  const createValidTwitterData = (): TwitterData => ({
    text: 'This is a test tweet with valid content',
    author: {
      username: 'testuser',
      displayName: 'Test User',
      verified: false,
      profileUrl: 'https://twitter.com/testuser',
      avatarUrl: 'https://pbs.twimg.com/profile_images/123/avatar.jpg'
    },
    url: 'https://twitter.com/testuser/status/1234567890',
    date: '2024-01-15T10:30:00Z',
    likes: 100,
    retweets: 50,
    replies: 25,
    views: 1000,
    bookmarks: 10,
    tweetType: 'original',
    language: 'en',
    isProtected: false,
    platform_data: {
      tweet_id: '1234567890',
      reply_count: 25,
      retweet_count: 50,
      quote_count: 5,
      bookmark_count: 10,
      view_count: 1000,
      is_protected: false,
      thread_position: 1,
      has_media: false
    }
  });

  describe('valid data acceptance', () => {
    test('accepts valid complete TwitterData', () => {
      const validData = createValidTwitterData();
      expect(() => validateTwitterData(validData)).not.toThrow();
      expect(isValidTwitterData(validData)).toBe(true);
    });

    test('accepts data with minimal required fields', () => {
      const minimalData: TwitterData = {
        text: 'Minimal tweet',
        author: {
          username: 'user',
          displayName: 'User'
        },
        url: 'https://x.com/user/status/123',
        date: null,
        likes: 0,
        retweets: 0,
        replies: 0,
        views: 0,
        bookmarks: 0,
        tweetType: 'original',
        platform_data: {
          tweet_id: '123',
          reply_count: 0,
          retweet_count: 0,
          bookmark_count: 0,
          view_count: 0
        }
      };
      expect(() => validateTwitterData(minimalData)).not.toThrow();
    });

    test('accepts data with x.com URL', () => {
      const data = createValidTwitterData();
      data.url = 'https://x.com/testuser/status/1234567890';
      expect(() => validateTwitterData(data)).not.toThrow();
    });

    test('accepts data with null date', () => {
      const data = createValidTwitterData();
      data.date = null;
      expect(() => validateTwitterData(data)).not.toThrow();
    });

    test('accepts data with retweeter info', () => {
      const data = createValidTwitterData();
      data.retweeter = {
        username: 'retweeter',
        displayName: 'Retweeter Name'
      };
      data.tweetType = 'retweet';
      expect(() => validateTwitterData(data)).not.toThrow();
    });
  });

  describe('invalid data rejection', () => {
    test('rejects null data', () => {
      expect(() => validateTwitterData(null)).toThrow(ValidationError);
      expect(() => validateTwitterData(null)).toThrow('Twitter data must be a non-null object');
    });

    test('rejects undefined data', () => {
      expect(() => validateTwitterData(undefined)).toThrow(ValidationError);
    });

    test('rejects non-object data', () => {
      expect(() => validateTwitterData('string')).toThrow(ValidationError);
      expect(() => validateTwitterData(123)).toThrow(ValidationError);
      expect(() => validateTwitterData([])).toThrow(ValidationError);
    });

    test('rejects missing text field', () => {
      const data = createValidTwitterData();
      delete (data as any).text;
      expect(() => validateTwitterData(data)).toThrow('Tweet text must be a string');
    });

    test('rejects empty text', () => {
      const data = createValidTwitterData();
      data.text = '';
      expect(() => validateTwitterData(data)).toThrow('Tweet text cannot be empty');
    });

    test('rejects text exceeding maximum length', () => {
      const data = createValidTwitterData();
      data.text = 'x'.repeat(10001);
      expect(() => validateTwitterData(data)).toThrow('Tweet text exceeds maximum length');
    });

    test('rejects invalid author structure', () => {
      const data = createValidTwitterData();
      data.author = { username: '', displayName: 'Test' } as any;
      expect(() => validateTwitterData(data)).toThrow('Invalid author data structure');
    });

    test('rejects non-Twitter URLs', () => {
      const data = createValidTwitterData();
      data.url = 'https://example.com/status/123';
      expect(() => validateTwitterData(data)).toThrow('Tweet URL must be a valid Twitter/X URL');
    });

    test('rejects http URLs (except localhost)', () => {
      const data = createValidTwitterData();
      data.url = 'http://twitter.com/user/status/123';
      expect(() => validateTwitterData(data)).toThrow('Tweet URL must be a valid Twitter/X URL');
    });

    test('rejects negative like count', () => {
      const data = createValidTwitterData();
      data.likes = -1;
      expect(() => validateTwitterData(data)).toThrow('Likes must be a non-negative number');
    });

    test('rejects non-number retweets', () => {
      const data = createValidTwitterData();
      (data as any).retweets = 'many';
      expect(() => validateTwitterData(data)).toThrow('Retweets must be a non-negative number');
    });

    test('rejects invalid tweet type', () => {
      const data = createValidTwitterData();
      (data as any).tweetType = 'invalid';
      expect(() => validateTwitterData(data)).toThrow('Invalid tweet type');
    });

    test('rejects invalid platform_data', () => {
      const data = createValidTwitterData();
      data.platform_data.reply_count = -5;
      expect(() => validateTwitterData(data)).toThrow('Invalid platform_data structure');
    });
  });

  describe('security edge cases', () => {
    test('rejects data with prototype pollution attempt', () => {
      const maliciousData = JSON.parse('{"__proto__": {"polluted": true}}');
      expect(() => validateTwitterData(maliciousData)).toThrow(ValidationError);
    });

    test('handles very long author username', () => {
      const data = createValidTwitterData();
      data.author.username = 'x'.repeat(101);
      expect(() => validateTwitterData(data)).toThrow('Invalid author data structure');
    });

    test('handles very long display name', () => {
      const data = createValidTwitterData();
      data.author.displayName = 'x'.repeat(201);
      expect(() => validateTwitterData(data)).toThrow('Invalid author data structure');
    });

    test('rejects javascript: protocol in URLs', () => {
      const data = createValidTwitterData();
      data.url = 'javascript:alert(1)';
      expect(() => validateTwitterData(data)).toThrow('Tweet URL must be a valid Twitter/X URL');
    });

    test('rejects data: protocol in avatar URLs', () => {
      const data = createValidTwitterData();
      data.author.avatarUrl = 'data:text/html,<script>alert(1)</script>';
      expect(() => validateTwitterData(data)).toThrow('Invalid author data structure');
    });

    test('handles NaN in numeric fields', () => {
      const data = createValidTwitterData();
      data.likes = NaN;
      expect(() => validateTwitterData(data)).toThrow('Likes must be a non-negative number');
    });

    test('handles Infinity in numeric fields', () => {
      const data = createValidTwitterData();
      data.views = Infinity;
      // Infinity is technically >= 0, so this should pass
      // This is intentional - we're not rejecting Infinity
      expect(() => validateTwitterData(data)).not.toThrow();
    });
  });

  describe('isValidTwitterData helper', () => {
    test('returns true for valid data', () => {
      expect(isValidTwitterData(createValidTwitterData())).toBe(true);
    });

    test('returns false for invalid data without throwing', () => {
      expect(isValidTwitterData(null)).toBe(false);
      expect(isValidTwitterData({})).toBe(false);
      expect(isValidTwitterData({ text: '' })).toBe(false);
    });
  });
});

describe('validateExtensionMessage', () => {
  describe('valid message acceptance', () => {
    test('accepts valid POST_DATA_EXTRACTED message', () => {
      const message = { type: 'POST_DATA_EXTRACTED', data: {} };
      expect(() => validateExtensionMessage(message)).not.toThrow();
    });

    test('accepts valid CHECK_AUTH_STATUS message', () => {
      const message = { type: 'CHECK_AUTH_STATUS' };
      expect(() => validateExtensionMessage(message)).not.toThrow();
    });

    test('accepts message with requestId', () => {
      const message = { type: 'GET_POST_DATA', requestId: 'abc123' };
      expect(() => validateExtensionMessage(message)).not.toThrow();
    });

    test('accepts all valid message types', () => {
      const validTypes = [
        'POST_DATA_EXTRACTED',
        'EXTRACT_POST_DATA',
        'GET_POST_DATA',
        'CHECK_AUTH_STATUS',
        'SUBMIT_QUOTE',
        'SEARCH_ORIGINATORS',
        'CHECK_DUPLICATE',
        'LOOKUP_ORIGINATOR_BY_HANDLE',
        'PREFLIGHT_CHECK',
        'UPDATE_COLLECTION_BADGE',
        'ORIGINATOR_LOOKUP_STATUS',
        'CLEANUP_STORAGE',
        'GET_STORAGE_STATS',
        'GET_DIAGNOSTICS',
        'OPEN_POPUP',
        'SHOW_OVERLAY',
        'OAUTH_LOGIN',
        'OAUTH_LOGOUT',
        'AUTH_STATE_GET',
        'AUTH_STATE_CHANGED',
        'AUTH_STATE_SUBSCRIBE',
        'SUCCESS',
        'ERROR'
      ];

      for (const type of validTypes) {
        expect(() => validateExtensionMessage({ type })).not.toThrow();
      }
    });
  });

  describe('invalid message rejection', () => {
    test('rejects null message', () => {
      expect(() => validateExtensionMessage(null)).toThrow(ValidationError);
    });

    test('rejects non-object message', () => {
      expect(() => validateExtensionMessage('string')).toThrow(ValidationError);
    });

    test('rejects message without type', () => {
      expect(() => validateExtensionMessage({})).toThrow('Message type must be a string');
    });

    test('rejects unknown message type', () => {
      expect(() => validateExtensionMessage({ type: 'UNKNOWN_TYPE' })).toThrow('Unknown message type');
    });

    test('rejects non-string type', () => {
      expect(() => validateExtensionMessage({ type: 123 })).toThrow('Message type must be a string');
    });

    test('rejects non-string requestId', () => {
      expect(() => validateExtensionMessage({ type: 'GET_POST_DATA', requestId: 123 }))
        .toThrow('requestId must be a string');
    });
  });

  describe('isValidExtensionMessage helper', () => {
    test('returns true for valid message', () => {
      expect(isValidExtensionMessage({ type: 'CHECK_AUTH_STATUS' })).toBe(true);
    });

    test('returns false for invalid message without throwing', () => {
      expect(isValidExtensionMessage(null)).toBe(false);
      expect(isValidExtensionMessage({ type: 'INVALID' })).toBe(false);
    });
  });
});

describe('ValidationError', () => {
  test('creates error with message and field', () => {
    const error = new ValidationError('Test message', 'testField');
    expect(error.message).toBe('Test message');
    expect(error.field).toBe('testField');
    expect(error.name).toBe('ValidationError');
  });

  test('creates error with only message', () => {
    const error = new ValidationError('Test message');
    expect(error.message).toBe('Test message');
    expect(error.field).toBeUndefined();
  });

  test('is instanceof Error', () => {
    const error = new ValidationError('Test');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ValidationError);
  });
});
