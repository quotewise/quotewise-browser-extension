import { parseNumber } from '../../src/content/common';

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
