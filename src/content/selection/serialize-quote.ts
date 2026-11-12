import type { Inline, QuoteDocument, TextRun } from './quote-document';

/**
 * Wire format for a captured quote. This is the kernel's Wikiquote storage
 * model: a blank line separates paragraphs, one newline is a soft break, and
 * the only markup is <b>, <i>, and nested <b><i> for bold italic.
 *
 * The kernel stores this text raw. On render it html-escapes the string, then
 * turns only the escaped emphasis tags (&lt;b&gt; and so on) back into markup.
 * `&`, `<`, and `>` are therefore sent as themselves. Pre-escaping them would
 * show the entity names on the page ("Tom &amp; Jerry").
 *
 * A page whose text literally contains an emphasis tag, such as "<b>", cannot
 * be told apart from markup. The kernel model has no escape for that, so those
 * characters are sent as-is.
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
  const token = /<\/?[bi]>|\n/g;
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
  const text = run.text;
  if (!text) return '';
  // Raw characters, including &, <, and >. See the file comment: a literal
  // "<b>" in the source is indistinguishable from an emphasis tag.
  if (run.bold && run.italic) return `<b><i>${text}</i></b>`;
  if (run.bold) return `<b>${text}</b>`;
  if (run.italic) return `<i>${text}</i>`;
  return text;
}
