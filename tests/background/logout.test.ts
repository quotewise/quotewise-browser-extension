import { DEFAULT_SETTINGS } from '../../src/types/chrome';
import { USER_IDENTIFYING_CACHE_KEYS } from '../../src/background/storage-cleanup';
import { logoutAndClearUserData } from '../../src/background/privacy-cleanup';
import { logout } from '../../src/auth/auth-flow';

jest.mock('../../src/auth/auth-flow', () => ({
  logout: jest.fn().mockResolvedValue(undefined),
}));

describe('logout privacy cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: true,
        autoAddToCollection: true,
        defaultCollectionId: 'collection-1',
        firstRunNoticeShown: true,
      },
    });
  });

  it('clears tokens through logout, clears user-identifying cache, and nulls only the account-bound default collection', async () => {
    await logoutAndClearUserData();

    expect(logout).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith([...USER_IDENTIFYING_CACHE_KEYS]);
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: {
        privateMode: true,
        autoAddToCollection: true,
        defaultCollectionId: null,
        firstRunNoticeShown: true,
      },
    });
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('secret-token'));
  });

  it('preserves default device settings when no synced settings exist', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({});

    await logoutAndClearUserData();

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: {
        ...DEFAULT_SETTINGS,
        defaultCollectionId: null,
      },
    });
  });
});
