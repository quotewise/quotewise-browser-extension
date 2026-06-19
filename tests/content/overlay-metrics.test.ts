import { OverlayBar } from '../../src/content/ui/overlay-bar';
import type { TwitterData } from '../../src/types';

describe('overlay metric cleanup', () => {
  const tweetData: TwitterData = {
    text: 'Metrics should stay out of the tray.',
    author: {
      username: 'author',
      displayName: 'Author',
    },
    url: 'https://x.com/author/status/123',
    date: '2026-05-07T12:00:00Z',
    likes: 10,
    retweets: 20,
    replies: 30,
    views: 40,
    bookmarks: 50,
    tweetType: 'original',
    platform_data: {
      tweet_id: '123',
      reply_count: 30,
      retweet_count: 20,
      bookmark_count: 50,
      view_count: 40,
    },
  };

  it('does not render author/date/metric chips in the tray', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    overlay.show('Twitter');
    await Promise.resolve();
    await Promise.resolve();

    const root = document.getElementById('qw-overlay-bar-root');
    const shadow = root?.shadowRoot;
    const barText = shadow?.querySelector('.bar')?.textContent ?? '';

    expect(shadow?.querySelector('#meta-row')).toBeNull();
    expect(shadow?.querySelector('.chip')).toBeNull();
    expect(barText).toContain('Metrics should stay out of the tray.');
    expect(barText).not.toContain('@author');
    expect(barText).not.toContain('10');
    expect(barText).not.toContain('20');
    expect(barText).not.toContain('30');
    expect(barText).not.toContain('40');
    expect(barText).not.toContain('50');
  });
});
