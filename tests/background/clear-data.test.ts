import { USER_IDENTIFYING_CACHE_KEYS } from '../../src/background/storage-cleanup';
import { clearUserDataCaches } from '../../src/background/privacy-cleanup';

describe('clear user data privacy cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: true,
        autoAddToCollection: true,
        defaultCollectionId: 'collection-1',
        firstRunNoticeShown: false,
      },
    });
  });

  it('clears user-identifying cache and default collection without touching token keys or login state', async () => {
    await clearUserDataCaches();

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([...USER_IDENTIFYING_CACHE_KEYS]);
    expect(chrome.storage.local.remove).not.toHaveBeenCalledWith(expect.arrayContaining([
      'oauth_access_token',
      'oauth_refresh_token',
    ]));
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: {
        privateMode: true,
        autoAddToCollection: true,
        defaultCollectionId: null,
        firstRunNoticeShown: false,
      },
    });
  });
});
