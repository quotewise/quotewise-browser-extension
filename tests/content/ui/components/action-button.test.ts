import { ActionButton, ActionButtonCallbacks } from '../../../../src/content/ui/components/action-button';

describe('ActionButton', () => {
  let container: HTMLElement;
  let callbacks: ActionButtonCallbacks;
  let onSubmitCalls: number;
  let onLoginResult: { success: boolean; error?: string };
  let onLoginCalls: number;
  let actionButton: ActionButton;

  beforeEach(() => {
    container = document.createElement('div');
    onSubmitCalls = 0;
    onLoginCalls = 0;
    onLoginResult = { success: true };

    callbacks = {
      onSubmit: () => { onSubmitCalls++; },
      onLogin: async () => { onLoginCalls++; return onLoginResult; },
    };

    actionButton = new ActionButton(container, callbacks);
  });

  it('shows disabled submit button by default via showSubmit(false)', () => {
    actionButton.showSubmit(false);
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Submit Quote');
    expect(btn.className).toBe('success');
  });

  it('shows enabled submit button via showSubmit(true)', () => {
    actionButton.showSubmit(true);
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Submit Quote');
  });

  it('shows custom text via showSubmit(true, "Retry")', () => {
    actionButton.showSubmit(true, 'Retry');
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toBe('Retry');
    expect(btn.disabled).toBe(false);
  });

  it('shows warning-style submit via showSubmitWarning(true, "Add Another Sighting")', () => {
    actionButton.showSubmitWarning(true, 'Add Another Sighting');
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.className).toBe('warning');
    expect(btn.textContent).toBe('Add Another Sighting');
  });

  it('calls onSubmit when submit button clicked', () => {
    actionButton.showSubmit(true);
    const btn = container.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(onSubmitCalls).toBe(1);
  });

  it('shows login button via showLogin()', () => {
    actionButton.showLogin();
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Login to Quotewise');
    expect(btn.className).toBe('primary');
    expect(btn.disabled).toBe(false);
  });

  it('disables login button and shows "Logging in..." during login', async () => {
    // Make login hang until we resolve
    let resolveLogin!: (val: { success: boolean }) => void;
    callbacks.onLogin = () => new Promise((r) => { resolveLogin = r; });

    actionButton.showLogin();
    const btn = container.querySelector('button') as HTMLButtonElement;
    btn.click();

    // Wait a tick for the async handler to start
    await Promise.resolve();

    expect(btn.textContent).toBe('Logging in...');
    expect(btn.disabled).toBe(true);

    resolveLogin({ success: true });
    await Promise.resolve();
  });

  it('shows "Retry Login" after failed login', async () => {
    onLoginResult = { success: false, error: 'Auth failed' };
    actionButton.showLogin();
    const btn = container.querySelector('button') as HTMLButtonElement;
    btn.click();

    // Wait for the async handler
    await new Promise((r) => setTimeout(r, 0));

    expect(btn.textContent).toBe('Retry Login');
    expect(btn.disabled).toBe(false);
  });

  it('calls onLogin when login button clicked', async () => {
    actionButton.showLogin();
    const btn = container.querySelector('button') as HTMLButtonElement;
    btn.click();

    await new Promise((r) => setTimeout(r, 0));
    expect(onLoginCalls).toBe(1);
  });

  it('does not crash if showSubmit called before any button exists', () => {
    // No button created yet — should not throw
    expect(() => actionButton.showSubmit(false)).not.toThrow();
    // Button should be created
    expect(container.querySelector('button')).toBeTruthy();
  });

  it('replaces login button with submit button when switching modes', () => {
    actionButton.showLogin();
    expect(container.querySelector('#login-btn')).toBeTruthy();

    actionButton.showSubmit(true);
    expect(container.querySelector('#login-btn')).toBeNull();
    expect(container.querySelector('#submit-btn')).toBeTruthy();
  });

  it('replaces submit button with login button when switching modes', () => {
    actionButton.showSubmit(true);
    expect(container.querySelector('#submit-btn')).toBeTruthy();

    actionButton.showLogin();
    expect(container.querySelector('#submit-btn')).toBeNull();
    expect(container.querySelector('#login-btn')).toBeTruthy();
  });

  it('reuses existing submit button without recreating', () => {
    actionButton.showSubmit(false);
    const btn1 = container.querySelector('button');
    actionButton.showSubmit(true, 'Go');
    const btn2 = container.querySelector('button');
    expect(btn1).toBe(btn2);
  });
});
