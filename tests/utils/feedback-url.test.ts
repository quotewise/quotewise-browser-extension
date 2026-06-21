import { buildFeedbackUrl } from '../../src/utils/feedback-url';

describe('buildFeedbackUrl', () => {
  it('builds the hosted feedback destination with approved context', () => {
    const url = new URL(buildFeedbackUrl({ version: '1.6.1', platform: 'twitter' }));

    expect(url.origin).toBe('https://quotewise.io');
    expect(url.pathname).toBe('/feedback/');
    expect(url.searchParams.get('src')).toBe('chrome-ext');
    expect(url.searchParams.get('v')).toBe('1.6.1');
    expect(url.searchParams.get('platform')).toBe('twitter');
  });

  it('omits unavailable optional context instead of inventing fallbacks', () => {
    const url = new URL(buildFeedbackUrl({}));

    expect(url.searchParams.get('src')).toBe('chrome-ext');
    expect(url.searchParams.has('v')).toBe(false);
    expect(url.searchParams.has('platform')).toBe(false);
  });

  it('does not append unapproved current-page, account, collection, auth, or quote context', () => {
    const url = new URL(buildFeedbackUrl({
      version: '1.6.1',
      platform: 'twitter',
      quoteText: 'Sensitive quote text',
      selectedText: 'Sensitive selection',
      sourceUrl: 'https://x.com/person/status/123',
      handle: 'person',
      username: 'chris',
      collectionName: 'Private collection',
      token: 'secret-token',
      cookie: 'secret-cookie',
    } as Parameters<typeof buildFeedbackUrl>[0] & Record<string, string>));

    expect([...url.searchParams.keys()].sort()).toEqual(['platform', 'src', 'v']);
    expect(url.toString()).not.toContain('Sensitive');
    expect(url.toString()).not.toContain('x.com');
    expect(url.toString()).not.toContain('person');
    expect(url.toString()).not.toContain('chris');
    expect(url.toString()).not.toContain('Private');
    expect(url.toString()).not.toContain('secret');
  });
});
