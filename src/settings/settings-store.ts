import { DEFAULT_SETTINGS, type Settings } from '../types/chrome';

const SETTINGS_KEY = 'settings';

function normalizeSlugList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const slug = item.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function settingsEqual(a: Settings, b: Settings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const partial = value as Partial<Settings>;
  return {
    privateMode: typeof partial.privateMode === 'boolean'
      ? partial.privateMode
      : DEFAULT_SETTINGS.privateMode,
    statsForNerds: typeof partial.statsForNerds === 'boolean' ? partial.statsForNerds : DEFAULT_SETTINGS.statsForNerds,
    autoAddToCollection: typeof partial.autoAddToCollection === 'boolean'
      ? partial.autoAddToCollection
      : DEFAULT_SETTINGS.autoAddToCollection,
    defaultCollectionSlug: typeof partial.defaultCollectionSlug === 'string'
      ? partial.defaultCollectionSlug
      : null,
    lastUsedCollectionSlugs: normalizeSlugList(partial.lastUsedCollectionSlugs),
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
  if (settingsEqual(current, next)) {
    return next;
  }
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function updateLastUsedCollectionSlugs(slugs: string[]): Promise<Settings> {
  return updateSettings({ lastUsedCollectionSlugs: normalizeSlugList(slugs) });
}

export async function clearLastUsedCollectionSlugs(): Promise<Settings> {
  return updateLastUsedCollectionSlugs([]);
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
