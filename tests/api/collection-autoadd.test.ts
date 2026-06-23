import { OverlayBar } from '../../src/content/ui/overlay-bar';
import { MessageType } from '../../src/types';
import type { TwitterData } from '../../src/types';

const tweetData: TwitterData = {
  text: 'A collection-bound quote',
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

function setupOverlay(): OverlayBar {
  const overlay = new OverlayBar(async () => tweetData);
  (overlay as any).currentData = tweetData;
  (overlay as any).captureState.originator = {
    id: 42,
    unique_id: 'author',
    full_name: 'Author',
    sort_name_display: 'Author',
    confidence: 1,
  };
  return overlay;
}

describe('collection auto-add submit wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      callback({ success: true, message: 'Quote submitted successfully', quoteId: 'q1' });
    });
  });

  it('includes collection_id when auto-add is enabled and a default collection is set', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: false,
        autoAddToCollection: true,
        defaultCollectionSlug: 'favorites',
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: true,
      },
    });

    await (setupOverlay() as any).submitQuote();

    const submitCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.SUBMIT_QUOTE);
    expect(submitCall[0].data.collection_id).toBe('favorites');
  });

  it('omits collection_id when auto-add is disabled', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: false,
        autoAddToCollection: false,
        defaultCollectionSlug: 'favorites',
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: true,
      },
    });

    await (setupOverlay() as any).submitQuote();

    const submitCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.SUBMIT_QUOTE);
    expect(submitCall[0].data.collection_id).toBeUndefined();
  });

  it('uses staged picker selections and adds remaining collections after capture', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: false,
        autoAddToCollection: true,
        defaultCollectionSlug: 'my-collected-quotes',
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: true,
      },
    });
    const overlay = setupOverlay() as any;
    overlay.collectionPicker = {
      getSelectedCollections: () => [
        collection('favorites', 'Favorites'),
        collection('research', 'Research'),
      ],
      setSelectedSlugs: jest.fn(),
    };

    await overlay.submitQuote();

    const submitCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.SUBMIT_QUOTE);
    const addCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.ADD_QUOTE_TO_COLLECTION);
    const badgeCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.UPDATE_COLLECTION_BADGE);

    expect(submitCall[0].data.collection_id).toBe('favorites');
    expect(addCall[0].data).toEqual({ collectionSlug: 'research', quoteId: 'q1' });
    expect(badgeCall[0].data.state).toBe('already_collected');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: {
        privateMode: false,
        autoAddToCollection: true,
        defaultCollectionSlug: 'my-collected-quotes',
        lastUsedCollectionSlugs: ['favorites', 'research'],
        firstRunNoticeShown: true,
      },
    });
  });
});

function collection(slug: string, name: string) {
  return {
    id: `id-${slug}`,
    slug,
    name,
    description: '',
    is_default: false,
    quote_count: 0,
    created_at: '2026-06-22T00:00:00Z',
    updated_at: '2026-06-22T00:00:00Z',
  };
}
