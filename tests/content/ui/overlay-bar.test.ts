import { OverlayBar } from '../../../src/content/ui/overlay-bar';
import { MessageType } from '../../../src/types';
import type { TwitterData } from '../../../src/types';
import type { DuplicateCheckResult } from '../../../src/types/api';

function makeDuplicateResult(
  sightingStatus: DuplicateCheckResult['matches'][number]['sighting_status']
): DuplicateCheckResult {
  return {
    recommendation: 'duplicate',
    confidence: 1,
    in_quotewise: true,
    matches: [{
      quote_id: 'q1',
      version_id: 1,
      text: 'A just submitted quote',
      similarity: 1,
      match_type: 'exact',
      in_user_collections: false,
      originator: { id: '1', full_name: 'Author', sort_name: null, birth_year: null, death_year: null },
      workflow_status: 'published',
      likes_count: 0,
      sighting_status: sightingStatus,
    }],
    reasoning: '',
    search_metadata: {},
  };
}

describe('OverlayBar', () => {
  const tweetData: TwitterData = {
    text: 'A just submitted quote',
    author: {
      username: 'author',
      displayName: 'Author',
    },
    url: 'https://twitter.com/author/status/123',
    date: '2026-05-07T12:00:00Z',
    likes: 1,
    retweets: 2,
    replies: 3,
    views: 4,
    bookmarks: 5,
    tweetType: 'original',
    platform_data: {
      tweet_id: '123',
      reply_count: 3,
      retweet_count: 2,
      bookmark_count: 5,
      view_count: 4,
    },
  };

  beforeEach(() => {
    jest.useFakeTimers();
    (chrome.runtime.sendMessage as jest.Mock).mockReset();
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.SUBMIT_QUOTE) {
        callback({ success: true, message: 'Quote submitted successfully', quoteId: 'q1' });
        return;
      }

      callback({ success: true });
    });
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedDuplicateCheck: {
        url: tweetData.url,
        result: { recommendation: 'new_quote' },
        timestamp: Date.now(),
      },
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('clears stale duplicate preload and auto-hides after 1000ms after successful submit', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };

    await (overlay as any).submitQuote();

    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['preloadedDuplicateCheck']);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('blocks submit when the exact sighting already exists', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.duplicateResult = makeDuplicateResult('exact_url');

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('blocks submit when a same-platform sighting already exists', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.duplicateResult = makeDuplicateResult('has_platform_sighting');

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('does not submit on an article page when nothing is selected', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = { ...tweetData, isArticle: true };
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.selectedText = null;

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('submits on an article page when a passage is selected', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = { ...tweetData, isArticle: true };
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.selectedText = 'a highlighted passage';

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('allows submit when only other-platform sightings exist', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.duplicateResult = makeDuplicateResult('no_platform_sighting');

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('submits with originator_slug, not the deprecated numeric originator_id', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = { ...tweetData };
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'kpaxs',
      full_name: 'Kpaxs',
      sort_name_display: 'Kpaxs',
      confidence: 1,
    };

    await (overlay as any).submitQuote();

    const submitCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(c => c[0]?.type === MessageType.SUBMIT_QUOTE);
    expect(submitCall).toBeDefined();
    expect(submitCall[0].data.originator_slug).toBe('kpaxs');
    expect(submitCall[0].data.originator_id).toBeUndefined();
  });

  it('does not submit when the resolved originator has no slug', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = { ...tweetData };
    (overlay as any).captureState.originator = {
      // No unique_id — e.g. a resolution path that failed to supply a slug.
      full_name: 'Kpaxs',
      sort_name_display: 'Kpaxs',
      confidence: 1,
    };

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('checks duplicates by originator_slug', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).currentData = { ...tweetData };

    await (overlay as any).checkDuplicate('kpaxs');

    const dupCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(c => c[0]?.type === MessageType.CHECK_DUPLICATE);
    expect(dupCall).toBeDefined();
    expect(dupCall[0].data.originator_slug).toBe('kpaxs');
    expect(dupCall[0].data.originator_id).toBeUndefined();
  });

  it('live-updates the selection when the user highlights after opening (article)', () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).currentData = { ...tweetData, isArticle: true };
    (overlay as any).captureState.originator = {
      id: 1, unique_id: 'kpaxs', full_name: 'Kpaxs', sort_name_display: 'Kpaxs', confidence: 1,
    };
    (overlay as any).captureState.selectedText = null;
    jest.spyOn(overlay as any, 'getPageSelection').mockReturnValue('a highlighted article passage');

    (overlay as any).onPageSelectionChanged();

    expect((overlay as any).captureState.selectedText).toBe('a highlighted article passage');
  });

  it('latches: does not clear an existing selection when selectionchange reports nothing', () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).currentData = { ...tweetData, isArticle: true };
    (overlay as any).captureState.selectedText = 'previously selected';
    jest.spyOn(overlay as any, 'getPageSelection').mockReturnValue(null);

    (overlay as any).onPageSelectionChanged();

    expect((overlay as any).captureState.selectedText).toBe('previously selected');
  });

  it('attaches and detaches the selectionchange watcher', () => {
    const addSpy = jest.spyOn(document, 'addEventListener');
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).startSelectionWatcher();
    expect(addSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function));

    (overlay as any).stopSelectionWatcher();
    expect(removeSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
