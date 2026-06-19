import { DEFAULT_SETTINGS, type Settings } from '../types/chrome';

const SETTINGS_KEY = 'settings';

function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const partial = value as Partial<Settings>;
  return {
    privateMode: typeof partial.privateMode === 'boolean'
      ? partial.privateMode
      : DEFAULT_SETTINGS.privateMode,
    autoAddToCollection: typeof partial.autoAddToCollection === 'boolean'
      ? partial.autoAddToCollection
      : DEFAULT_SETTINGS.autoAddToCollection,
    defaultCollectionId: typeof partial.defaultCollectionId === 'string'
      ? partial.defaultCollectionId
      : null,
    firstRunNoticeShown: typeof partial.firstRunNoticeShown === 'boolean'
      ? partial.firstRunNoticeShown
      : DEFAULT_SETTINGS.firstRunNoticeShown,
  };
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.sync.get([SETTINGS_KEY]);
  return normalizeSettings(result[SETTINGS_KEY]);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(
  callback: (next: Settings, prev: Settings) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'sync' || !changes[SETTINGS_KEY]) {
      return;
    }

    callback(
      normalizeSettings(changes[SETTINGS_KEY].newValue),
      normalizeSettings(changes[SETTINGS_KEY].oldValue),
    );
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
