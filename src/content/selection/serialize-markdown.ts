import type { Inline, QuoteDocument, TextRun } from './quote-document';

/**
 * Provisional wire format for a captured quote.
 *
 * The kernel already models formatted quote text for Wikiquote/wikitext imports
 * and is making that the single canonical syntax. This file is the only place
 * that spells a QuoteDocument onto the wire. Replace `serializeQuote` when that
 * syntax is settled; the DOM walk does not need to change.
 *
 * For now, paragraphs are separated by a blank line, a soft break is one
 * newline, and emphasis is Markdown: **bold**, *italic*, ***bold italic***.
 * Literal asterisks and backslashes in the source text are escaped so they are
 * not read as emphasis. Nothing else is markup.
 */
export function serializeQuote(document: QuoteDocument): string {
  return document.paragraphs
    .map(paragraph => serializeInlines(paragraph.inlines))
    .filter(paragraph => paragraph.length > 0)
    .join('\n\n');
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
  const escaped = escapeLiteralMarkup(run.text);
  if (!escaped) return '';
  if (run.bold && run.italic) return `***${escaped}***`;
  if (run.bold) return `**${escaped}**`;
  if (run.italic) return `*${escaped}*`;
  return escaped;
}

function escapeLiteralMarkup(text: string): string {
  return text.replace(/[\\*]/g, character => `\\${character}`);
}
