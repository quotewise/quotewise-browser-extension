/**
 * Unit tests for Twitter content script
 */

import { MessageType } from '../../src/types/index';

// Mock DOM setup
const mockArticle = document.createElement('article');
mockArticle.setAttribute('data-testid', 'tweet');

// Mock tweet content
const mockTweetText = document.createElement('div');
mockTweetText.setAttribute('data-testid', 'tweetText');
mockTweetText.textContent = 'This is a test tweet with some content';
mockArticle.appendChild(mockTweetText);

// Mock author info
const mockUserName = document.createElement('a');
mockUserName.setAttribute('href', '/testuser');
const mockUserSpan = document.createElement('span');
mockUserSpan.textContent = 'Test User';
mockUserName.appendChild(mockUserSpan);
mockArticle.appendChild(mockUserName);

describe('Twitter Content Script', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.body.appendChild(mockArticle);
  });

  describe('Page Detection', () => {
    test('should detect Twitter domain correctly', () => {
      const isTwitterDomain = (hostname: string) => hostname === 'twitter.com' || hostname === 'x.com';
      expect(isTwitterDomain('twitter.com')).toBe(true);
      expect(isTwitterDomain('x.com')).toBe(true);
      expect(isTwitterDomain('facebook.com')).toBe(false);
    });

    test('should detect tweet page URL pattern', () => {
      const isTweetUrl = (pathname: string) => /\/[^\/]+\/status\/\d+/.test(pathname);
      expect(isTweetUrl('/testuser/status/1234567890')).toBe(true);
      expect(isTweetUrl('/testuser/status/123')).toBe(true);
      expect(isTweetUrl('/testuser/media')).toBe(false);
      expect(isTweetUrl('/home')).toBe(false);
    });

    test('should combine domain and URL detection', () => {
      const isTweetPage = (hostname: string, pathname: string) => {
        const isTwitterDomain = hostname === 'twitter.com' || hostname === 'x.com';
        const isTweetUrl = /\/[^\/]+\/status\/\d+/.test(pathname);
        return isTwitterDomain && isTweetUrl;
      };

      expect(isTweetPage('twitter.com', '/user/status/123')).toBe(true);
      expect(isTweetPage('x.com', '/user/status/123')).toBe(true);
      expect(isTweetPage('facebook.com', '/user/status/123')).toBe(false);
      expect(isTweetPage('twitter.com', '/user/media')).toBe(false);
    });
  });

  describe('Metric Parsing', () => {
    test('should parse abbreviated numbers correctly', () => {
      const parseMetricValue = (text: string): number => {
        if (!text) return 0;
        
        const cleanText = text.replace(/[^\d.,KMBkmb]/g, '').trim();
        if (!cleanText) return 0;
        
        const patterns = [
          /^(\d+(?:\.\d+)?)\s*([KMBkmb])$/,
          /^(\d{1,3}(?:,\d{3})+)$/,
          /^(\d+)$/,
          /^(\d+\.\d+)$/
        ];
        
        for (const pattern of patterns) {
          const match = cleanText.match(pattern);
          if (match) {
            const value = parseFloat(match[1].replace(/,/g, ''));
            const suffix = match[2]?.toUpperCase();
            
            if (suffix) {
              switch (suffix) {
                case 'K': return Math.round(value * 1000);
                case 'M': return Math.round(value * 1000000);
                case 'B': return Math.round(value * 1000000000);
                default: return Math.round(value);
              }
            } else {
              return Math.round(value);
            }
          }
        }
        
        return 0;
      };

      expect(parseMetricValue('1.2K')).toBe(1200);
      expect(parseMetricValue('5.3M')).toBe(5300000);
      expect(parseMetricValue('2.1B')).toBe(2100000000);
      expect(parseMetricValue('1,234')).toBe(1234);
      expect(parseMetricValue('123')).toBe(123);
      expect(parseMetricValue('1.5')).toBe(2);
    });

    test('should handle edge cases in metric parsing', () => {
      const parseMetricValue = (text: string): number => {
        if (!text) return 0;
        const cleanText = text.replace(/[^\d.,KMBkmb]/g, '').trim();
        if (!cleanText) return 0;
        return parseInt(cleanText) || 0;
      };

      expect(parseMetricValue('')).toBe(0);
      expect(parseMetricValue('N/A')).toBe(0);
      expect(parseMetricValue('—')).toBe(0);
    });
  });

  describe('URL and ID Extraction', () => {
    test('should extract tweet ID from URL', () => {
      const extractTweetId = (pathname: string): string | null => {
        const match = pathname.match(/\/status\/(\d+)/);
        return match ? match[1] : null;
      };

      expect(extractTweetId('/user/status/1234567890')).toBe('1234567890');
      expect(extractTweetId('/testuser/status/123456')).toBe('123456');
      expect(extractTweetId('/user/media')).toBeNull();
    });

    test('should clean URLs properly', () => {
      const cleanUrl = (url: string): string => {
        try {
          const urlObj = new URL(url);
          const trackingParams = ['s', 't', 'ref_src', 'ref_url'];
          trackingParams.forEach(param => {
            urlObj.searchParams.delete(param);
          });
          return urlObj.toString();
        } catch {
          return url;
        }
      };

      const dirtyUrl = 'https://twitter.com/user/status/123?s=20&t=abc';
      const cleanedUrl = cleanUrl(dirtyUrl);
      expect(cleanedUrl).toBe('https://twitter.com/user/status/123');
    });
  });

  describe('Text Extraction', () => {
    test('should extract text content from tweet element', () => {
      const tweetElement = document.querySelector('[data-testid="tweetText"]');
      expect(tweetElement?.textContent).toBe('This is a test tweet with some content');
    });

    test('should handle missing tweet text gracefully', () => {
      const nonExistentElement = document.querySelector('[data-testid="nonexistent"]');
      expect(nonExistentElement).toBeNull();
    });
  });

  describe('Message Types', () => {
    test('should have correct message type constants', () => {
      expect(MessageType.TWEET_DATA_EXTRACTED).toBe('TWEET_DATA_EXTRACTED');
      expect(MessageType.GET_TWEET_DATA).toBe('GET_TWEET_DATA');
      expect(MessageType.EXTRACT_TWEET_DATA).toBe('EXTRACT_TWEET_DATA');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing DOM elements gracefully', () => {
      document.body.innerHTML = ''; // Remove all elements
      
      const safeQuerySelector = (selector: string): Element | null => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      };

      expect(safeQuerySelector('article[data-testid="tweet"]')).toBeNull();
      expect(safeQuerySelector('[data-testid="nonexistent"]')).toBeNull();
    });

    test('should validate data structure', () => {
      const validateExtractedData = (data: any) => {
        const errors: string[] = [];
        
        if (!data.text || data.text.trim().length === 0) {
          errors.push('Tweet text is missing or empty');
        }
        
        if (!data.author?.username && !data.author?.displayName) {
          errors.push('Author information is missing');
        }
        
        if (!data.platform_data?.tweet_id) {
          errors.push('Tweet ID is missing');
        }
        
        return {
          isValid: errors.length === 0,
          errors
        };
      };

      const validData = {
        text: 'Valid tweet text',
        author: { username: 'testuser', displayName: 'Test User' },
        platform_data: { tweet_id: '123456789' }
      };

      const invalidData = {
        text: '',
        author: { username: '', displayName: '' },
        platform_data: { tweet_id: null }
      };

      expect(validateExtractedData(validData).isValid).toBe(true);
      expect(validateExtractedData(invalidData).isValid).toBe(false);
      expect(validateExtractedData(invalidData).errors).toHaveLength(3);
    });
  });
});