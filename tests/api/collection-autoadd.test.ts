import { OverlayBar } from '../../src/content/ui/overlay-bar';
import { MessageType } from '../../src/types';
import type { TwitterData } from '../../src/types';
import type { Collection } from '../../src/types/api';

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

  it('adds the default collection after capture when auto-add is enabled', async () => {
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
    const addCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.ADD_QUOTE_TO_COLLECTION);

    expect(submitCall[0].data.collection_id).toBeUndefined();
    expect(addCall[0].data).toEqual({ collectionSlug: 'favorites', quoteId: 'q1' });
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

  it('uses staged picker selections and adds every collection after capture', async () => {
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
    const addCalls = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .filter(([message]) => message.type === MessageType.ADD_QUOTE_TO_COLLECTION);
    const badgeCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.UPDATE_COLLECTION_BADGE);

    expect(submitCall[0].data.collection_id).toBeUndefined();
    expect(addCalls.map(([message]) => message.data)).toEqual([
      { collectionSlug: 'favorites', quoteId: 'q1' },
      { collectionSlug: 'research', quoteId: 'q1' },
    ]);
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

  it('resolves a stale selected collection with a blank slug before adding it', async () => {
    const emojiName = '😀😍🎉🌈🐶🍕🚀🎸🌺🦄';
    const emojiId = '71df677a-e62e-4a45-a13a-60b915b13bab';
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: false,
        autoAddToCollection: true,
        defaultCollectionSlug: null,
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: true,
      },
    });
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.SUBMIT_QUOTE) {
        callback({ success: true, message: 'Quote submitted successfully', quoteId: 'q1' });
        return;
      }
      if (message.type === MessageType.LIST_COLLECTIONS) {
        callback({
          success: true,
          collections: [{ ...collection('emojislug', emojiName), id: emojiId }],
          default_collection_id: null,
        });
        return;
      }
      if (message.type === MessageType.ADD_QUOTE_TO_COLLECTION) {
        callback({ success: true });
        return;
      }
      callback({ success: true });
    });

    const overlay = setupOverlay() as any;
    overlay.collectionPicker = {
      getSelectedCollections: () => [{ ...collection('', emojiName), id: emojiId }],
      setSelectedSlugs: jest.fn(),
    };

    await overlay.submitQuote();

    const listCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.LIST_COLLECTIONS);
    const addCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.ADD_QUOTE_TO_COLLECTION);

    expect(listCall[0].data).toEqual({ forceRefresh: true });
    expect(addCall[0].data).toEqual({ collectionSlug: 'emojislug', quoteId: 'q1' });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: {
        privateMode: false,
        autoAddToCollection: true,
        defaultCollectionSlug: null,
        lastUsedCollectionSlugs: ['emojislug'],
        firstRunNoticeShown: true,
      },
    });
  });

  it('does not call collection add when submit omits the canonical version_id-derived quoteId', async () => {
    const emojiName = '😀😍🎉🌈🐶🍕🚀🎸🌺🦄';
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: false,
        autoAddToCollection: true,
        defaultCollectionSlug: null,
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: true,
      },
    });
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.SUBMIT_QUOTE) {
        callback({ success: true, message: 'Quote submitted successfully' });
        return;
      }
      callback({ success: true });
    });

    const overlay = setupOverlay() as any;
    overlay.collectionPicker = {
      getSelectedCollections: () => [collection('emojislug', emojiName)],
      setSelectedSlugs: jest.fn(),
    };

    await overlay.submitQuote();

    const addCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.ADD_QUOTE_TO_COLLECTION);
    const checkCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(([message]) => message.type === MessageType.CHECK_DUPLICATE);

    expect(addCall).toBeUndefined();
    expect(checkCall).toBeUndefined();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });
});

function collection(slug: string, name: string): Collection {
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
