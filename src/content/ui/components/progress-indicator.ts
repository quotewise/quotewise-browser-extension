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
  backendHintDelayMs?: number;
  backendHintRotateMs?: number;
  backendHints?: readonly string[];
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

const DEFAULT_BACKEND_HINT_DELAY_MS = 1800;
const DEFAULT_BACKEND_HINT_ROTATE_MS = 2200;
const DEFAULT_BACKEND_HINTS = [
  'Quotewise may be comparing against known quotes',
  'Quotewise may be double-checking the originator',
  'Quotewise may be saving the sighting trail',
  'Quotewise may be updating your collection',
  'Quotewise may be straightening the index cards',
] as const;

export class CaptureProgressIndicator {
  private phase: CaptureProgressPhase = 'idle';
  private errorMessage: string | null = null;
  private visible = false;
  private readonly showDebounced: DebouncedFunction<() => void>;
  private readonly onRetry?: () => void;
  private readonly backendHintDelayMs: number;
  private readonly backendHintRotateMs: number;
  private readonly backendHints: readonly string[];
  private backendHintVisible = false;
  private backendHintIndex = 0;
  private backendHintRevealTimer: number | null = null;
  private backendHintRotateTimer: number | null = null;

  constructor(
    private readonly container: HTMLElement,
    options: CaptureProgressIndicatorOptions = {},
  ) {
    this.onRetry = options.onRetry;
    this.backendHintDelayMs = options.backendHintDelayMs ?? DEFAULT_BACKEND_HINT_DELAY_MS;
    this.backendHintRotateMs = options.backendHintRotateMs ?? DEFAULT_BACKEND_HINT_ROTATE_MS;
    this.backendHints = options.backendHints?.length ? options.backendHints : DEFAULT_BACKEND_HINTS;
    this.showDebounced = debounce(() => {
      if (this.isPendingPhase(this.phase)) {
        this.visible = true;
        this.render();
        this.scheduleBackendHint();
      }
    }, options.debounceMs ?? 400);
  }

  setPhase(phase: CaptureProgressPhase, options: SetPhaseOptions = {}): void {
    this.phase = phase;
    this.errorMessage = null;
    this.showDebounced.cancel();
    this.clearBackendHintTimers();
    this.backendHintVisible = false;
    this.backendHintIndex = 0;

    if (this.isPendingPhase(phase)) {
      this.visible = options.immediate === true;
      this.render();
      if (options.immediate) {
        this.scheduleBackendHint();
        return;
      }
      this.showDebounced();
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
    this.clearBackendHintTimers();
    this.backendHintVisible = false;
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

    if (this.backendHintVisible) {
      const secondary = document.createElement('span');
      secondary.className = 'progress-secondary';
      secondary.textContent = this.backendHints[this.backendHintIndex];
      copy.appendChild(secondary);
    }

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

  private scheduleBackendHint(): void {
    this.clearBackendHintTimers();

    if (!this.visible || !this.isPendingPhase(this.phase) || this.backendHints.length === 0) {
      return;
    }

    this.backendHintRevealTimer = window.setTimeout(() => {
      if (!this.visible || !this.isPendingPhase(this.phase)) {
        return;
      }

      this.backendHintVisible = true;
      this.render();
      this.scheduleBackendHintRotation();
    }, this.backendHintDelayMs);
  }

  private scheduleBackendHintRotation(): void {
    this.backendHintRotateTimer = window.setTimeout(() => {
      if (!this.visible || !this.isPendingPhase(this.phase)) {
        return;
      }

      this.backendHintIndex = (this.backendHintIndex + 1) % this.backendHints.length;
      this.render();
      this.scheduleBackendHintRotation();
    }, this.backendHintRotateMs);
  }

  private clearBackendHintTimers(): void {
    if (this.backendHintRevealTimer !== null) {
      window.clearTimeout(this.backendHintRevealTimer);
      this.backendHintRevealTimer = null;
    }
    if (this.backendHintRotateTimer !== null) {
      window.clearTimeout(this.backendHintRotateTimer);
      this.backendHintRotateTimer = null;
    }
  }
}
