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
  const setLocation = (url: string) => {
    const urlObj = new URL(url);
    try {
      (window as any).location.href = urlObj.toString();
      (window as any).location.pathname = urlObj.pathname;
      (window as any).location.hostname = urlObj.hostname;
      (window as any).location.host = urlObj.host;
      (window as any).location.origin = urlObj.origin;
      (window as any).location.protocol = urlObj.protocol;
    } catch {
      // jsdom may block direct reassignment in some cases; best-effort only
    }
  };

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
    setLocation('https://twitter.com/alice/status/1234567890');
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
});
