import { parseNumber, cleanUrl } from '../../src/content/common';

describe('cleanUrl — strips tracking junk a user may arrive with', () => {
  it('removes X/Twitter share tracking params (s, t)', () => {
    expect(cleanUrl('https://x.com/user/status/123?s=20&t=abcdef'))
      .toBe('https://x.com/user/status/123');
  });

  it('removes utm_* and ad-click tracking params', () => {
    expect(cleanUrl(
      'https://x.com/u/status/1?utm_source=news&utm_medium=email&utm_campaign=x' +
      '&utm_term=t&utm_content=c&fbclid=fb&gclid=gc&ref_src=twsrc&ref_url=r'
    )).toBe('https://x.com/u/status/1');
  });

  it('preserves non-tracking query params', () => {
    expect(cleanUrl('https://x.com/u/status/1?lang=en&s=20'))
      .toBe('https://x.com/u/status/1?lang=en');
  });

  it('leaves an already-clean URL untouched', () => {
    expect(cleanUrl('https://x.com/u/status/1')).toBe('https://x.com/u/status/1');
  });

  it('returns the input unchanged when the URL is malformed (never throws)', () => {
    expect(cleanUrl('not a url')).toBe('not a url');
    expect(cleanUrl('')).toBe('');
  });
});

describe('parseNumber', () => {
  it('parses plain integers', () => {
    expect(parseNumber('1424')).toBe(1424);
  });

  it('parses a full-number aria-label', () => {
    expect(parseNumber('100793 Likes. Like')).toBe(100793);
  });

  it('expands K/M/B magnitude suffixes', () => {
    expect(parseNumber('35.9K')).toBe(35900);
    expect(parseNumber('7.2M')).toBe(7200000);
    expect(parseNumber('1.5B')).toBe(1500000000);
  });

  it('does not treat a word beginning with K/M/B as a magnitude suffix', () => {
    expect(parseNumber('198 Bookmarks. Bookmarked')).toBe(198);
  });

  it('strips commas', () => {
    expect(parseNumber('2,453')).toBe(2453);
  });

  it('returns 0 for empty or non-numeric input', () => {
    expect(parseNumber('')).toBe(0);
    expect(parseNumber('Reply')).toBe(0);
  });
});
