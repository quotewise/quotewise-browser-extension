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

  it('renders custom content with a new-tab link when provided', () => {
    const notice = new FirstRunNotice(container, { onDismiss }, {
      message: 'Capture passages worth quoting a year from now.',
      ariaLabel: 'Quotewise capture guidance',
      dismissAriaLabel: 'Dismiss capture guidance',
      link: { href: 'https://quotewise.io/about/what-to-collect/', text: 'What makes a good capture' },
    });

    notice.show();

    const section = container.querySelector('.first-run-notice') as HTMLElement;
    expect(section.getAttribute('aria-label')).toBe('Quotewise capture guidance');
    expect(section.textContent).toContain('worth quoting a year from now');

    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link.href).toBe('https://quotewise.io/about/what-to-collect/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.textContent).toContain('What makes a good capture');

    const dismiss = container.querySelector('button') as HTMLButtonElement;
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss capture guidance');
  });

  it('does not duplicate itself when shown repeatedly', () => {
    const notice = new FirstRunNotice(container, { onDismiss });

    notice.show();
    notice.show();

    expect(container.querySelectorAll('.first-run-notice')).toHaveLength(1);
  });
});
