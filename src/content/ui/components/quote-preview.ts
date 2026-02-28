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

    // Verify the selection is part of the tweet text
    if (tweetText && tweetText.includes(selectedText)) {
      return selectedText;
    }

    // Selection might not be exact match due to formatting, but if it's reasonable length, use it
    if (selectedText.length >= 10 && selectedText.length <= (tweetText?.length || 0)) {
      return selectedText;
    }

    return null;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
