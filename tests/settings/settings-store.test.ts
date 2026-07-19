import { DEFAULT_SETTINGS, type Settings } from '../../src/types/chrome';
import {
  clearLastUsedCollectionSlugs,
  getSettings,
  onSettingsChanged,
  updateLastUsedCollectionSlugs,
  updateSettings,
} from '../../src/settings/settings-store';

describe('settings-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.storage.onChanged as typeof chrome.storage.onChanged & { reset?: () => void }).reset?.();
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({});
    (chrome.storage.sync.set as jest.Mock).mockResolvedValue(undefined);
  });

  it('returns defaults when settings are unset', async () => {
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.statsForNerds).toBe(false);
    expect(chrome.storage.sync.get).toHaveBeenCalledWith(['settings']);
  });

  it('round-trips statistics-for-nerds changes', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, statsForNerds: true },
    });

    await expect(getSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, statsForNerds: true });
    await expect(updateSettings({ statsForNerds: false })).resolves.toEqual(DEFAULT_SETTINGS);
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ settings: DEFAULT_SETTINGS });
  });

  it('merges stored settings over defaults', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: true,
        defaultCollectionSlug: 'favorites',
        lastUsedCollectionSlugs: ['research', 'favorites'],
      },
    });

    await expect(getSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      privateMode: true,
      defaultCollectionSlug: 'favorites',
      lastUsedCollectionSlugs: ['research', 'favorites'],
    });
  });

  it('drops legacy defaultCollectionId and normalizes last-used slugs', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        defaultCollectionId: 'legacy-uuid',
        lastUsedCollectionSlugs: ['research', 42, 'research', '', 'favorites'],
      },
    });

    await expect(getSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      defaultCollectionSlug: null,
      lastUsedCollectionSlugs: ['research', 'favorites'],
    });
  });

  it('writes exactly one merged settings object on update', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: true,
        firstRunNoticeShown: true,
      },
    });

    const next = await updateSettings({ defaultCollectionSlug: 'research' });

    expect(next).toEqual({
      ...DEFAULT_SETTINGS,
      privateMode: true,
      defaultCollectionSlug: 'research',
      firstRunNoticeShown: true,
    });
    expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ settings: next });
  });

  it('updates last-used slugs with dedupe and skips unchanged writes', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        ...DEFAULT_SETTINGS,
        lastUsedCollectionSlugs: ['research', 'favorites'],
      },
    });

    await expect(updateLastUsedCollectionSlugs(['research', 'research', '', 'favorites']))
      .resolves
      .toEqual({
        ...DEFAULT_SETTINGS,
        lastUsedCollectionSlugs: ['research', 'favorites'],
      });
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();

    await expect(updateLastUsedCollectionSlugs(['favorites']))
      .resolves
      .toEqual({
        ...DEFAULT_SETTINGS,
        lastUsedCollectionSlugs: ['favorites'],
      });
    expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
  });

  it('clears last-used slugs through the settings store', async () => {
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        ...DEFAULT_SETTINGS,
        lastUsedCollectionSlugs: ['research'],
      },
    });

    const next = await clearLastUsedCollectionSlugs();

    expect(next.lastUsedCollectionSlugs).toEqual([]);
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ settings: next });
  });

  it('fires change callbacks only for sync settings changes and unsubscribes', () => {
    const callback = jest.fn();
    const unsubscribe = onSettingsChanged(callback);

    emitStorageChange({
      settings: {
        oldValue: { ...DEFAULT_SETTINGS },
        newValue: { ...DEFAULT_SETTINGS, privateMode: true },
      },
    }, 'sync');

    expect(callback).toHaveBeenCalledWith(
      { ...DEFAULT_SETTINGS, privateMode: true },
      DEFAULT_SETTINGS,
    );

    emitStorageChange({
      settings: {
        oldValue: { ...DEFAULT_SETTINGS },
        newValue: { ...DEFAULT_SETTINGS, privateMode: false },
      },
    }, 'local');
    emitStorageChange({ unrelated: { oldValue: false, newValue: true } }, 'sync');
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    emitStorageChange({
      settings: {
        oldValue: { ...DEFAULT_SETTINGS },
        newValue: { ...DEFAULT_SETTINGS, privateMode: false },
      },
    }, 'sync');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('keeps serialized settings far below the Chrome sync item limit', () => {
    const serialized = JSON.stringify(DEFAULT_SETTINGS satisfies Settings);
    expect(serialized.length).toBeLessThan(8192);
  });
});

function emitStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
): void {
  (chrome.storage.onChanged as typeof chrome.storage.onChanged & {
    emit: (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ) => void;
  }).emit(changes, areaName);
}
