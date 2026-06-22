import { BlueskyAdapter } from '../../src/platforms/bluesky/adapter';
import { SubstackNotesAdapter } from '../../src/platforms/substack-notes/adapter';
import { ThreadsAdapter } from '../../src/platforms/threads/adapter';
import { platformFromUrl, sourceIdFromUrl } from '../../src/platforms/capture';

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

  it('uses browser URL identity for Threads replies when metadata points to parent context', () => {
    const url = 'https://www.threads.com/@arturoztalin/post/DZ3e05qlNxc?xmt=ignored';
    document.head.innerHTML = `
      <link rel="canonical" href="https://www.threads.com/@die_workwear/post/DZ3U4c5j30i">
      <meta property="og:url" content="https://www.threads.com/@die_workwear/post/DZ3U4c5j30i">
      <meta property="og:title" content="Derek Guy (@die_workwear) on Threads">
      <meta property="og:description" content="Parent post text should not be captured.">
    `;
    document.body.innerHTML = `
      <div>
        <a href="/@die_workwear/post/DZ3U4c5j30i"><time datetime="2026-06-21T22:20:15.000Z">3h</time></a>
        <span>Parent post text should not be captured.</span>
        <button aria-label="Like">Like</button><span>2.3K</span><button aria-label="Reply">Reply</button>
      </div>
      <div data-thread-root>
        <a href="/@arturoztalin">arturoztalin</a>
        <a href="/@arturoztalin/post/DZ3e05qlNxc"><time datetime="2026-06-21T23:47:09.000Z">1h</time></a>
        <span>Wait a sec.... 😅</span>
        <button aria-label="Like">Like</button><span>1</span><button aria-label="Reply">Reply</button>
      </div>
    `;

    const data = new ThreadsAdapter().extractFromDom(url);

    expect(data).toEqual(expect.objectContaining({
      platform: 'threads',
      platformCode: 'TH',
      sourceUrl: 'https://www.threads.com/@arturoztalin/post/DZ3e05qlNxc',
      sourceId: 'DZ3e05qlNxc',
      text: 'Wait a sec.... 😅',
      postedAt: '2026-06-21T23:47:09.000Z',
      likesCount: 1,
    }));
    expect(data?.author.handle).toBe('arturoztalin');
  });

  it('preserves multiline Threads text from sibling visible rows', () => {
    const url = 'https://www.threads.com/@tobbigray/post/DZ2axAxDR32';
    document.head.innerHTML = `
      <link rel="canonical" href="https://www.threads.com/">
      <meta property="og:url" content="https://www.threads.com/">
      <meta property="og:description" content="Join Threads to share ideas.">
    `;
    document.body.innerHTML = '<div data-thread-root><a href="/@tobbigray">tobbigray</a><a href="/@tobbigray/post/DZ2axAxDR32"><time datetime="2026-06-21T13:52:25.000Z">14h</time></a><div class="body"><div>seriously be careful out there everyone</div><div>i had 2 Microsoft Copilot licenses in my car, and someone broke in and left 4 more</div></div><button aria-label="Like">Like</button><span>5.3K</span><button aria-label="Reply">Reply</button></div>';

    const data = new ThreadsAdapter().extractFromDom(url);

    expect(data).toEqual(expect.objectContaining({
      platform: 'threads',
      sourceId: 'DZ2axAxDR32',
      text: 'seriously be careful out there everyone\ni had 2 Microsoft Copilot licenses in my car, and someone broke in and left 4 more',
      postedAt: '2026-06-21T13:52:25.000Z',
      likesCount: 5300,
    }));
    expect(data?.author.handle).toBe('tobbigray');
  });

  it('matches Threads /t/ permalinks on threads.net redirects', () => {
    const url = 'https://www.threads.net/@alice/t/Credirect123';
    document.body.innerHTML = `
      <article role="article">
        <a href="https://www.threads.net/@alice/t/Credirect123"><time datetime="2026-06-01T12:00:00Z"></time></a>
        <a href="/@alice"><span data-testid="post-author-name">Alice Writer</span></a>
        <div data-testid="thread-text">A Threads redirect quote.</div>
      </article>
    `;

    const adapter = new ThreadsAdapter();
    expect(adapter.matches(new URL(url) as unknown as Location)).toBe(true);
    expect(sourceIdFromUrl(url)).toBe('Credirect123');

    const data = adapter.extractFromDom(url);
    expect(data).toEqual(expect.objectContaining({
      platform: 'threads',
      platformCode: 'TH',
      sourceId: 'Credirect123',
      text: 'A Threads redirect quote.',
    }));
    expect(data?.author.handle).toBe('alice');
  });

  it('matches and extracts a Bluesky permalink from the visible handle-scoped root', () => {
    const url = 'https://bsky.app/profile/alice.bsky.social/post/3lxyz';
    document.head.innerHTML = `
      <link rel="canonical" href="https://bsky.app/">
      <meta property="og:description" content="Stale metadata should not be captured.">
    `;
    document.body.innerHTML = `
      <div data-testid="postThreadItem-by-stale.bsky.social">
        <div data-testid="postText">Hidden feed content should not be captured.</div>
        <button aria-label="Like (45 likes)">45</button>
      </div>
      <div data-testid="postThreadItem-by-alice.bsky.social">
        <a href="/profile/alice.bsky.social">Alice B.@alice.bsky.social</a>
        <a href="/profile/alice.bsky.social/post/3lxyz">6:03 PM · Jun 21, 2026</a>
        <div data-testid="postText">A reliable Bluesky quote.</div>
        <div data-testid="likeCount-expanded">4 likes</div>
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
      likesCount: 4,
    }));
    expect(data?.author.handle).toBe('alice.bsky.social');
    expect(data?.author.displayName).toBe('Alice B.');
    expect(data?.postedAt).toBeUndefined();
  });

  it('selects the focal Bluesky post in a thread by URL rkey', () => {
    const url = 'https://bsky.app/profile/replier.bsky.social/post/3target';
    document.body.innerHTML = `
      <div data-testid="postThreadItem">
        <a href="/profile/parent.bsky.social/post/3parent"><time datetime="2026-06-01T12:00:00Z"></time></a>
        <span data-testid="postAuthorDisplayName">Parent</span>
        <div data-testid="postText">Parent context should not be captured.</div>
      </div>
      <div data-testid="postThreadItem">
        <a href="/profile/replier.bsky.social/post/3target"><time datetime="2026-06-02T12:00:00Z"></time></a>
        <span data-testid="postAuthorDisplayName">Replier</span>
        <div data-testid="postText">The focal Bluesky reply.</div>
      </div>
    `;

    const data = new BlueskyAdapter().extractFromDom(url);

    expect(data).toEqual(expect.objectContaining({
      platform: 'bluesky',
      platformCode: 'BS',
      sourceId: '3target',
      text: 'The focal Bluesky reply.',
    }));
    expect(data?.author.handle).toBe('replier.bsky.social');
    expect(data?.postedAt).toBeUndefined();
  });

  it('keeps Bluesky link-card text out of focal post text', () => {
    const url = 'https://bsky.app/profile/vulture.com/post/3motti7lzfi2q';
    document.body.innerHTML = `
      <div data-testid="postThreadItem-by-vulture.com">
        <a href="/profile/vulture.com">Vulture@vulture.com</a>
        <div data-testid="postText">“Toronto” mostly takes place on a soundstage, shifting between the interview and flashbacks.</div>
        <a href="https://www.vulture.com/article/the-vampire-lestat-recap-episode-3-toronto-amc.html">
          <span>The Vampire Lestat Recap: Brave Little Wolfkiller</span>
          <span>Link-card body should stay out of captured text.</span>
          <img alt="">
        </a>
        <div data-testid="likeCount-expanded">2 likes</div>
      </div>
    `;

    const data = new BlueskyAdapter().extractFromDom(url);

    expect(data).toEqual(expect.objectContaining({
      platform: 'bluesky',
      sourceId: '3motti7lzfi2q',
      text: '“Toronto” mostly takes place on a soundstage, shifting between the interview and flashbacks.',
      likesCount: 2,
    }));
    expect(data?.platformData?.has_media).toBe(true);
  });

  it('preserves Bluesky paragraph breaks in postText', () => {
    const url = 'https://bsky.app/profile/dearlstephens.bsky.social/post/3motjjgwmz22f';
    document.body.innerHTML = `
      <div data-testid="postThreadItem-by-dearlstephens.bsky.social">
        <a href="/profile/dearlstephens.bsky.social">D. Earl Stephens@dearlstephens.bsky.social</a>
        <div data-testid="postText">First paragraph with a thought.

Second paragraph after a blank line.</div>
        <button aria-label="Like (5.3K likes)">5.3K</button>
      </div>
    `;

    const data = new BlueskyAdapter().extractFromDom(url);

    expect(data?.text).toBe('First paragraph with a thought.\n\nSecond paragraph after a blank line.');
    expect(data?.likesCount).toBe(5300);
  });

  it('extracts likes from the number attached to the likes label', () => {
    const url = 'https://bsky.app/profile/alice.bsky.social/post/3likes';
    document.body.innerHTML = `
      <div data-testid="postThreadItem">
        <a href="/profile/alice.bsky.social/post/3likes"><time datetime="2026-06-02T13:00:00Z"></time></a>
        <span data-testid="postAuthorDisplayName">Alice B.</span>
        <div data-testid="postText">A quote with compound metrics.</div>
        <button aria-label="12 replies, 4 likes">4</button>
      </div>
    `;

    const data = new BlueskyAdapter().extractFromDom(url);

    expect(data?.likesCount).toBe(4);
  });

  it('omits likes when the visible label has no reliable like count', () => {
    const url = 'https://bsky.app/profile/alice.bsky.social/post/3nolikes';
    document.body.innerHTML = `
      <div data-testid="postThreadItem">
        <a href="/profile/alice.bsky.social/post/3nolikes"><time datetime="2026-06-02T13:00:00Z"></time></a>
        <span data-testid="postAuthorDisplayName">Alice B.</span>
        <div data-testid="postText">A quote with an action-only like label.</div>
        <button aria-label="12 replies, like">Like</button>
      </div>
    `;

    const data = new BlueskyAdapter().extractFromDom(url);

    expect(data?.likesCount).toBeUndefined();
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

  it('extracts Substack profile note identity and zero counts from metadata', () => {
    const url = 'https://substack.com/profile/3476382-juliette-ryan/note/c-280494491';
    document.head.innerHTML = `
      <link rel="canonical" href="https://substack.com/profile/3476382-juliette-ryan/note/c-280494491">
      <meta property="og:url" content="https://substack.com/profile/3476382-juliette-ryan/note/c-280494491">
      <meta property="og:title" content="Juliette Ryan (@hereisyourbrain)">
      <meta property="og:description" content="Here is the beautiful neuroscience behind the sadness of something ending.">
      <meta property="og:published_time" content="2026-06-22T02:48:35.112Z">
      <meta name="twitter:label1" content="Likes">
      <meta name="twitter:data1" content="0">
      <meta name="twitter:label2" content="Replies">
      <meta name="twitter:data2" content="0">
    `;
    document.body.innerHTML = `
      <div role="article" aria-label="Note">
        <a href="/@stoicwisdoms/note/c-280076000">18h</a>
        <p>Parent note text should not be captured.</p>
      </div>
      <div role="article" aria-label="Note">
        <a href="/@hereisyourbrain/note/c-280494491">1h</a>
        <div class="ProseMirror FeedProseMirror"><p>Visible fallback text with paragraph spacing.</p></div>
        <button aria-label="Like"></button>
        <button aria-label="Comment"></button>
      </div>
    `;

    const data = new SubstackNotesAdapter().extractFromDom(url);

    expect(data).toEqual(expect.objectContaining({
      platform: 'substack_notes',
      platformCode: 'SS',
      sourceUrl: 'https://substack.com/profile/3476382-juliette-ryan/note/c-280494491',
      sourceId: 'c-280494491',
      text: 'Here is the beautiful neuroscience behind the sadness of something ending.',
      postedAt: '2026-06-22T02:48:35.112Z',
      likesCount: 0,
    }));
    expect(data?.author).toEqual(expect.objectContaining({
      handle: 'hereisyourbrain',
      displayName: 'Juliette Ryan',
    }));
    expect(data?.platformData).toEqual(expect.objectContaining({
      reply_count: 0,
      author_profile_slug: '3476382-juliette-ryan',
    }));
  });

  it('keeps Substack Notes matching scoped to substack.com hosts', () => {
    expect(platformFromUrl('https://substack.com/@alice/note/c-12345')).toBe('substack_notes');
    expect(platformFromUrl('https://alice.substack.com/p/c-12345')).toBe('substack_notes');
    expect(new SubstackNotesAdapter().matches(new URL('https://notes.example.com/note/c-12345') as unknown as Location)).toBe(false);
  });

  it('rejects non-permalink pages', () => {
    expect(new ThreadsAdapter().matches(new URL('https://threads.com/@alice') as unknown as Location)).toBe(false);
    expect(new BlueskyAdapter().matches(new URL('https://bsky.app/profile/alice.bsky.social') as unknown as Location)).toBe(false);
    expect(new SubstackNotesAdapter().matches(new URL('https://substack.com/@alice') as unknown as Location)).toBe(false);
  });
});
