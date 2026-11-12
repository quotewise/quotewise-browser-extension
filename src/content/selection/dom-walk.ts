import type { Inline, Paragraph, QuoteDocument, TextRun } from './quote-document';

/**
 * Read a selection by walking its DOM range.
 *
 * Selection.toString() (and innerText / textContent) flatten the range: block
 * boundaries become a single newline or disappear, and bold/italic is dropped.
 * This walk records the structure instead. Emphasis comes from rendered style:
 * strong/b/em/i, and computed font-weight / font-style, which is how X marks
 * bold and italic on spans.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'HEAD']);

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

const BOLD_TAGS = new Set(['STRONG', 'B']);
const ITALIC_TAGS = new Set(['EM', 'I']);

interface WalkState {
  range: Range;
  paragraphs: Paragraph[];
  current: Inline[];
}

export function quoteDocumentFromSelection(selection: Selection): QuoteDocument {
  const paragraphs: Paragraph[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    paragraphs.push(...paragraphsFromRange(selection.getRangeAt(index)));
  }
  return { paragraphs };
}

function paragraphsFromRange(range: Range): Paragraph[] {
  const state: WalkState = { range, paragraphs: [], current: [] };
  visit(state, range.commonAncestorContainer);
  flush(state);
  return state.paragraphs;
}

function visit(state: WalkState, node: Node): void {
  if (!state.range.intersectsNode(node)) return;

  if (node.nodeType === Node.TEXT_NODE) {
    appendText(state, node as Text);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  if (SKIP_TAGS.has(element.tagName) || isHidden(element)) return;

  if (element.tagName === 'BR') {
    state.current.push({ kind: 'soft-break' });
    return;
  }

  const block = isBlockElement(element);
  if (block) flush(state);

  for (const child of element.childNodes) {
    visit(state, child);
  }

  if (block) flush(state);
}

function appendText(state: WalkState, node: Text): void {
  const text = textInRange(node, state.range);
  if (!text) return;
  const emphasis = emphasisFor(node);
  state.current.push({ kind: 'text', text, bold: emphasis.bold, italic: emphasis.italic });
}

function textInRange(node: Text, range: Range): string {
  const value = node.data;
  let start = 0;
  let end = value.length;
  if (node === range.startContainer) start = range.startOffset;
  if (node === range.endContainer) end = range.endOffset;
  if (end < start) return '';
  return value.slice(start, end);
}

function flush(state: WalkState): void {
  const inlines = collapseInlines(state.current);
  state.current = [];
  if (inlines.length === 0) return;
  state.paragraphs.push({ inlines });
}

/**
 * HTML whitespace collapses inside a paragraph. Spaces that sit between
 * different emphasis runs stay outside the runs, so a later serializer can wrap
 * markers without swallowing the space. Soft breaks are preserved.
 */
function collapseInlines(inlines: Inline[]): Inline[] {
  const segments: TextRun[][] = [[]];
  for (const inline of inlines) {
    if (inline.kind === 'soft-break') {
      segments.push([]);
      continue;
    }
    segments[segments.length - 1].push(inline);
  }

  const collapsed = segments.map(collapseSegment);
  while (collapsed.length > 0 && collapsed[0].length === 0) collapsed.shift();
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].length === 0) collapsed.pop();

  const result: Inline[] = [];
  collapsed.forEach((segment, index) => {
    if (index > 0) result.push({ kind: 'soft-break' });
    result.push(...segment);
  });
  return result;
}

interface MarkedChar {
  ch: string;
  bold: boolean;
  italic: boolean;
  space: boolean;
}

function collapseSegment(runs: TextRun[]): TextRun[] {
  const chars: MarkedChar[] = [];
  for (const run of runs) {
    for (const ch of run.text) {
      const space = /\s/u.test(ch);
      chars.push({
        ch: space ? ' ' : ch,
        bold: run.bold,
        italic: run.italic,
        space,
      });
    }
  }

  const collapsed: MarkedChar[] = [];
  for (const item of chars) {
    if (item.space) {
      if (collapsed.length === 0 || collapsed[collapsed.length - 1].space) continue;
      collapsed.push(item);
      continue;
    }
    collapsed.push(item);
  }
  if (collapsed.length > 0 && collapsed[collapsed.length - 1].space) collapsed.pop();

  for (let index = 0; index < collapsed.length; index += 1) {
    const item = collapsed[index];
    if (!item.space) continue;
    const previous = collapsed[index - 1];
    const next = collapsed[index + 1];
    if (previous && next && previous.bold === next.bold && previous.italic === next.italic) {
      item.bold = previous.bold;
      item.italic = previous.italic;
    } else {
      item.bold = false;
      item.italic = false;
    }
  }

  const grouped: TextRun[] = [];
  for (const item of collapsed) {
    const last = grouped[grouped.length - 1];
    if (last && last.bold === item.bold && last.italic === item.italic) {
      last.text += item.ch;
      continue;
    }
    grouped.push({ kind: 'text', text: item.ch, bold: item.bold, italic: item.italic });
  }
  return grouped;
}

function emphasisFor(node: Text): { bold: boolean; italic: boolean } {
  const element = node.parentElement;
  let bold = element ? isBoldWeight(computedFontWeight(element)) : false;
  let italic = element ? isItalicStyle(computedFontStyle(element)) : false;

  let current = element;
  while (current && (!bold || !italic)) {
    if (BOLD_TAGS.has(current.tagName)) bold = true;
    if (ITALIC_TAGS.has(current.tagName)) italic = true;
    current = current.parentElement;
  }

  return { bold, italic };
}

function isBoldWeight(weight: string): boolean {
  const value = weight.trim().toLowerCase();
  if (value === 'bold' || value === 'bolder') return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 600;
}

function isItalicStyle(style: string): boolean {
  const value = style.trim().toLowerCase();
  return value === 'italic' || value === 'oblique';
}

function computedFontWeight(element: Element): string {
  try {
    return getComputedStyle(element).fontWeight || '';
  } catch {
    return '';
  }
}

function computedFontStyle(element: Element): string {
  try {
    return getComputedStyle(element).fontStyle || '';
  } catch {
    return '';
  }
}

function isBlockElement(element: Element): boolean {
  // A div (or other block tag) that actually renders inline is not a paragraph
  // boundary. X and ordinary pages both do this with classes, so use computed
  // display rather than the tag alone.
  const display = computedDisplay(element);
  if (display === 'inline' || display === 'inline-block' || display === 'contents') {
    return false;
  }
  if (BLOCK_TAGS.has(element.tagName)) return true;

  return display === 'block'
    || display === 'flex'
    || display === 'grid'
    || display === 'list-item'
    || display === 'flow-root';
}

function computedDisplay(element: Element): string {
  try {
    return getComputedStyle(element).display.trim().toLowerCase();
  } catch {
    return '';
  }
}

function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (element instanceof HTMLElement && element.style.display.trim().toLowerCase() === 'none') return true;
  return computedDisplay(element) === 'none';
}
