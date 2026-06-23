import fs from 'fs';
import path from 'path';
import { initializeOptionsPage } from '../../src/options/index';
import { MessageType } from '../../src/types';
import { AuthState } from '../../src/auth/auth-state-machine';

function readManifest(name: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), name), 'utf8'));
}

describe('options page', () => {
  let authState: AuthState;

  beforeEach(() => {
    jest.clearAllMocks();
    authState = AuthState.AUTHENTICATED;
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: false,
        autoAddToCollection: false,
        defaultCollectionSlug: null,
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: false,
      },
    });
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        callback({
          success: true,
          data: {
            state: authState,
            username: authState === AuthState.AUTHENTICATED ? 'chris' : undefined,
          },
        });
        return;
      }
      if (message.type === MessageType.LIST_COLLECTIONS) {
        callback({
          success: true,
          collections: [{
            id: 'collection-1',
            name: 'Favorites',
            slug: 'favorites',
            description: '',
            is_default: true,
            quote_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          }],
          default_collection_id: 'collection-1',
        });
        return;
      }
      callback({ success: true });
    });
  });

  it('registers options_ui in every manifest without adding a popup', () => {
    for (const manifestName of ['manifest.json', 'manifest.dev.json', 'manifest.prod.json']) {
      const manifest = readManifest(manifestName);
      expect(manifest.options_ui).toEqual({
        page: 'options.html',
        open_in_tab: true,
      });
      expect(manifest.action.default_popup).toBeUndefined();
    }
  });

  it('renders labelled controls and sends logout / clear-data messages', async () => {
    const root = document.createElement('main');

    await initializeOptionsPage(root);

    expect(root.textContent).toContain('Signed in as chris');
    expect(root.querySelector('#private-mode-toggle')?.getAttribute('aria-label')).toBe('Private mode');
    expect((root.querySelector('#logout-btn') as HTMLButtonElement).textContent).toBe('Log out');

    (root.querySelector('#logout-btn') as HTMLButtonElement).click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: MessageType.OAUTH_LOGOUT, data: undefined },
      expect.any(Function),
    );

    (root.querySelector('#clear-data-btn') as HTMLButtonElement).click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: MessageType.CLEAR_USER_DATA, data: undefined },
      expect.any(Function),
    );
  });

  it('shows explanatory feedback text and opens feedback from settings', async () => {
    const root = document.createElement('main');
    document.body.appendChild(root);

    await initializeOptionsPage(root);

    expect(root.textContent).toContain('Send feedback');
    expect(root.textContent).toContain('Opens a Quotewise feedback form');
    expect(root.textContent).toContain('No quote text or account details are attached.');

    const feedbackButton = root.querySelector('#send-feedback-btn') as HTMLButtonElement;
    expect(feedbackButton).not.toBeNull();
    expect(feedbackButton.textContent).toBe('Send feedback');
    feedbackButton.focus();
    expect(document.activeElement).toBe(feedbackButton);

    feedbackButton.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: MessageType.OPEN_FEEDBACK_PAGE, data: undefined },
      expect.any(Function),
    );
  });

  it('offers login instead of disabled logout when signed out', async () => {
    authState = AuthState.UNAUTHENTICATED;
    const root = document.createElement('main');

    await initializeOptionsPage(root);

    const authButton = root.querySelector('#logout-btn') as HTMLButtonElement;
    expect(root.textContent).toContain('Not signed in');
    expect(authButton.disabled).toBe(false);
    expect(authButton.textContent).toBe('Log in');

    authButton.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: MessageType.OAUTH_LOGIN, data: undefined },
      expect.any(Function),
    );
  });

  it('keeps feedback available when signed out or session expired', async () => {
    for (const state of [AuthState.UNAUTHENTICATED, AuthState.SESSION_EXPIRED, AuthState.INSUFFICIENT_PRIVILEGES]) {
      authState = state;
      const root = document.createElement('main');

      await initializeOptionsPage(root);

      const feedbackButton = root.querySelector('#send-feedback-btn') as HTMLButtonElement | null;
      expect(feedbackButton).not.toBeNull();
      expect(feedbackButton?.disabled).toBe(false);

      feedbackButton?.click();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { type: MessageType.OPEN_FEEDBACK_PAGE, data: undefined },
        expect.any(Function),
      );

      jest.clearAllMocks();
    }
  });

  it('shows a non-blocking status when feedback cannot open', async () => {
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        callback({
          success: true,
          data: {
            state: AuthState.AUTHENTICATED,
            username: 'chris',
          },
        });
        return;
      }
      if (message.type === MessageType.LIST_COLLECTIONS) {
        callback({
          success: true,
          collections: [],
          default_collection_id: null,
        });
        return;
      }
      if (message.type === MessageType.OPEN_FEEDBACK_PAGE) {
        callback({ success: false, error: 'Tabs unavailable' });
        return;
      }
      callback({ success: true });
    });

    const root = document.createElement('main');
    await initializeOptionsPage(root);

    const feedbackButton = root.querySelector('#send-feedback-btn') as HTMLButtonElement;
    const privateToggle = root.querySelector('#private-mode-toggle') as HTMLInputElement;

    feedbackButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(root.querySelector('#status')?.textContent).toBe('Tabs unavailable');
    expect(feedbackButton.disabled).toBe(false);
    expect(privateToggle.disabled).toBe(false);
  });

  it('persists private-mode changes through the settings store', async () => {
    const root = document.createElement('main');
    await initializeOptionsPage(root);

    const toggle = root.querySelector('#private-mode-toggle') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: {
        privateMode: true,
        autoAddToCollection: false,
        defaultCollectionSlug: null,
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: false,
      },
    });
  });
});
