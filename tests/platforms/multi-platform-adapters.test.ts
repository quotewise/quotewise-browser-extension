import { BlueskyAdapter } from '../../src/platforms/bluesky/adapter';
import { SubstackNotesAdapter } from '../../src/platforms/substack-notes/adapter';
import { ThreadsAdapter } from '../../src/platforms/threads/adapter';

jest.mock('../../src/content/common', () => {
  const actual = jest.requireActual('../../src/content/common');
  return {
    ...actual,
    sendMessageToBackground: jest.fn().mockResolvedValue(undefined),
  };
});

describe('multi-platform adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('matches and extracts a Threads permalink', () => {
    const url = 'https://threads.com/@alice/post/Cabc123';
    document.head.innerHTML = '<link rel="canonical" href="https://threads.com/@alice/post/Cabc123?x=1">';
    document.body.innerHTML = `
      <article role="article">
        <a href="https://threads.com/@alice/post/Cabc123"><time datetime="2026-06-01T12:00:00Z"></time></a>
        <a href="/@alice"><span data-testid="post-author-name">Alice Writer</span></a>
        <div data-testid="post-text">A reliable Threads quote.</div>
        <button aria-label="12 likes">12</button>
      </article>
    `;

    const adapter = new ThreadsAdapter();
    expect(adapter.matches(new URL(url) as unknown as Location)).toBe(true);

    const data = adapter.extractFromDom(url);
    expect(data).toEqual(expect.objectContaining({
      platform: 'threads',
      platformCode: 'TH',
      sourceId: 'Cabc123',
      text: 'A reliable Threads quote.',
      postedAt: '2026-06-01T12:00:00Z',
      likesCount: 12,
    }));
    expect(data?.author.handle).toBe('alice');
  });

  it('matches and extracts a Bluesky permalink', () => {
    const url = 'https://bsky.app/profile/alice.bsky.social/post/3lxyz';
    document.body.innerHTML = `
      <div data-testid="postThreadItem">
        <a href="/profile/alice.bsky.social/post/3lxyz"><time datetime="2026-06-02T13:00:00Z"></time></a>
        <span data-testid="postAuthorDisplayName">Alice B.</span>
        <div data-testid="postText">A reliable Bluesky quote.</div>
        <button aria-label="4 likes">4</button>
      </div>
    `;

    const adapter = new BlueskyAdapter();
    expect(adapter.matches(new URL(url) as unknown as Location)).toBe(true);

    const data = adapter.extractFromDom(url);
    expect(data).toEqual(expect.objectContaining({
      platform: 'bluesky',
      platformCode: 'BS',
      sourceId: '3lxyz',
      text: 'A reliable Bluesky quote.',
      postedAt: '2026-06-02T13:00:00Z',
      likesCount: 4,
    }));
    expect(data?.author.handle).toBe('alice.bsky.social');
  });

  it('matches and extracts a Substack Note permalink', () => {
    const url = 'https://substack.com/@alice/note/c-12345';
    document.body.innerHTML = `
      <article>
        <a href="https://substack.com/@alice/note/c-12345"><time datetime="2026-06-03T14:00:00Z"></time></a>
        <a href="/@alice"><span data-testid="author-name">Alice Notes</span></a>
        <div data-testid="note-content">A reliable Substack Note quote.</div>
        <button aria-label="2 likes">2</button>
      </article>
    `;

    const adapter = new SubstackNotesAdapter();
    expect(adapter.matches(new URL(url) as unknown as Location)).toBe(true);

    const data = adapter.extractFromDom(url);
    expect(data).toEqual(expect.objectContaining({
      platform: 'substack_notes',
      platformCode: 'SS',
      sourceId: 'c-12345',
      text: 'A reliable Substack Note quote.',
      postedAt: '2026-06-03T14:00:00Z',
      likesCount: 2,
    }));
    expect(data?.author.handle).toBe('alice');
  });

  it('rejects non-permalink pages', () => {
    expect(new ThreadsAdapter().matches(new URL('https://threads.com/@alice') as unknown as Location)).toBe(false);
    expect(new BlueskyAdapter().matches(new URL('https://bsky.app/profile/alice.bsky.social') as unknown as Location)).toBe(false);
    expect(new SubstackNotesAdapter().matches(new URL('https://substack.com/@alice') as unknown as Location)).toBe(false);
  });
});
