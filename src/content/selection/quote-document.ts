/**
 * Captured quote text, independent of the wire syntax.
 *
 * A paragraph is a block boundary (p, div, li, heading, and the other block
 * containers). A soft break is a <br> inside a paragraph. Runs carry rendered
 * emphasis flags. The serializer, not this structure, decides how that is spelled
 * on the wire.
 */

export interface TextRun {
  kind: 'text';
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface SoftBreak {
  kind: 'soft-break';
}

export type Inline = TextRun | SoftBreak;

export interface Paragraph {
  inlines: Inline[];
}

export interface QuoteDocument {
  paragraphs: Paragraph[];
}

/** Plain text of a document, with paragraph and soft breaks kept as newlines. */
export function quotePlainText(document: QuoteDocument): string {
  return document.paragraphs.map(paragraphText).join('\n\n');
}

function paragraphText(paragraph: Paragraph): string {
  let text = '';
  for (const inline of paragraph.inlines) {
    switch (inline.kind) {
      case 'text':
        text += inline.text;
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
