import {
  CaptureProgressIndicator,
  type CaptureProgressPhase,
} from '../../src/content/ui/components/progress-indicator';

describe('CaptureProgressIndicator', () => {
  let container: HTMLElement;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement('div');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('does not render progress before the debounce window', () => {
    const indicator = new CaptureProgressIndicator(container, { debounceMs: 400 });

    indicator.setPhase('checking');
    jest.advanceTimersByTime(399);

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('renders slow phases in order after the debounce window', () => {
    const indicator = new CaptureProgressIndicator(container, { debounceMs: 400 });
    const phases: CaptureProgressPhase[] = ['checking', 'submitting', 'confirming'];
    const text: string[] = [];

    for (const phase of phases) {
      indicator.setPhase(phase);
      jest.advanceTimersByTime(400);
      text.push(container.textContent?.trim() ?? '');
    }

    expect(text).toEqual(['Checking quote', 'Saving to Quotewise', 'Confirming']);
  });

  it('can render a pending phase immediately for explicit submit progress', () => {
    const indicator = new CaptureProgressIndicator(container, { debounceMs: 400 });

    indicator.setPhase('checking', { immediate: true });

    expect(container.querySelector('[role="status"]')?.textContent).toContain('Checking quote');
    expect(container.querySelector('.progress-track')).toBeTruthy();
    expect(container.querySelector('.progress-bar')).toBeTruthy();
  });

  it('clears progress on fast success before the debounce window', () => {
    const indicator = new CaptureProgressIndicator(container, { debounceMs: 400 });

    indicator.setPhase('checking');
    jest.advanceTimersByTime(100);
    indicator.setPhase('success');
    jest.advanceTimersByTime(400);

    expect(container.innerHTML).toBe('');
  });

  it('uses a linear progress bar instead of a second status control', () => {
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
    const indicator = new CaptureProgressIndicator(container, { debounceMs: 400 });

    indicator.setPhase('checking');
    jest.advanceTimersByTime(400);

    expect(container.textContent).toContain('Checking quote');
    expect(container.querySelector('.progress-track')).toBeTruthy();
    expect(container.querySelector('.progress-bar')).toBeTruthy();
    expect(container.querySelector('.progress-spinner')).toBeNull();
  });

  it('renders an honest error with retry and never success', () => {
    const onRetry = jest.fn();
    const indicator = new CaptureProgressIndicator(container, { debounceMs: 400, onRetry });

    indicator.setPhase('submitting');
    jest.advanceTimersByTime(400);
    indicator.setError('Network failed');

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Network failed');
    expect(container.textContent).not.toContain('Done');

    const retry = container.querySelector('button') as HTMLButtonElement;
    expect(retry.textContent).toBe('Retry');
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
