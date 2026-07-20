import { debounce, type DebouncedFunction } from '../../../utils/debounce';

export type CaptureProgressPhase =
  | 'idle'
  | 'checking'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'error';

interface CaptureProgressIndicatorOptions {
  debounceMs?: number;
  onRetry?: () => void;
}

interface SetPhaseOptions {
  immediate?: boolean;
}

const PHASE_TEXT: Record<Exclude<CaptureProgressPhase, 'idle' | 'success' | 'error'>, string> = {
  checking: 'Checking quote',
  submitting: 'Saving to Quotewise',
  confirming: 'Confirming',
};

export class CaptureProgressIndicator {
  private phase: CaptureProgressPhase = 'idle';
  private errorMessage: string | null = null;
  private visible = false;
  private readonly showDebounced: DebouncedFunction<() => void>;
  private readonly onRetry?: () => void;

  constructor(
    private readonly container: HTMLElement,
    options: CaptureProgressIndicatorOptions = {},
  ) {
    this.onRetry = options.onRetry;
    this.showDebounced = debounce(() => {
      if (this.isPendingPhase(this.phase)) {
        this.visible = true;
        this.render();
      }
    }, options.debounceMs ?? 400);
  }

  setPhase(phase: CaptureProgressPhase, options: SetPhaseOptions = {}): void {
    this.phase = phase;
    this.errorMessage = null;
    this.showDebounced.cancel();

    if (this.isPendingPhase(phase)) {
      this.visible = options.immediate === true;
      this.render();
      if (!options.immediate) {
        this.showDebounced();
      }
      return;
    }

    this.visible = false;
    this.render();
  }

  setError(message: string): void {
    this.phase = 'error';
    this.errorMessage = message;
    this.visible = true;
    this.showDebounced.cancel();
    this.render();
  }

  reset(): void {
    this.setPhase('idle');
  }

  private isPendingPhase(
    phase: CaptureProgressPhase,
  ): phase is Exclude<CaptureProgressPhase, 'idle' | 'success' | 'error'> {
    return phase === 'checking' || phase === 'submitting' || phase === 'confirming';
  }

  private render(): void {
    this.container.innerHTML = '';

    if (this.phase === 'error') {
      const wrapper = document.createElement('div');
      wrapper.className = 'capture-progress error';
      wrapper.setAttribute('role', 'alert');

      const message = document.createElement('span');
      message.textContent = this.errorMessage || 'Something went wrong.';
      wrapper.appendChild(message);

      if (this.onRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'progress-retry';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => this.onRetry?.());
        wrapper.appendChild(retry);
      }

      this.container.appendChild(wrapper);
      return;
    }

    if (!this.visible || !this.isPendingPhase(this.phase)) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'capture-progress';
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');

    const text = document.createElement('span');
    text.className = 'progress-text';
    text.textContent = PHASE_TEXT[this.phase];

    const copy = document.createElement('span');
    copy.className = 'progress-copy';
    copy.appendChild(text);

    wrapper.appendChild(copy);

    const track = document.createElement('span');
    track.className = 'progress-track';
    track.setAttribute('aria-hidden', 'true');

    const bar = document.createElement('span');
    bar.className = 'progress-bar';
    track.appendChild(bar);
    wrapper.appendChild(track);

    this.container.appendChild(wrapper);
  }
}
