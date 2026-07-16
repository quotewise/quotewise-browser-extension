export interface FirstRunNoticeCallbacks {
  onDismiss: () => void;
}

export class FirstRunNotice {
  private element: HTMLElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: FirstRunNoticeCallbacks,
  ) {}

  show(): void {
    if (this.element) {
      return;
    }

    const notice = document.createElement('section');
    notice.className = 'first-run-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-label', 'Quotewise privacy notice');

    const text = document.createElement('span');
    text.textContent = 'Quotewise can check this post before capture. Private mode pauses those checks until you ask.';
    notice.appendChild(text);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'notice-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss privacy notice');
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
