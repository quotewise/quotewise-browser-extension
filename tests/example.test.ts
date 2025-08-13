/**
 * Example test to verify test setup works
 */

import { MessageType } from '../src/types/index';

describe('Test Setup', () => {
  test('Chrome APIs are mocked', () => {
    expect(chrome).toBeDefined();
    expect(chrome.runtime).toBeDefined();
    expect(chrome.storage).toBeDefined();
    expect(chrome.tabs).toBeDefined();
  });

  test('MessageType enum is available', () => {
    expect(MessageType.TWEET_DATA_EXTRACTED).toBe('TWEET_DATA_EXTRACTED');
    expect(MessageType.GET_TWEET_DATA).toBe('GET_TWEET_DATA');
  });

  test('fetch is mocked', () => {
    expect(fetch).toBeDefined();
    expect(jest.isMockFunction(fetch)).toBe(true);
  });

  test('MutationObserver is mocked', () => {
    expect(MutationObserver).toBeDefined();
    const observer = new MutationObserver(() => {});
    expect(observer).toBeDefined();
  });
});

describe('Extension Message Types', () => {
  test('all message types are defined', () => {
    const expectedTypes = [
      'TWEET_DATA_EXTRACTED',
      'EXTRACT_TWEET_DATA',
      'GET_TWEET_DATA',
      'CHECK_AUTH_STATUS',
      'SUBMIT_QUOTE',
      'SEARCH_ORIGINATORS',
      'CHECK_DUPLICATE',
      'SUCCESS',
      'ERROR'
    ];

    expectedTypes.forEach(type => {
      expect(MessageType[type as keyof typeof MessageType]).toBeDefined();
    });
  });
});