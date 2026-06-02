import { TwitterAdapter } from '../../src/platforms/twitter/adapter';
import { MessageType } from '../../src/types';

// Mock background messaging to avoid real runtime calls
jest.mock('../../src/content/common', () => {
  const actual = jest.requireActual('../../src/content/common');
  return {
    ...actual,
    sendMessageToBackground: jest.fn().mockResolvedValue(undefined)
  };
});

describe('TwitterAdapter extraction', () => {
  const buildTweetDom = () => {
    document.body.innerHTML = `
      <div data-testid="socialContext">
        <a href="https://twitter.com/bob">Bob</a> Retweeted
      </div>
      <article data-testid="tweet">
        <div aria-label="Protected account"></div>
        <div data-testid="User-Name">
          <div>
            <span><span>Alice</span></span>
          </div>
          <a href="https://twitter.com/alice">Alice</a>
        </div>
        <div data-testid="Tweet-User-Avatar">
          <img src="https://pbs.twimg.com/profile_images/avatar.jpg" />
        </div>
        <div data-testid="tweetText">
          <span lang="en">Hello world from Twitter</span>
        </div>
        <a href="https://twitter.com/alice/status/1234567890"><time datetime="2023-01-01T00:00:00Z"></time></a>
        <div data-testid="reply" aria-label="3 Replies"></div>
        <div data-testid="retweet" aria-label="5 Retweets"></div>
        <div data-testid="like" aria-label="7 Likes"></div>
        <div data-testid="app-text-transition-container" aria-label="10 Views"></div>
        <div data-testid="bookmark" aria-label="2 Bookmarks"></div>
      </article>
    `;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    buildTweetDom();
  });

  test('matches tweet pages on twitter.com and x.com', () => {
    const adapter = new TwitterAdapter();
    expect(adapter.matches(new URL('https://twitter.com/alice/status/1234567890') as any)).toBe(true);
    expect(adapter.matches(new URL('https://x.com/alice/status/1234567890') as any)).toBe(true);
    expect(adapter.matches(new URL('https://example.com/') as any)).toBe(false);
  });

  test('extracts core tweet data including metrics and author', () => {
    const adapter = new TwitterAdapter();
    const data = (adapter as any).extractFromDom();

    expect(data).toBeTruthy();
    expect(data?.platform_data.tweet_id).toBe('1234567890');
    expect(data?.text).toContain('Hello world from Twitter');
    expect(data?.author.username).toBe('alice');
    expect(data?.author.displayName).toBe('Alice');
    expect(data?.retweeter?.username).toBe('bob');
    expect(data?.tweetType).toBe('retweet');
    expect(data?.likes).toBe(7);
    expect(data?.retweets).toBe(5);
    expect(data?.replies).toBe(3);
    expect(data?.views).toBe(10);
    expect(data?.bookmarks).toBe(2);
    expect(data?.language).toBe('en');
    expect(data?.url).toBeTruthy();
    expect(data?.isProtected).toBe(true);
    expect(data?.platform_data.is_protected).toBe(true);
  });

  test('handleMessage delegates extract requests', async () => {
    const adapter = new TwitterAdapter();
    const sendResponse = jest.fn();

    const handled = await adapter.handleMessage(
      { type: MessageType.EXTRACT_TWEET_DATA },
      sendResponse
    );

    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('extracts correct tweet when viewing a reply directly', () => {
    // Build DOM with parent tweet first (common Twitter layout for reply pages)
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <div><span><span>Original Author</span></span></div>
          <a href="https://twitter.com/original">Original Author</a>
        </div>
        <div data-testid="tweetText">
          <span lang="en">This is the original tweet</span>
        </div>
        <a href="https://twitter.com/original/status/1111111111"><time datetime="2023-01-01T00:00:00Z"></time></a>
      </article>
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <div><span><span>Replier</span></span></div>
          <a href="https://twitter.com/replier">Replier</a>
        </div>
        <div data-testid="tweetText">
          <span lang="en">This is my reply</span>
        </div>
        <a href="https://twitter.com/replier/status/9999999999"><time datetime="2023-01-02T00:00:00Z"></time></a>
      </article>
    `;

    const adapter = new TwitterAdapter();
    const replyUrl = 'https://twitter.com/replier/status/9999999999';

    // Verify URL tweet ID extraction works
    const urlTweetId = (adapter as any).extractTweetIdFromUrl(replyUrl);
    expect(urlTweetId).toBe('9999999999');

    // Verify we can find both articles
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    expect(articles.length).toBe(2);

    // Verify we can extract tweet IDs from both articles
    const firstArticleTweetId = (adapter as any).extractTweetIdFromArticleElement(articles[0]);
    const secondArticleTweetId = (adapter as any).extractTweetIdFromArticleElement(articles[1]);
    expect(firstArticleTweetId).toBe('1111111111');
    expect(secondArticleTweetId).toBe('9999999999');

    // Verify findPrimaryArticle selects the correct one when given the URL
    const primaryArticle = (adapter as any).findPrimaryArticle(replyUrl);
    const primaryTweetId = (adapter as any).extractTweetIdFromArticleElement(primaryArticle);
    expect(primaryTweetId).toBe('9999999999');
  });

  test('falls back to first article when no tweet ID matches URL', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <div><span><span>Alice</span></span></div>
          <a href="https://twitter.com/alice">Alice</a>
        </div>
        <div data-testid="tweetText">
          <span lang="en">First tweet in DOM</span>
        </div>
        <a href="https://twitter.com/alice/status/1234567890"><time datetime="2023-01-01T00:00:00Z"></time></a>
      </article>
    `;

    const adapter = new TwitterAdapter();
    // URL has a tweet ID that doesn't exist in DOM (edge case)
    const nonMatchingUrl = 'https://twitter.com/someone/status/9999999999';

    // Should fall back to first article when URL tweet ID doesn't match
    const primaryArticle = (adapter as any).findPrimaryArticle(nonMatchingUrl);
    const primaryTweetId = (adapter as any).extractTweetIdFromArticleElement(primaryArticle);
    expect(primaryTweetId).toBe('1234567890');
  });

  test('deprioritizes quoted tweets embedded in articles', () => {
    // Simulate a tweet that contains a quoted tweet
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <div><span><span>Main Author</span></span></div>
          <a href="https://twitter.com/main">Main Author</a>
        </div>
        <div data-testid="tweetText">
          <span lang="en">Check out this tweet</span>
        </div>
        <a href="https://twitter.com/main/status/1111111111"><time datetime="2023-01-01T00:00:00Z"></time></a>
        <div data-testid="quotedTweet">
          <article data-testid="tweet">
            <div data-testid="User-Name">
              <div><span><span>Quoted Author</span></span></div>
              <a href="https://twitter.com/quoted">Quoted Author</a>
            </div>
            <div data-testid="tweetText">
              <span lang="en">This is the quoted tweet</span>
            </div>
            <a href="https://twitter.com/quoted/status/2222222222"><time datetime="2023-01-01T00:00:00Z"></time></a>
          </article>
        </div>
      </article>
    `;

    const adapter = new TwitterAdapter();

    // Without URL override, should select the main tweet (not the quoted one)
    const primaryArticle = (adapter as any).findPrimaryArticle();
    const primaryTweetId = (adapter as any).extractTweetIdFromArticleElement(primaryArticle);
    expect(primaryTweetId).toBe('1111111111');
  });

  test('uses primaryColumn positioning when no URL match', () => {
    // Simulate Twitter layout with primaryColumn
    document.body.innerHTML = `
      <div data-testid="sidebarColumn">
        <article data-testid="tweet">
          <a href="https://twitter.com/sidebar/status/3333333333"><time datetime="2023-01-01T00:00:00Z"></time></a>
        </article>
      </div>
      <div data-testid="primaryColumn">
        <article data-testid="tweet">
          <div data-testid="User-Name">
            <div><span><span>Primary Author</span></span></div>
            <a href="https://twitter.com/primary">Primary Author</a>
          </div>
          <div data-testid="tweetText">
            <span lang="en">This is in the primary column</span>
          </div>
          <a href="https://twitter.com/primary/status/4444444444"><time datetime="2023-01-01T00:00:00Z"></time></a>
        </article>
      </div>
    `;

    const adapter = new TwitterAdapter();

    // Without URL, should prefer the primary column article
    const primaryArticle = (adapter as any).findPrimaryArticle();
    const primaryTweetId = (adapter as any).extractTweetIdFromArticleElement(primaryArticle);
    expect(primaryTweetId).toBe('4444444444');
  });

  test('captures the X Article read-view body, not the subscribe CTA', () => {
    // Real X Article structure (confirmed on live page): there is no
    // [data-testid="tweetText"]; the body lives in
    // twitterArticleReadView > twitterArticleRichTextView > longformRichTextComponent,
    // and its paragraphs carry no [lang]/dir="auto". The bare "Click to
    // Subscribe to <name>" CTA is a plain div[dir="auto"] (no role/button/testid
    // hook) that appears before any rich-text content.
    document.body.innerHTML = `
      <article data-testid="tweet" role="article">
        <div data-testid="User-Name">
          <div><span><span>Kpaxs</span></span></div>
          <a href="https://twitter.com/Kpaxs">Kpaxs</a>
        </div>
        <div><div><div dir="auto">Click to Subscribe to Kpaxs</div></div></div>
        <div data-testid="twitterArticleReadView">
          <div data-testid="twitterArticleRichTextView">
            <div data-testid="longformRichTextComponent">
              <div><span><span>When you decide whether to do some hard, scary, agentic thing, the real skill is judgment.</span></span></div>
            </div>
          </div>
        </div>
        <a href="https://twitter.com/Kpaxs/status/2061435378024739198"><time datetime="2023-01-01T00:00:00Z"></time></a>
      </article>
    `;

    const adapter = new TwitterAdapter();
    const article = document.querySelector('article') as HTMLElement;
    const text = (adapter as any).extractTweetText(article);

    expect(text).toContain('the real skill is judgment');
    expect(text).not.toMatch(/Subscribe/);
  });

  test('skips the bare subscribe CTA but still returns it as a last resort so capture opens', () => {
    // Defensive: if no real body can be located, returning null would stop the
    // overlay from opening at all. Capture must still open (the user's selection
    // can then drive the quote), so extraction returns the only text it found.
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div dir="auto">Click to Subscribe to Kpaxs</div>
        <a href="https://twitter.com/Kpaxs/status/5555555555"><time datetime="2023-01-01T00:00:00Z"></time></a>
      </article>
    `;

    const adapter = new TwitterAdapter();
    const article = document.querySelector('article') as HTMLElement;

    expect((adapter as any).extractTweetText(article)).toBe('Click to Subscribe to Kpaxs');
  });

  test('flags X Article pages via isArticle', () => {
    document.body.innerHTML = `
      <article data-testid="tweet" role="article">
        <div data-testid="User-Name">
          <div><span><span>Kpaxs</span></span></div>
          <a href="https://twitter.com/Kpaxs">Kpaxs</a>
        </div>
        <div data-testid="twitterArticleReadView">
          <div data-testid="twitterArticleRichTextView">
            <div data-testid="longformRichTextComponent">
              <div><span><span>The body of a long-form article.</span></span></div>
            </div>
          </div>
        </div>
        <a href="https://twitter.com/Kpaxs/status/2061435378024739198"><time datetime="2023-01-01T00:00:00Z"></time></a>
      </article>
    `;

    const adapter = new TwitterAdapter();
    const data = (adapter as any).extractFromDom();

    expect(data?.isArticle).toBe(true);
  });

  test('does not flag a normal tweet as an article', () => {
    // beforeEach() installs a normal tweet DOM (with [data-testid="tweetText"]).
    const adapter = new TwitterAdapter();
    const data = (adapter as any).extractFromDom();

    expect(data?.isArticle).toBe(false);
  });

  test('calculates priority scores correctly', () => {
    document.body.innerHTML = `
      <div data-testid="primaryColumn">
        <div data-testid="cellInnerDiv">
          <article data-testid="tweet" tabindex="0">
            <a href="https://twitter.com/user/status/1111111111"><time></time></a>
          </article>
        </div>
        <div data-testid="cellInnerDiv">
          <article data-testid="tweet">
            <a href="https://twitter.com/user/status/2222222222"><time></time></a>
          </article>
        </div>
      </div>
    `;

    const adapter = new TwitterAdapter();
    const articles = document.querySelectorAll('article[data-testid="tweet"]');

    // First article should have higher priority (primaryColumn first + cellInnerDiv first + tabindex)
    const firstPriority = (adapter as any).calculateArticlePriority(articles[0], 0, null);
    const secondPriority = (adapter as any).calculateArticlePriority(articles[1], 1, null);

    expect(firstPriority).toBeGreaterThan(secondPriority);

    // URL match should give highest priority even to second article
    const secondWithUrlMatch = (adapter as any).calculateArticlePriority(articles[1], 1, '2222222222');
    expect(secondWithUrlMatch).toBeGreaterThan(firstPriority);
  });
});
