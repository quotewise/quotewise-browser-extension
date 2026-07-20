export interface FirstRunNoticeCallbacks {
  onDismiss: () => void;
}

export interface FirstRunNoticeContent {
  message: string;
  ariaLabel: string;
  dismissAriaLabel: string;
  link?: { href: string; text: string };
}

const PRIVACY_NOTICE: FirstRunNoticeContent = {
  message: 'Quotewise can check this post before capture. Private mode pauses those checks until you ask.',
  ariaLabel: 'Quotewise privacy notice',
  dismissAriaLabel: 'Dismiss privacy notice',
};

export class FirstRunNotice {
  private element: HTMLElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: FirstRunNoticeCallbacks,
    private readonly content: FirstRunNoticeContent = PRIVACY_NOTICE,
  ) {}

  show(): void {
    if (this.element) {
      return;
    }

    const notice = document.createElement('section');
    notice.className = 'first-run-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-label', this.content.ariaLabel);

    const text = document.createElement('span');
    text.textContent = this.content.message;
    if (this.content.link) {
      text.append(' ');
      const link = document.createElement('a');
      link.href = this.content.link.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${this.content.link.text} →`;
      link.setAttribute('aria-label', `${this.content.link.text} (opens in a new tab)`);
      text.appendChild(link);
    }
    notice.appendChild(text);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'notice-dismiss';
    dismiss.setAttribute('aria-label', this.content.dismissAriaLabel);
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => this.dismiss());
    notice.appendChild(dismiss);

    this.element = notice;
    this.container.appendChild(notice);
  }

  dismiss(): void {
    this.element?.remove();
    this.element = null;
    this.callbacks.onDismiss();
  }

  hide(): void {
    this.element?.remove();
    this.element = null;
  }

  isVisible(): boolean {
    return this.element !== null;
  }
}
