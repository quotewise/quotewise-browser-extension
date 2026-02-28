export interface ActionButtonCallbacks {
  onSubmit: () => void;
  onLogin: () => Promise<{ success: boolean; error?: string }>;
}

export class ActionButton {
  private button: HTMLButtonElement | null = null;
  private mode: 'submit' | 'login' = 'submit';

  constructor(
    private container: HTMLElement,
    private callbacks: ActionButtonCallbacks
  ) {}

  showSubmit(enabled: boolean, text?: string): void {
    this.ensureButton('submit');
    if (!this.button) return;
    this.button.disabled = !enabled;
    this.button.className = 'success';
    this.button.textContent = text || 'Submit Quote';
  }

  showSubmitWarning(enabled: boolean, text: string): void {
    this.ensureButton('submit');
    if (!this.button) return;
    this.button.disabled = !enabled;
    this.button.className = 'warning';
    this.button.textContent = text;
  }

  showLogin(): void {
    this.ensureButton('login');
    if (!this.button) return;
    this.button.disabled = false;
    this.button.className = 'primary';
    this.button.textContent = 'Login to Quotewise';
  }

  private ensureButton(mode: 'submit' | 'login'): void {
    if (this.button && this.mode === mode) return;

    // Remove existing button
    if (this.button) {
      this.button.remove();
      this.button = null;
    }

    const btn = document.createElement('button');
    this.mode = mode;

    if (mode === 'submit') {
      btn.id = 'submit-btn';
      btn.className = 'success';
      btn.textContent = 'Submit Quote';
      btn.disabled = true;
      btn.addEventListener('click', () => this.callbacks.onSubmit());
    } else {
      btn.id = 'login-btn';
      btn.className = 'primary';
      btn.textContent = 'Login to Quotewise';
      btn.addEventListener('click', () => this.handleLogin(btn));
    }

    this.button = btn;
    this.container.appendChild(btn);
  }

  private async handleLogin(btn: HTMLButtonElement): Promise<void> {
    btn.textContent = 'Logging in...';
    btn.disabled = true;

    const result = await this.callbacks.onLogin();

    if (!result.success) {
      btn.textContent = 'Retry Login';
      btn.disabled = false;
    }
    // On success, the overlay bar handles collapse/re-expand;
    // the button may be replaced by showSubmit() at that point.
  }
}
