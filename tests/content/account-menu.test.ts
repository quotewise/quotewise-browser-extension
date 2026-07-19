import { AccountMenu } from '../../src/content/ui/components/account-menu';
import { MessageType } from '../../src/types';
import { AuthState } from '../../src/auth/auth-state-machine';

describe('AccountMenu', () => {
  let container: HTMLElement;
  let sendMessage: jest.Mock;

  async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(container);
    sendMessage = jest.fn().mockResolvedValue({ success: true });
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: false,
        autoAddToCollection: false,
        defaultCollectionSlug: null,
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: false,
      },
    });
    sendMessage = jest.fn().mockImplementation(async message => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        return {
          success: true,
          data: {
            state: AuthState.AUTHENTICATED,
            username: 'chris',
          },
        };
      }
      return { success: true };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens a keyboard-labelled menu and sends settings/logout messages', async () => {
    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('Account menu');
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const privateToggle = container.querySelector('#account-private-toggle') as HTMLInputElement;
    privateToggle.checked = true;
    privateToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: {
        privateMode: true,
        statsForNerds: false,
        autoAddToCollection: false,
        defaultCollectionSlug: null,
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: false,
      },
    });

    (container.querySelector('#account-open-settings') as HTMLButtonElement).click();
    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.OPEN_OPTIONS_PAGE });
    expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();

    trigger.click();
    expect(container.textContent).toContain('Signed in as chris');
    const authButton = container.querySelector('#account-auth-action') as HTMLButtonElement;
    expect(authButton.textContent).toBe('Log out');
    jest.useFakeTimers();
    authButton.click();
    expect(authButton.textContent).toBe('Logging out...');
    expect(authButton.getAttribute('aria-busy')).toBe('true');
    await flushPromises();
    jest.advanceTimersByTime(449);
    await flushPromises();
    expect(authButton.textContent).toBe('Logging out...');
    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.OAUTH_LOGOUT });
    expect(container.textContent).toContain('Logged out.');
    expect((container.querySelector('#account-auth-action') as HTMLButtonElement).textContent).toBe('Log in');
  });

  it('shows Log in instead of Log out when signed out', async () => {
    sendMessage = jest.fn().mockImplementation(async message => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        return {
          success: true,
          data: {
            state: AuthState.UNAUTHENTICATED,
          },
        };
      }
      return { success: true };
    });

    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    trigger.click();
    expect(container.textContent).toContain('Signed out');
    const authButton = container.querySelector('#account-auth-action') as HTMLButtonElement;
    expect(authButton.textContent).toBe('Log in');

    jest.useFakeTimers();
    authButton.click();
    await flushPromises();
    jest.advanceTimersByTime(450);
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.OAUTH_LOGIN });
    expect(container.textContent).toContain('Logged in.');
  });

  it('shows Send feedback in the gear menu and dispatches the feedback message', async () => {
    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    trigger.click();

    const feedbackButton = container.querySelector('#account-send-feedback') as HTMLButtonElement;
    expect(feedbackButton).not.toBeNull();
    expect(feedbackButton.textContent).toBe('Send feedback');
    expect(feedbackButton.getAttribute('role')).toBe('menuitem');
    expect(feedbackButton.disabled).toBe(false);

    feedbackButton.focus();
    expect(document.activeElement).toBe(feedbackButton);

    feedbackButton.click();
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.OPEN_FEEDBACK_PAGE });
    expect((container.querySelector('#account-menu') as HTMLElement).hidden).toBe(true);
  });

  it('keeps existing gear menu actions working when feedback is present', async () => {
    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    trigger.click();

    const privateToggle = container.querySelector('#account-private-toggle') as HTMLInputElement;
    privateToggle.checked = true;
    privateToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: {
        privateMode: true,
        statsForNerds: false,
        autoAddToCollection: false,
        defaultCollectionSlug: null,
        lastUsedCollectionSlugs: [],
        firstRunNoticeShown: false,
      },
    });

    (container.querySelector('#account-open-settings') as HTMLButtonElement).click();
    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.OPEN_OPTIONS_PAGE });

    trigger.click();
    const authButton = container.querySelector('#account-auth-action') as HTMLButtonElement;
    jest.useFakeTimers();
    authButton.click();
    await flushPromises();
    jest.advanceTimersByTime(450);
    await flushPromises();
    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.OAUTH_LOGOUT });
  });

  it('shows a recoverable gear menu status when feedback cannot open', async () => {
    sendMessage = jest.fn().mockImplementation(async message => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        return {
          success: true,
          data: {
            state: AuthState.AUTHENTICATED,
            username: 'chris',
          },
        };
      }
      if (message.type === MessageType.OPEN_FEEDBACK_PAGE) {
        return { success: false, error: 'Tabs unavailable' };
      }
      return { success: true };
    });

    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    trigger.click();

    const feedbackButton = container.querySelector('#account-send-feedback') as HTMLButtonElement;
    feedbackButton.click();
    await flushPromises();

    expect(container.textContent).toContain('Tabs unavailable');
    expect((container.querySelector('#account-menu') as HTMLElement).hidden).toBe(false);
    expect((container.querySelector('#account-send-feedback') as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector('#account-open-settings')).not.toBeNull();
  });

  it('recovers the auth action button when logout fails', async () => {
    sendMessage = jest.fn().mockImplementation(async message => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        return {
          success: true,
          data: {
            state: AuthState.AUTHENTICATED,
            username: 'chris',
          },
        };
      }
      throw new Error('Logout failed');
    });

    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    trigger.click();
    jest.useFakeTimers();
    (container.querySelector('#account-auth-action') as HTMLButtonElement).click();
    await flushPromises();
    jest.advanceTimersByTime(450);
    await flushPromises();

    const authButton = container.querySelector('#account-auth-action') as HTMLButtonElement;
    expect(container.textContent).toContain('Logout failed');
    expect(authButton.disabled).toBe(false);
    expect(authButton.textContent).toBe('Log out');
  });

  it('closes with Escape and restores expanded state', async () => {
    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    trigger.click();
    const menuEl = container.querySelector('#account-menu') as HTMLElement;
    menuEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(menuEl.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when the user clicks outside the menu', async () => {
    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    trigger.click();
    const menuEl = container.querySelector('#account-menu') as HTMLElement;
    expect(menuEl.hidden).toBe(false);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(menuEl.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('stays open on clicks inside the menu', async () => {
    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    (container.querySelector('#account-menu-btn') as HTMLButtonElement).click();
    const menuEl = container.querySelector('#account-menu') as HTMLElement;

    menuEl.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(menuEl.hidden).toBe(false);
  });

  it('does not resurrect a menu the user closed while a failing action was pending', async () => {
    let rejectFeedback: (value: { success: boolean; error: string }) => void = () => {};
    sendMessage = jest.fn().mockImplementation(async message => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        return { success: true, data: { state: AuthState.AUTHENTICATED, username: 'chris' } };
      }
      if (message.type === MessageType.OPEN_FEEDBACK_PAGE) {
        return new Promise(resolve => { rejectFeedback = resolve; });
      }
      return { success: true };
    });

    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    const trigger = container.querySelector('#account-menu-btn') as HTMLButtonElement;
    trigger.click();
    const menuEl = container.querySelector('#account-menu') as HTMLElement;
    (container.querySelector('#account-send-feedback') as HTMLButtonElement).click();

    // User dismisses the menu while the action is still in flight
    menuEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menuEl.hidden).toBe(true);

    rejectFeedback({ success: false, error: 'Tabs unavailable' });
    await flushPromises();

    // The failed action must not force the dismissed menu back open
    expect(menuEl.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('exposes closeMenu() so the host tray can dismiss it on interface mutations', async () => {
    const menu = new AccountMenu(container, sendMessage);
    await menu.mount();

    (container.querySelector('#account-menu-btn') as HTMLButtonElement).click();
    const menuEl = container.querySelector('#account-menu') as HTMLElement;
    expect(menuEl.hidden).toBe(false);

    menu.closeMenu();

    expect(menuEl.hidden).toBe(true);
  });
});
