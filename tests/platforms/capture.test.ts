/**
 * Robustness tests for the pure URL/identity helpers that decide, from whatever
 * URL a user happens to land on, which platform we're on, what post they're
 * looking at, and whether a client-side navigation moved them to a *different*
 * post (the "cycling" signal that restarts the adapter). A user can navigate to
 * anything, so every one of these must degrade to null/false — never throw.
 */
import {
  platformFromUrl,
  sourceIdFromUrl,
  isSameCaptureUrl,
  isSupportedPermalinkUrl,
} from '../../src/platforms/capture';

describe('platformFromUrl — host matching', () => {
  it('matches supported hosts, their subdomains, and www, case-insensitively', () => {
    expect(platformFromUrl('https://x.com/u/status/1')).toBe('twitter');
    expect(platformFromUrl('https://twitter.com/u/status/1')).toBe('twitter');
    expect(platformFromUrl('https://www.x.com/u/status/1')).toBe('twitter');
    expect(platformFromUrl('https://mobile.twitter.com/u/status/1')).toBe('twitter');
    expect(platformFromUrl('HTTPS://X.COM/u/status/1')).toBe('twitter');
    expect(platformFromUrl('https://threads.com/@a/post/C1')).toBe('threads');
    expect(platformFromUrl('https://bsky.app/profile/a/post/1')).toBe('bluesky');
  });

  it('does not match lookalike or unsupported hosts', () => {
    expect(platformFromUrl('https://x.com.evil.com/u/status/1')).toBeNull();
    expect(platformFromUrl('https://evil-x.com/u/status/1')).toBeNull();
    expect(platformFromUrl('https://notx.com/u/status/1')).toBeNull();
    expect(platformFromUrl('https://example.com/u/status/1')).toBeNull();
  });

  it('returns null for empty, undefined, or unparseable input without throwing', () => {
    expect(platformFromUrl('')).toBeNull();
    expect(platformFromUrl(undefined)).toBeNull();
    expect(platformFromUrl('not a url')).toBeNull();
    expect(platformFromUrl('javascript:alert(1)')).toBeNull();
    expect(platformFromUrl('chrome://extensions')).toBeNull();
    expect(platformFromUrl('about:blank')).toBeNull();
  });
});

describe('sourceIdFromUrl — permalink id extraction', () => {
  it('extracts the post id from valid permalinks (including /photo sub-paths)', () => {
    expect(sourceIdFromUrl('https://x.com/u/status/1234567890')).toBe('1234567890');
    expect(sourceIdFromUrl('https://twitter.com/i/status/42')).toBe('42');
    expect(sourceIdFromUrl('https://x.com/u/status/99/photo/1')).toBe('99');
  });

  it('ignores tracking params and fragments after the id', () => {
    expect(sourceIdFromUrl('https://x.com/u/status/1?s=20&t=abc')).toBe('1');
    expect(sourceIdFromUrl('https://x.com/u/status/1#anchor')).toBe('1');
  });

  it('returns null on non-permalink pages (profile, home, search, non-numeric id)', () => {
    expect(sourceIdFromUrl('https://x.com/someuser')).toBeNull();
    expect(sourceIdFromUrl('https://x.com/home')).toBeNull();
    expect(sourceIdFromUrl('https://x.com/search?q=hi')).toBeNull();
    expect(sourceIdFromUrl('https://x.com/u/status/notanumber')).toBeNull();
  });

  it('returns null for unsupported host or garbage input without throwing', () => {
    expect(sourceIdFromUrl('https://example.com/u/status/1')).toBeNull();
    expect(sourceIdFromUrl('')).toBeNull();
    expect(sourceIdFromUrl(undefined)).toBeNull();
    expect(sourceIdFromUrl('not a url')).toBeNull();
  });
});

describe('isSameCaptureUrl — SPA navigation / cycling detection', () => {
  it('treats the same post with different tracking params as the same capture', () => {
    // Re-opening the same tweet (X appends ?s=20) must NOT trigger an adapter restart.
    expect(isSameCaptureUrl(
      'https://x.com/u/status/123',
      'https://x.com/u/status/123?s=20&t=abc',
    )).toBe(true);
  });

  it('treats twitter.com and x.com mirrors of the same post as the same capture', () => {
    expect(isSameCaptureUrl(
      'https://twitter.com/u/status/123',
      'https://x.com/u/status/123',
    )).toBe(true);
  });

  it('treats a different post id as a different capture (cycling to a new tweet restarts)', () => {
    expect(isSameCaptureUrl(
      'https://x.com/u/status/123',
      'https://x.com/u/status/456',
    )).toBe(false);
  });

  it('treats a permalink vs a non-permalink page as different', () => {
    expect(isSameCaptureUrl('https://x.com/u/status/123', 'https://x.com/u')).toBe(false);
  });

  it('never returns a false positive when either side is a non-permalink or garbage', () => {
    expect(isSameCaptureUrl('https://x.com/home', 'https://x.com/explore')).toBe(false);
    expect(isSameCaptureUrl('https://x.com/u/status/1', 'not a url')).toBe(false);
    expect(isSameCaptureUrl(undefined, undefined)).toBe(false);
    expect(isSameCaptureUrl('', '')).toBe(false);
  });
});

describe('isSupportedPermalinkUrl — validator gate', () => {
  it('accepts supported permalinks and rejects profiles, unsupported hosts, and garbage', () => {
    expect(isSupportedPermalinkUrl('https://x.com/u/status/1')).toBe(true);
    expect(isSupportedPermalinkUrl('https://x.com/u')).toBe(false);
    expect(isSupportedPermalinkUrl('https://example.com/u/status/1')).toBe(false);
    expect(isSupportedPermalinkUrl('not a url')).toBe(false);
    expect(isSupportedPermalinkUrl(undefined)).toBe(false);
  });
});
