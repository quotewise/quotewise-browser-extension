import { MessageType, type Settings } from '../../../types';
import { AuthState, type AuthStateData } from '../../../auth/auth-state-machine';
import { getSettings, onSettingsChanged, updateSettings } from '../../../settings/settings-store';
import type { Collection } from '../../../types/api';

type MessageResponse = {
  success?: boolean;
  error?: string;
  collections?: Collection[];
  default_collection_id?: string | null;
  data?: {
    state?: AuthState | string;
    username?: string;
  };
};
type SendMessage = (message: { type: MessageType; data?: unknown }) => Promise<MessageResponse>;

const AUTH_ACTION_MIN_BUSY_MS = 450;

export class AccountMenu {
  private button: HTMLButtonElement | null = null;
  private menu: HTMLElement | null = null;
  private settings: Settings | null = null;
  private authState: AuthState = AuthState.UNKNOWN;
  private username: string | null = null;
  private statusMessage: string | null = null;
  private collections: Collection[] = [];
  private collectionsLoaded = false;
  private collectionsLoading = false;
  private collectionsError: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly sendMessage: SendMessage,
  ) {}

  async mount(): Promise<void> {
    this.settings = await getSettings();
    await this.refreshAuthState();
    this.render();
    if (!this.unsubscribe) {
      this.unsubscribe = onSettingsChanged(next => {
        this.settings = next;
        this.renderMenu();
      });
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.container.innerHTML = '';
    this.button = null;
    this.menu = null;
  }

  setAuthState(stateData: AuthStateData): void {
    this.authState = stateData.state;
    this.username = stateData.username || null;
    this.statusMessage = null;
    this.renderMenu();
  }

  private render(): void {
    this.container.innerHTML = `
      <button type="button" class="toggle" id="account-menu-btn" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false"><span class="gear-glyph">⚙</span></button>
      <div class="account-menu" id="account-menu" role="menu" hidden></div>
    `;
    this.button = this.container.querySelector('#account-menu-btn') as HTMLButtonElement;
    this.menu = this.container.querySelector('#account-menu') as HTMLElement;
    this.button.addEventListener('click', () => this.toggle());
    this.button.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.open();
      }
    });
    this.renderMenu();
  }

  private renderMenu(): void {
    if (!this.menu || !this.settings) return;
    const isAuthenticated = this.authState === AuthState.AUTHENTICATED;
    const authActionText = isAuthenticated ? 'Log out' : 'Log in';
    const accountLabel = this.statusMessage || this.accountLabel();
    const collectionControls = isAuthenticated && !this.settings.privateMode
      ? this.collectionControlsHtml()
      : '';
    this.menu.innerHTML = `
      <div class="menu-status" role="status">${this.escapeHtml(accountLabel)}</div>
      <label class="menu-row" role="menuitemcheckbox" aria-checked="${this.settings.privateMode ? 'true' : 'false'}">
        <input type="checkbox" id="account-private-toggle" ${this.settings.privateMode ? 'checked' : ''}>
        <span>Private mode</span>
      </label>
      ${collectionControls}
      <button type="button" role="menuitem" id="account-open-settings">Open settings</button>
      <button type="button" role="menuitem" id="account-send-feedback">Send feedback</button>
      <button type="button" role="menuitem" id="account-auth-action">${authActionText}</button>
    `;
    this.menu.querySelector('#account-private-toggle')?.addEventListener('change', event => {
      const target = event.target as HTMLInputElement;
      void updateSettings({ privateMode: target.checked });
    });
    this.menu.querySelector('#account-auto-add-toggle')?.addEventListener('change', event => {
      const target = event.target as HTMLInputElement;
      void updateSettings({ autoAddToCollection: target.checked });
    });
    this.menu.querySelector('#account-default-collection-select')?.addEventListener('change', event => {
      const target = event.target as HTMLSelectElement;
      void updateSettings({ defaultCollectionSlug: target.value || null });
    });
    this.menu.querySelector('#account-open-settings')?.addEventListener('click', () => {
      void this.sendMessage({ type: MessageType.OPEN_OPTIONS_PAGE });
      this.close();
    });
    this.menu.querySelector('#account-send-feedback')?.addEventListener('click', () => {
      void this.openFeedback();
    });
    this.menu.querySelector('#account-auth-action')?.addEventListener('click', () => {
      void this.runAuthAction();
    });
    this.menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        this.button?.focus();
      }
    });
  }

  private collectionControlsHtml(): string {
    const selectDisabled = this.collectionsLoading || this.collections.length === 0;
    const options = [
      `<option value="">No default collection</option>`,
      ...this.collections.map(collection => (
        `<option value="${this.escapeHtml(collection.slug)}" ${collection.slug === this.settings?.defaultCollectionSlug ? 'selected' : ''}>${this.escapeHtml(collection.name)}</option>`
      )),
    ].join('');
    const hint = this.collectionsError
      ? this.collectionsError
      : this.collectionsLoading || !this.collectionsLoaded
        ? 'Loading collections...'
        : this.collections.length === 0
          ? 'No collections found.'
          : 'Default collection';

    return `
      <label class="menu-row" role="menuitemcheckbox" aria-checked="${this.settings?.autoAddToCollection ? 'true' : 'false'}">
        <input type="checkbox" id="account-auto-add-toggle" ${this.settings?.autoAddToCollection ? 'checked' : ''}>
        <span>Auto-add Captures</span>
      </label>
      <label class="menu-row collection-select-row">
        <span>${this.escapeHtml(hint)}</span>
        <select id="account-default-collection-select" aria-label="Default collection" ${selectDisabled ? 'disabled' : ''}>
          ${options}
        </select>
      </label>
    `;
  }

  private async loadCollectionsForMenu(): Promise<void> {
    if (
      this.collectionsLoaded ||
      this.collectionsLoading ||
      this.authState !== AuthState.AUTHENTICATED ||
      this.settings?.privateMode
    ) {
      return;
    }

    this.collectionsLoading = true;
    this.collectionsError = null;
    this.renderMenu();

    try {
      const response = await this.sendMessage({ type: MessageType.LIST_COLLECTIONS });
      if (!response.success) {
        throw new Error(response.error || 'Unable to load collections.');
      }

      this.collections = response.collections || [];
      this.collectionsLoaded = true;
      await this.reconcileDefaultCollection(response.default_collection_id || null);
    } catch (error) {
      this.collectionsError = error instanceof Error ? error.message : 'Unable to load collections.';
      this.collections = [];
    } finally {
      this.collectionsLoading = false;
      this.renderMenu();
    }
  }

  private async reconcileDefaultCollection(defaultCollectionId: string | null): Promise<void> {
    if (!this.settings || this.collections.length === 0) {
      return;
    }

    const validSlugs = new Set(this.collections.map(collection => collection.slug));
    if (this.settings.defaultCollectionSlug && validSlugs.has(this.settings.defaultCollectionSlug)) {
      return;
    }

    const defaultCollection = defaultCollectionId
      ? this.collections.find(collection => collection.id === defaultCollectionId)
      : this.collections.find(collection => collection.is_default);
    if (!defaultCollection) {
      return;
    }

    this.settings = await updateSettings({ defaultCollectionSlug: defaultCollection.slug });
  }

  private async refreshAuthState(): Promise<void> {
    try {
      const response = await this.sendMessage({ type: MessageType.AUTH_STATE_GET });
      if (response.success && response.data?.state) {
        this.authState = response.data.state as AuthState;
        this.username = response.data.username || null;
        return;
      }
    } catch {
      // Leave the menu usable; an explicit Log in attempt can recover.
    }
    this.authState = AuthState.UNAUTHENTICATED;
    this.username = null;
  }

  private async openFeedback(): Promise<void> {
    if (!this.menu) return;
    const button = this.menu.querySelector('#account-send-feedback') as HTMLButtonElement | null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Opening feedback...';
      button.setAttribute('aria-busy', 'true');
    }

    try {
      const response = await this.sendMessage({ type: MessageType.OPEN_FEEDBACK_PAGE });
      if (response.success) {
        this.statusMessage = null;
        this.renderMenu();
        this.close();
        return;
      }
      this.statusMessage = response.error || 'Unable to open feedback.';
    } catch (error) {
      this.statusMessage = error instanceof Error
        ? error.message
        : 'Unable to open feedback.';
    }

    this.renderMenu();
    this.open();
  }

  private async runAuthAction(): Promise<void> {
    if (!this.menu) return;
    const button = this.menu.querySelector('#account-auth-action') as HTMLButtonElement | null;
    const isAuthenticated = this.authState === AuthState.AUTHENTICATED;
    const type = isAuthenticated ? MessageType.OAUTH_LOGOUT : MessageType.OAUTH_LOGIN;
    const startedAt = Date.now();
    if (button) {
      button.disabled = true;
      button.textContent = isAuthenticated ? 'Logging out...' : 'Logging in...';
      button.setAttribute('aria-busy', 'true');
    }

    let succeeded = false;
    try {
      const response = await this.sendMessage({ type });
      if (response.success) {
        succeeded = true;
        this.authState = isAuthenticated ? AuthState.UNAUTHENTICATED : AuthState.AUTHENTICATED;
        this.username = isAuthenticated ? null : this.username;
        this.statusMessage = isAuthenticated ? 'Logged out.' : 'Logged in.';
      } else {
        this.statusMessage = response.error || (isAuthenticated ? 'Log out failed.' : 'Log in failed.');
      }
    } catch (error) {
      this.statusMessage = error instanceof Error
        ? error.message
        : (isAuthenticated ? 'Log out failed.' : 'Log in failed.');
    }

    await this.waitForMinimumBusyTime(startedAt);
    this.renderMenu();
    // Dismiss the menu once the action completes (it was orphaning open after logout); keep it open
    // only to surface a failure message.
    if (succeeded) {
      this.close();
    } else {
      this.open();
    }
  }

  private async waitForMinimumBusyTime(startedAt: number): Promise<void> {
    const remaining = AUTH_ACTION_MIN_BUSY_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
  }

  private accountLabel(): string {
    if (this.authState === AuthState.AUTHENTICATED) {
      return this.username ? `Signed in as ${this.username}` : 'Signed in';
    }
    if (this.authState === AuthState.SESSION_EXPIRED) {
      return 'Session expired';
    }
    if (this.authState === AuthState.INSUFFICIENT_PRIVILEGES) {
      return 'Permissions needed';
    }
    return 'Signed out';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private toggle(): void {
    if (this.menu?.hidden) {
      this.open();
    } else {
      this.close();
    }
  }

  private open(): void {
    if (!this.menu || !this.button) return;
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    void this.loadCollectionsForMenu();
    (this.menu.querySelector('input, button') as HTMLElement | null)?.focus();
  }

  private close(): void {
    if (!this.menu || !this.button) return;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }
}
