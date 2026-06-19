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
    sendMessage = jest.fn().mockResolvedValue({ success: true });
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({
      settings: {
        privateMode: false,
        autoAddToCollection: false,
        defaultCollectionId: null,
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
        autoAddToCollection: false,
        defaultCollectionId: null,
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
});
