import { OverlayBar } from '../../src/content/ui/overlay-bar';
import type { TwitterData } from '../../src/types';

describe('overlay controls', () => {
  const tweetData: TwitterData = {
    text: 'A quote with enough text to render the overlay.',
    author: {
      username: 'author',
      displayName: 'Author',
    },
    url: 'https://x.com/author/status/123',
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
      view_count: 0,
    },
  };

  it('anchors refresh and close in the top-right control section with keyboard labels and focus styles', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    overlay.show('Twitter');
    await Promise.resolve();
    await Promise.resolve();

    const shadow = document.getElementById('qw-overlay-bar-root')?.shadowRoot;
    const styleText = shadow?.querySelector('style')?.textContent ?? '';
    const controlSection = shadow?.querySelector('.bar > .section.right');
    const refresh = shadow?.getElementById('refresh-btn') as HTMLButtonElement | null;
    const close = shadow?.getElementById('close-btn') as HTMLButtonElement | null;

    expect(controlSection).toBeTruthy();
    expect(styleText).toContain('.bar, .capture-row');
    expect(styleText).toContain('align-items: flex-start');
    expect(styleText).toContain('align-self: flex-start');
    expect(styleText).toContain('margin-left: auto');
    expect(styleText).toContain('button:focus-visible');

    expect(refresh?.tagName).toBe('BUTTON');
    expect(refresh?.getAttribute('aria-label')).toBe('Refresh tweet capture');
    expect(close?.tagName).toBe('BUTTON');
    expect(close?.getAttribute('aria-label')).toBe('Close capture tray');

    close?.focus();
    expect(shadow?.activeElement).toBe(close);
  });

  it('reports visibility so toolbar clicks can toggle an open tray closed', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    expect(overlay.isVisible()).toBe(false);
    overlay.show('Twitter');
    await Promise.resolve();
    await Promise.resolve();
    expect(overlay.isVisible()).toBe(true);

    overlay.hide();
    expect(overlay.isVisible()).toBe(false);
  });
});
