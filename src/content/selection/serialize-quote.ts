import type { Inline, QuoteDocument, TextRun } from './quote-document';

/**
 * Wire format for a captured quote. This is the kernel's Wikiquote storage
 * model: a blank line separates paragraphs, one newline is a soft break, and
 * the only markup is <b>, <i>, and nested <b><i> for bold italic.
 *
 * The kernel treats those tags as markup and renders the rest as text. `&`,
 * `<`, and `>` in the source are escaped so a page that literally says "<b>"
 * does not become bold, and so those characters come back out as themselves.
 * Asterisks and backslashes are ordinary characters.
 */
export function serializeQuote(document: QuoteDocument): string {
  return document.paragraphs
    .map(paragraph => serializeInlines(paragraph.inlines))
    .filter(paragraph => paragraph.length > 0)
    .join('\n\n');
}

/**
 * Show stored quote text in the capture preview: paragraphs and soft breaks
 * stay, and emphasis is drawn as bold/italic instead of the raw tags.
 */
export function renderQuoteInto(container: HTMLElement, wire: string): void {
  container.replaceChildren();
  const doc = container.ownerDocument;
  const stack: HTMLElement[] = [container];
  const token = /<\/?[bi]>|&(?:amp|lt|gt);|\n/g;
  let cursor = 0;

  const appendText = (text: string) => {
    if (!text) return;
    stack[stack.length - 1].appendChild(doc.createTextNode(text));
  };

  const open = (tag: 'b' | 'i') => {
    const element = doc.createElement(tag === 'b' ? 'strong' : 'em');
    stack[stack.length - 1].appendChild(element);
    stack.push(element);
  };

  const close = (tag: 'b' | 'i') => {
    const expected = tag === 'b' ? 'STRONG' : 'EM';
    if (stack.length > 1 && stack[stack.length - 1].tagName === expected) {
      stack.pop();
    }
  };

  for (const match of wire.matchAll(token)) {
    const index = match.index ?? 0;
    appendText(wire.slice(cursor, index));
    const found = match[0];
    switch (found) {
      case '<b>':
        open('b');
        break;
      case '</b>':
        close('b');
        break;
      case '<i>':
        open('i');
        break;
      case '</i>':
        close('i');
        break;
      case '&amp;':
        appendText('&');
        break;
      case '&lt;':
        appendText('<');
        break;
      case '&gt;':
        appendText('>');
        break;
      case '\n':
        appendText('\n');
        break;
      default:
        appendText(found);
        break;
    }
    cursor = index + found.length;
  }
  appendText(wire.slice(cursor));
}

function serializeInlines(inlines: Inline[]): string {
  let text = '';
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text':
        text += wrapRun(inline);
        break;
      case 'soft-break':
        text += '\n';
        break;
      default: {
        const unexpected: never = inline;
        throw new Error(`Unexpected inline kind: ${JSON.stringify(unexpected)}`);
      }
    }
  }
  return text;
}

function wrapRun(run: TextRun): string {
  const escaped = escapeText(run.text);
  if (!escaped) return '';
  if (run.bold && run.italic) return `<b><i>${escaped}</i></b>`;
  if (run.bold) return `<b>${escaped}</b>`;
  if (run.italic) return `<i>${escaped}</i>`;
  return escaped;
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
