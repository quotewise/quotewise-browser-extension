import { quoteDocumentFromSelection } from '../../selection/dom-walk';
import { quotePlainText } from '../../selection/quote-document';
import { renderQuoteInto, serializeQuote } from '../../selection/serialize-quote';
import { normalizeQuoteText } from '../../../utils/quote-text';

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
        <span class="quote-text"></span>
        <button class="clear-selection" title="Use full source" aria-label="Use full source text">✕</button>
      `;
      const quoteText = this.container.querySelector('.quote-text');
      if (quoteText instanceof HTMLElement) renderQuoteInto(quoteText, selectedText);
      const clearBtn = this.container.querySelector('.clear-selection');
      clearBtn?.addEventListener('click', () => {
        this.callbacks.onClearSelection();
      });
    } else {
      this.container.innerHTML = `
        <span class="badge info">Full source</span>
        <span class="quote-text">${this.escapeHtml(text)}</span>
      `;
    }
  }

  /**
   * Article pages require an explicit selection (the full body is far too long
   * to be a useful quote). Prompt the reader to highlight a passage.
   */
  showSelectionRequired(): void {
    this.container.innerHTML = `
      <span class="badge warning">Select text</span>
      <span class="quote-text quote-text-muted">Highlight a passage in the article to capture it as a quote.</span>
    `;
  }

  /**
   * Read the live page selection as quote text.
   *
   * Selection.toString() flattens the range: paragraph breaks arrive as single
   * newlines and bold/italic is dropped. Walk the range instead, then serialize
   * the structure. The subset check uses the plain text so tags do not have to
   * appear in the extracted post.
   */
  static getPageSelection(postText: string | undefined): string | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const quote = quoteDocumentFromSelection(selection);
    const plain = normalizeQuoteText(quotePlainText(quote));
    if (!plain) return null;

    const isAnchoredSelection = selection.anchorNode
      ? QuotePreview.isSelectionWithinPostContent(selection, postText)
      : null;
    if (isAnchoredSelection === false) return null;

    const selectedText = serializeQuote(quote);
    if (!selectedText) return null;

    // Fast path: the selection's words appear in the extracted post text.
    if (postText && normalizeQuoteText(postText).includes(plain)) {
      return selectedText;
    }

    // Otherwise honor a genuine selection that is anchored inside the tweet /
    // long-form article content. On article and subscription pages the
    // extracted `postText` is often partial or wrong (e.g. a "Subscribe"
    // CTA), so we must not gate the user's highlight on it — only on whether
    // the highlight actually lives within the post's content.
    if (isAnchoredSelection) {
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
  private static isSelectionWithinPostContent(selection: Selection, postText?: string): boolean {
    const anchor = selection.anchorNode;
    if (!anchor) return false;
    const anchorEl = anchor instanceof Element ? anchor : anchor.parentElement;
    if (!anchorEl) return false;

    if (anchorEl.closest(
      '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]'
    )) {
      return true;
    }

    const postTextContainer = anchorEl.closest('[data-testid="tweetText"]');
    if (postTextContainer) {
      if (!postText) return true;
      const containerText = postTextContainer.textContent?.replace(/\s+/g, ' ').trim();
      return containerText === postText.replace(/\s+/g, ' ').trim();
    }

    const article = anchorEl.closest('article, [data-testid="tweet"]');
    return !!article && !article.querySelector('[data-testid="tweetText"]');
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
