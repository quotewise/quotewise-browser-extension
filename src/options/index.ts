import { MessageType, type Settings, type ExtensionMessage } from '../types';
import { AuthState } from '../auth/auth-state-machine';
import type { Collection } from '../types/api';
import { getSettings, onSettingsChanged, updateSettings } from '../settings/settings-store';

type MessageResponse = {
  success?: boolean;
  error?: string;
  data?: {
    state?: string;
    username?: string;
  };
  collections?: Collection[];
  default_collection_id?: string | null;
};

function sendMessage(type: MessageType, data?: unknown): Promise<MessageResponse> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, data }, response => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { success: false, error: 'No response' });
    });
  });
}

export async function initializeOptionsPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
        background: #f8fafc;
      }
      .settings-shell {
        max-width: 760px;
        margin: 0 auto;
        padding: 32px 20px;
      }
      h1 {
        margin: 0 0 24px;
        font-size: 24px;
        line-height: 32px;
        font-weight: 650;
      }
      section {
        padding: 20px 0;
        border-top: 1px solid #dbe3ef;
      }
      section:first-of-type { border-top: 0; }
      h2 {
        margin: 0 0 12px;
        font-size: 16px;
        line-height: 24px;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 0;
      }
      .label {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .hint {
        color: #64748b;
        font-size: 13px;
      }
      button {
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 8px 12px;
        background: #fff;
        color: #111827;
        cursor: pointer;
      }
      button.primary {
        background: #1d4ed8;
        border-color: #1d4ed8;
        color: #fff;
      }
      button.warning {
        border-color: #dc2626;
        color: #991b1b;
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
      .status {
        min-height: 20px;
        color: #475569;
      }
      #account-identity, #logout-btn {
        transition: opacity 0.22s ease;
      }
    </style>
    <div class="settings-shell">
      <h1>Quotewise Settings</h1>
      <section aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <div class="row">
          <div class="label">
            <span id="account-identity">Checking account...</span>
            <span class="hint">Used only to submit captures to Quotewise.</span>
          </div>
          <button type="button" id="logout-btn">Log out</button>
        </div>
      </section>
      <section aria-labelledby="support-title">
        <h2 id="support-title">Support</h2>
        <div class="row">
          <span class="label">
            <span>Send feedback</span>
            <span class="hint">Opens a Quotewise feedback form. No quote text or account details are attached.</span>
          </span>
          <button type="button" id="send-feedback-btn">Send feedback</button>
        </div>
      </section>
      <section aria-labelledby="privacy-title">
        <h2 id="privacy-title">Privacy</h2>
        <label class="row">
          <span class="label">
            <span>Private mode</span>
            <span class="hint">Pause automatic quote checks until you choose Check now.</span>
          </span>
          <input type="checkbox" id="private-mode-toggle" aria-label="Private mode">
        </label>
        <div class="row">
          <span class="label">
            <span>Clear my data</span>
            <span class="hint">Clears cached tweet/originator data. Login stays active.</span>
          </span>
          <button type="button" class="warning" id="clear-data-btn">Clear my data</button>
        </div>
      </section>
      <section aria-labelledby="collections-title">
        <h2 id="collections-title">Collections</h2>
        <label class="row">
          <span class="label">
            <span>Auto-add captures</span>
            <span class="hint">Attach new captures to the selected collection.</span>
          </span>
          <input type="checkbox" id="auto-add-toggle" aria-label="Auto-add captures to collection">
        </label>
        <label class="row">
          <span class="label">
            <span>Default collection</span>
            <span class="hint" id="collections-hint">Loading collections...</span>
          </span>
          <select id="default-collection-select" aria-label="Default collection"></select>
        </label>
      </section>
      <p class="status" id="status" role="status" aria-live="polite"></p>
    </div>
  `;

  const status = root.querySelector('#status') as HTMLElement;
  const identity = root.querySelector('#account-identity') as HTMLElement;
  const privateToggle = root.querySelector('#private-mode-toggle') as HTMLInputElement;
  const autoAddToggle = root.querySelector('#auto-add-toggle') as HTMLInputElement;
  const collectionSelect = root.querySelector('#default-collection-select') as HTMLSelectElement;
  const collectionsHint = root.querySelector('#collections-hint') as HTMLElement;
  const logoutButton = root.querySelector('#logout-btn') as HTMLButtonElement;
  const clearDataButton = root.querySelector('#clear-data-btn') as HTMLButtonElement;
  const feedbackButton = root.querySelector('#send-feedback-btn') as HTMLButtonElement;
  let authState = AuthState.UNKNOWN;

  function applySettings(settings: Settings): void {
    privateToggle.checked = settings.privateMode;
    autoAddToggle.checked = settings.autoAddToCollection;
    collectionSelect.value = settings.defaultCollectionSlug || '';
  }

  function setStatus(message: string): void {
    status.textContent = message;
  }

  function isAuthenticated(): boolean {
    return authState === AuthState.AUTHENTICATED;
  }

  let firstAuthApply = true;
  function applyAuthState(state: AuthState, username?: string): void {
    const render = (): void => {
      authState = state;
      logoutButton.disabled = false;
      if (state === AuthState.AUTHENTICATED) {
        identity.textContent = username ? `Signed in as ${username}` : 'Signed in';
        logoutButton.textContent = 'Log out';
      } else if (state === AuthState.SESSION_EXPIRED) {
        identity.textContent = 'Session expired';
        logoutButton.textContent = 'Log in';
      } else if (state === AuthState.INSUFFICIENT_PRIVILEGES) {
        identity.textContent = 'Permissions needed';
        logoutButton.textContent = 'Log in';
      } else {
        identity.textContent = 'Not signed in';
        logoutButton.textContent = 'Log in';
      }
      identity.style.opacity = '1';
      logoutButton.style.opacity = '1';
    };
    // Snap on the first paint; cross-fade on later changes so login/logout feels intentional.
    if (firstAuthApply) {
      firstAuthApply = false;
      render();
      return;
    }
    identity.style.opacity = '0';
    logoutButton.style.opacity = '0';
    window.setTimeout(render, 180);
  }

  applySettings(await getSettings());
  onSettingsChanged(applySettings);

  const auth = await sendMessage(MessageType.AUTH_STATE_GET);
  if (auth.success && auth.data?.state) {
    applyAuthState(auth.data.state as AuthState, auth.data.username);
  } else {
    applyAuthState(AuthState.UNAUTHENTICATED);
  }

  privateToggle.addEventListener('change', () => {
    void updateSettings({ privateMode: privateToggle.checked }).then(settings => {
      applySettings(settings);
      setStatus(settings.privateMode ? 'Private mode on.' : 'Private mode off.');
    });
  });

  autoAddToggle.addEventListener('change', () => {
    void updateSettings({ autoAddToCollection: autoAddToggle.checked }).then(settings => {
      applySettings(settings);
      setStatus(settings.autoAddToCollection ? 'Auto-add on.' : 'Auto-add off.');
    });
  });

  collectionSelect.addEventListener('change', () => {
    void updateSettings({ defaultCollectionSlug: collectionSelect.value || null }).then(settings => {
      applySettings(settings);
      setStatus(settings.defaultCollectionSlug ? 'Default collection saved.' : 'Default collection cleared.');
    });
  });

  // React to auth changes from anywhere (esp. the Safari tab sign-in, whose OAUTH_LOGIN response
  // often doesn't land back on this still-open page) so the page updates without a manual refresh.
  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message?.type === MessageType.AUTH_STATE_CHANGED && message.data?.state) {
      applyAuthState(message.data.state as AuthState, message.data.username);
    }
  });

  logoutButton.addEventListener('click', () => {
    const wasAuthenticated = isAuthenticated();
    logoutButton.disabled = true;
    logoutButton.textContent = wasAuthenticated ? 'Logging out...' : 'Logging in...';
    void sendMessage(wasAuthenticated ? MessageType.OAUTH_LOGOUT : MessageType.OAUTH_LOGIN).then(response => {
      if (response.success) {
        applyAuthState(wasAuthenticated ? AuthState.UNAUTHENTICATED : AuthState.AUTHENTICATED);
        setStatus(wasAuthenticated ? 'Logged out.' : 'Logged in.');
      } else {
        logoutButton.disabled = false;
        logoutButton.textContent = wasAuthenticated ? 'Log out' : 'Log in';
        setStatus(response.error || (wasAuthenticated ? 'Log out failed.' : 'Log in failed.'));
      }
    });
  });

  clearDataButton.addEventListener('click', () => {
    clearDataButton.disabled = true;
    void sendMessage(MessageType.CLEAR_USER_DATA).then(response => {
      clearDataButton.disabled = false;
      setStatus(response.success ? 'Cached data cleared.' : response.error || 'Clear data failed.');
    });
  });

  feedbackButton.addEventListener('click', () => {
    feedbackButton.disabled = true;
    void sendMessage(MessageType.OPEN_FEEDBACK_PAGE).then(response => {
      feedbackButton.disabled = false;
      setStatus(response.success ? 'Feedback opened in a new tab.' : response.error || 'Unable to open feedback.');
    });
  });

  void loadCollections(collectionSelect, collectionsHint, applySettings, setStatus);
}

async function loadCollections(
  select: HTMLSelectElement,
  hint: HTMLElement,
  applySettings: (settings: Settings) => void,
  setStatus: (message: string) => void,
): Promise<void> {
  const response = await sendMessage(MessageType.LIST_COLLECTIONS);
  select.innerHTML = '<option value="">No default collection</option>';

  if (!response.success) {
    select.disabled = true;
    hint.textContent = response.error || 'Unable to load collections.';
    setStatus('Collections unavailable.');
    return;
  }

  const collections = response.collections || [];
  if (collections.length === 0) {
    select.disabled = true;
    hint.textContent = 'No collections found.';
    await updateSettings({ autoAddToCollection: false, defaultCollectionSlug: null }).then(applySettings);
    return;
  }

  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.slug;
    option.textContent = collection.name;
    select.appendChild(option);
  }

  const settings = await getSettings();
  const validSlugs = new Set(collections.map(collection => collection.slug));
  const defaultCollection = response.default_collection_id
    ? collections.find(collection => collection.id === response.default_collection_id)
    : collections.find(collection => collection.is_default);
  const preferred = settings.defaultCollectionSlug && validSlugs.has(settings.defaultCollectionSlug)
    ? settings.defaultCollectionSlug
    : defaultCollection?.slug && validSlugs.has(defaultCollection.slug)
      ? defaultCollection.slug
      : null;
  const nextSettings = preferred !== settings.defaultCollectionSlug
    ? await updateSettings({ defaultCollectionSlug: preferred })
    : settings;

  select.disabled = false;
  hint.textContent = 'Choose where new captures should land.';
  applySettings(nextSettings);
}

const root = document.getElementById('options-root');
if (root) {
  void initializeOptionsPage(root).catch(() => {
    root.textContent = 'Unable to load settings.';
  });
}
