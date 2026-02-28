import { QuotePreview } from '../../../../src/content/ui/components/quote-preview';

describe('QuotePreview', () => {
  let container: HTMLElement;
  let clearCalls: number;
  let preview: QuotePreview;

  beforeEach(() => {
    container = document.createElement('div');
    clearCalls = 0;
    preview = new QuotePreview(container, {
      onClearSelection: () => { clearCalls++; },
    });
  });

  it('shows full text when no selection', () => {
    preview.update('Hello world', null);
    expect(container.querySelector('.quote-text')?.textContent).toBe('"Hello world"');
    expect(container.querySelector('.badge')).toBeNull();
    expect(container.querySelector('.clear-selection')).toBeNull();
  });

  it('shows truncated text with "..." for text > 100 chars', () => {
    const longText = 'a'.repeat(150);
    preview.update(longText, null);
    const displayed = container.querySelector('.quote-text')?.textContent;
    expect(displayed).toBe(`"${'a'.repeat(100)}..."`);
  });

  it('shows selected text with Selection badge and clear button', () => {
    preview.update('full tweet text here', 'selected portion');
    expect(container.querySelector('.badge.info')?.textContent).toBe('Selection');
    expect(container.querySelector('.quote-text')?.textContent).toBe('"selected portion"');
    expect(container.querySelector('.clear-selection')).not.toBeNull();
  });

  it('calls onClearSelection when clear button clicked', () => {
    preview.update('full tweet text', 'partial');
    const clearBtn = container.querySelector('.clear-selection') as HTMLElement;
    clearBtn.click();
    expect(clearCalls).toBe(1);
  });

  it('shows success state without Selection badge', () => {
    preview.showSuccess('submitted text', false);
    expect(container.querySelector('.badge.success')?.textContent).toBe('✓ Submitted');
    expect(container.querySelector('.badge.info')).toBeNull();
    expect(container.querySelector('.quote-text')?.textContent).toContain('submitted text');
    expect(container.querySelector('.clear-selection')).toBeNull();
  });

  it('shows success state with Selection badge when wasPartial', () => {
    preview.showSuccess('partial text', true);
    expect(container.querySelector('.badge.info')?.textContent).toBe('Selection');
    expect(container.querySelector('.badge.success')?.textContent).toBe('✓ Submitted');
  });

  it('truncates success text at 80 chars', () => {
    const longText = 'b'.repeat(100);
    preview.showSuccess(longText, false);
    const displayed = container.querySelector('.quote-text')?.textContent;
    expect(displayed).toBe(`"${'b'.repeat(80)}..."`);
  });

  it('escapes HTML in text display', () => {
    preview.update('<script>alert("xss")</script>', null);
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.querySelector('.quote-text')?.textContent).toContain('<script>');
  });

  describe('getPageSelection', () => {
    it('returns null when no selection', () => {
      // jsdom default: no selection or collapsed
      expect(QuotePreview.getPageSelection('some tweet')).toBeNull();
    });

    it('returns selected text that is part of tweet text', () => {
      const tweetText = 'This is a full tweet with some content';
      // Mock window.getSelection
      const mockSelection = {
        isCollapsed: false,
        toString: () => 'full tweet with some',
      };
      jest.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      expect(QuotePreview.getPageSelection(tweetText)).toBe('full tweet with some');

      jest.restoreAllMocks();
    });

    it('returns null when selected text is not part of tweet', () => {
      const mockSelection = {
        isCollapsed: false,
        toString: () => 'short',
      };
      jest.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      expect(QuotePreview.getPageSelection('completely different text')).toBeNull();

      jest.restoreAllMocks();
    });

    it('returns null when tweet text is undefined', () => {
      expect(QuotePreview.getPageSelection(undefined)).toBeNull();
    });
  });
});
