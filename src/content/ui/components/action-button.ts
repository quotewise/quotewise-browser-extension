export interface ActionButtonCallbacks {
  onSubmit: () => void;
  onLogin: () => Promise<{ success: boolean; error?: string }>;
  onViewQuote: (url: string) => void;
}

export class ActionButton {
  private button: HTMLButtonElement | null = null;
  private mode: 'submit' | 'login' | 'view_quote' = 'submit';
  private viewQuoteUrl: string | null = null;

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

  showViewQuote(url: string, text = 'View Quote'): void {
    this.viewQuoteUrl = url;
    this.ensureButton('view_quote');
    if (!this.button) return;
    this.button.disabled = false;
    this.button.className = 'primary';
    this.button.textContent = text;
  }

  private ensureButton(mode: 'submit' | 'login' | 'view_quote'): void {
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
    } else if (mode === 'login') {
      btn.id = 'login-btn';
      btn.className = 'primary';
      btn.textContent = 'Login to Quotewise';
      btn.addEventListener('click', () => this.handleLogin(btn));
    } else {
      btn.id = 'view-quote-btn';
      btn.className = 'primary';
      btn.textContent = 'View Quote';
      btn.addEventListener('click', () => this.handleViewQuote());
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

  private handleViewQuote(): void {
    if (!this.viewQuoteUrl) return;
    this.callbacks.onViewQuote(this.viewQuoteUrl);
  }
}
