import { FirstRunNotice } from '../../src/content/ui/components/first-run-notice';

describe('FirstRunNotice', () => {
  let container: HTMLElement;
  let onDismiss: jest.Mock;

  beforeEach(() => {
    container = document.createElement('div');
    onDismiss = jest.fn();
  });

  it('renders a non-blocking dismissible in-overlay notice with ARIA', () => {
    const notice = new FirstRunNotice(container, { onDismiss });

    notice.show();

    const section = container.querySelector('.first-run-notice') as HTMLElement;
    expect(section).toBeTruthy();
    expect(section.getAttribute('role')).toBe('status');
    expect(section.getAttribute('aria-label')).toBe('Quotewise privacy notice');
    expect(section.textContent).toContain('Private mode pauses those checks');

    const dismiss = container.querySelector('button') as HTMLButtonElement;
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss privacy notice');
    dismiss.click();

    expect(container.querySelector('.first-run-notice')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate itself when shown repeatedly', () => {
    const notice = new FirstRunNotice(container, { onDismiss });

    notice.show();
    notice.show();

    expect(container.querySelectorAll('.first-run-notice')).toHaveLength(1);
  });
});
