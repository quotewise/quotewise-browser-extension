import { QuotePreview } from '../../../../src/content/ui/components/quote-preview';
import { selectTextWithin } from '../../../helpers/select-text';

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
    expect(container.querySelector('.badge.info')?.textContent).toBe('Full source');
    expect(container.querySelector('.quote-text')?.textContent).toBe('Hello world');
    expect(container.querySelector('.clear-selection')).toBeNull();
  });

  it('shows exact text for long full-source submissions', () => {
    const longText = 'a'.repeat(150);
    preview.update(longText, null);
    const displayed = container.querySelector('.quote-text')?.textContent;
    expect(displayed).toBe(longText);
  });

  it('shows selected text with Selection badge and clear button', () => {
    preview.update('full tweet text here', 'selected portion');
    expect(container.querySelector('.badge.info')?.textContent).toBe('Selection');
    expect(container.querySelector('.quote-text')?.textContent).toBe('selected portion');
    expect(container.querySelector('.clear-selection')).not.toBeNull();
  });

  it('calls onClearSelection when clear button clicked', () => {
    preview.update('full tweet text', 'partial');
    const clearBtn = container.querySelector('.clear-selection') as HTMLElement;
    clearBtn.click();
    expect(clearCalls).toBe(1);
  });

  it('shows a selection-required prompt with no submittable text', () => {
    preview.showSelectionRequired();
    expect(container.querySelector('.badge.warning')).not.toBeNull();
    expect(container.textContent?.toLowerCase()).toContain('select');
    expect(container.querySelector('.clear-selection')).toBeNull();
  });

  it('escapes HTML in text display', () => {
    preview.update('<script>alert("xss")</script>', null);
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.querySelector('.quote-text')?.textContent).toContain('<script>');
  });

  it('shows paragraph breaks in the capture preview without raw emphasis tags', () => {
    preview.update('full source', 'First paragraph.\n\nSecond with <b>bold</b> &amp; &lt;i&gt;words&lt;/i&gt;.');
    const quote = container.querySelector('.quote-text');
    expect(quote?.textContent).toBe('First paragraph.\n\nSecond with bold & <i>words</i>.');
    expect(quote?.querySelector('strong')?.textContent).toBe('bold');
    expect(quote?.querySelector('b, i, script')).toBeNull();
    expect(quote?.innerHTML).not.toContain('<b>');
  });

  describe('getPageSelection', () => {
    afterEach(() => {
      window.getSelection()?.removeAllRanges();
      document.body.innerHTML = '';
    });

    it('returns null when no selection', () => {
      // jsdom default: no selection or collapsed
      expect(QuotePreview.getPageSelection('some tweet')).toBeNull();
    });

    it('returns selected text that is part of tweet text', () => {
      const tweetText = 'This is a full tweet with some content';
      document.body.innerHTML = `<div data-testid="tweetText" id="tweet">${tweetText}</div>`;
      selectTextWithin(document.getElementById('tweet') as HTMLElement, 'full tweet with some');

      expect(QuotePreview.getPageSelection(tweetText)).toBe('full tweet with some');
    });

    it('returns null when selected text is not part of tweet', () => {
      document.body.innerHTML = '<div id="sidebar">short</div>';
      selectTextWithin(document.getElementById('sidebar') as HTMLElement, 'short');

      expect(QuotePreview.getPageSelection('completely different text')).toBeNull();
    });

    it('returns null when tweet text is undefined', () => {
      expect(QuotePreview.getPageSelection(undefined)).toBeNull();
    });

    it('honors a genuine selection anchored within an article even when the extracted tweet text is wrong/short', () => {
      // Reproduces the article/subscription-page bug: extracted text is the
      // subscribe CTA, which does NOT contain the reader's highlighted passage.
      document.body.innerHTML = `
        <article data-testid="tweet">
          <div role="button"><span dir="auto">Click to Subscribe to Kpaxs</span></div>
          <div dir="auto" lang="en" id="body">The actual long-form article passage that the reader highlighted.</div>
        </article>
      `;
      const selectedText = 'long-form article passage that the reader highlighted';
      selectTextWithin(document.getElementById('body') as HTMLElement, selectedText);

      // The mis-extracted "tweet text" is the CTA, which does not contain the selection.
      expect(QuotePreview.getPageSelection('Click to Subscribe to Kpaxs')).toBe(selectedText);
    });

    it('honors a selection inside the X Article read-view even when not wrapped in an <article>', () => {
      document.body.innerHTML = `
        <div data-testid="twitterArticleReadView">
          <div data-testid="longformRichTextComponent" id="lf">
            <span>some highlighted long-form passage</span>
          </div>
        </div>
      `;
      const selectedText = 'highlighted long-form passage';
      selectTextWithin(document.querySelector('#lf span') as HTMLElement, selectedText);

      expect(QuotePreview.getPageSelection('Click to Subscribe to Kpaxs')).toBe(selectedText);
    });

    it('ignores a selection that is outside any article/tweet content', () => {
      document.body.innerHTML = `<div id="sidebar">Trending: something unrelated and long enough</div>`;
      selectTextWithin(document.getElementById('sidebar') as HTMLElement, 'something unrelated and long enough');

      expect(QuotePreview.getPageSelection('Click to Subscribe to Kpaxs')).toBeNull();
    });
  });
});
