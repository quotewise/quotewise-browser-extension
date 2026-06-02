export interface QuotePreviewCallbacks {
  onClearSelection: () => void;
}

export class QuotePreview {
  constructor(
    private container: HTMLElement,
    private callbacks: QuotePreviewCallbacks
  ) {}

  update(text: string, selectedText: string | null): void {
    if (selectedText) {
      this.container.innerHTML = `
        <span class="badge info">Selection</span>
        <span class="quote-text">"${this.escapeHtml(selectedText)}"</span>
        <button class="clear-selection" title="Use full tweet">✕</button>
      `;
      const clearBtn = this.container.querySelector('.clear-selection');
      clearBtn?.addEventListener('click', () => {
        this.callbacks.onClearSelection();
      });
    } else {
      const preview = text.length > 100
        ? text.substring(0, 100) + '...'
        : text;
      this.container.innerHTML = `<span class="quote-text">"${this.escapeHtml(preview)}"</span>`;
    }
  }

  /**
   * Article pages require an explicit selection (the full body is far too long
   * to be a useful quote). Prompt the reader to highlight a passage.
   */
  showSelectionRequired(): void {
    this.container.innerHTML = `
      <span class="badge warning">Select text</span>
      <span class="quote-text">Highlight a passage in the article to capture it as a quote.</span>
    `;
  }

  showSuccess(text: string, wasPartial: boolean): void {
    const preview = text.length > 80
      ? text.substring(0, 80) + '...'
      : text;

    if (wasPartial) {
      this.container.innerHTML = `
        <span class="badge info">Selection</span>
        <span class="badge success">✓ Submitted</span>
        <span class="quote-text">"${this.escapeHtml(preview)}"</span>
      `;
    } else {
      this.container.innerHTML = `
        <span class="badge success">✓ Submitted</span>
        <span class="quote-text">"${this.escapeHtml(preview)}"</span>
      `;
    }
  }

  static getPageSelection(tweetText: string | undefined): string | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;

    const selectedText = selection.toString().trim();
    if (!selectedText) return null;

    // Fast path: the selection is a verbatim subset of the extracted text.
    if (tweetText && tweetText.includes(selectedText)) {
      return selectedText;
    }

    // Otherwise honor a genuine selection that is anchored inside the tweet /
    // long-form article content. On article and subscription pages the
    // extracted `tweetText` is often partial or wrong (e.g. a "Subscribe"
    // CTA), so we must not gate the user's highlight on it — only on whether
    // the highlight actually lives within the post's content.
    if (QuotePreview.isSelectionWithinPostContent(selection)) {
      return selectedText;
    }

    return null;
  }

  /**
   * Whether the selection's anchor sits inside a post-content container (a
   * tweet or an X Article read view) as opposed to the sidebar, nav, or other
   * page chrome. The long-form read view normally nests inside an
   * <article>, but it is matched explicitly so selections are honored even on
   * layouts where it does not.
   */
  private static isSelectionWithinPostContent(selection: Selection): boolean {
    const anchor = selection.anchorNode;
    if (!anchor) return false;
    const anchorEl = anchor instanceof Element ? anchor : anchor.parentElement;
    return !!anchorEl?.closest(
      'article, [data-testid="tweet"], [data-testid="twitterArticleReadView"], [data-testid="longformRichTextComponent"]'
    );
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
