import { logout } from '../auth/auth-flow';
import { updateSettings } from '../settings/settings-store';
import { USER_IDENTIFYING_CACHE_KEYS } from './storage-cleanup';

export async function clearUserDataCaches(): Promise<void> {
  await chrome.storage.local.remove([...USER_IDENTIFYING_CACHE_KEYS]);
  await updateSettings({ defaultCollectionId: null });
}

export async function logoutAndClearUserData(): Promise<void> {
  await logout();
  await clearUserDataCaches();
}
