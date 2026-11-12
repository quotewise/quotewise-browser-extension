import fs from 'node:fs';
import path from 'node:path';
import { quoteDocumentFromSelection } from '../../../src/content/selection/dom-walk';
import type { QuoteDocument } from '../../../src/content/selection/quote-document';
import { serializeQuote } from '../../../src/content/selection/serialize-quote';
import { QuotePreview } from '../../../src/content/ui/components/quote-preview';
import { selectBetween, selectContents, textNodesWithin } from '../../helpers/select-text';

function loadFixture(name: string): void {
  document.body.innerHTML = fs.readFileSync(
    path.join(process.cwd(), 'tests', 'fixtures', name),
    'utf8',
  );
}

function formattedSelection(): string {
  const selection = window.getSelection();
  if (!selection) throw new Error('window.getSelection() returned null');
  return serializeQuote(quoteDocumentFromSelection(selection));
}

function run(kind: 'text', text: string, bold = false, italic = false) {
  return { kind, text, bold, italic };
}

describe('formatted selection capture', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('keeps an X Article selection as paragraphs with rendered bold and italic', () => {
    loadFixture('x-article-formatted.html');
    const body = document.getElementById('article-body') as HTMLElement;
    selectContents(body);

    const documentQuote = quoteDocumentFromSelection(window.getSelection() as Selection);
    expect(documentQuote).toEqual({
      paragraphs: [
        { inlines: [run('text', 'First paragraph of the article.')] },
        {
          inlines: [
            run('text', 'Second with '),
            run('text', 'bold words', true, false),
            run('text', ' inside.'),
          ],
        },
        {
          inlines: [
            run('text', 'Third with '),
            run('text', 'italic words', false, true),
            run('text', ' here.'),
          ],
        },
      ],
    });

    const formatted = [
      'First paragraph of the article.',
      '',
      'Second with <b>bold words</b> inside.',
      '',
      'Third with <i>italic words</i> here.',
    ].join('\n');
    expect(serializeQuote(documentQuote)).toBe(formatted);
    expect(QuotePreview.getPageSelection('Click to Subscribe to Kpaxs')).toBe(formatted);
  });

  it('keeps a normal X post selection as soft line breaks, not paragraphs', () => {
    loadFixture('x-post-line-breaks.html');
    const post = document.getElementById('post-body') as HTMLElement;
    selectContents(post);

    const formatted = 'First line with <b>bold</b> text\nSecond line of the post';
    expect(formattedSelection()).toBe(formatted);

    const postText = post.textContent ?? '';
    expect(QuotePreview.getPageSelection(postText)).toBe(formatted);
  });

  it('keeps a plain web page selection: blocks, a soft break, and tag emphasis', () => {
    loadFixture('plain-page-formatted.html');
    selectContents(document.getElementById('page') as HTMLElement);

    // h1 is bold in the rendered style, so the heading run is emphasis.
    expect(formattedSelection()).toBe([
      '<b>A heading</b>',
      '',
      'A paragraph with <b>bold</b> and <i>italic</i> and a literal * asterisk.',
      '',
      'A div block',
      'with a soft break and <b><i>bold italic</i></b>.',
      '',
      'First item',
      '',
      'Second item',
    ].join('\n'));
  });

  it('records a partial selection that starts and ends mid-paragraph', () => {
    loadFixture('x-article-formatted.html');
    const body = document.getElementById('article-body') as HTMLElement;
    const nodes = textNodesWithin(body).filter(node => node.data.trim().length > 0);
    const first = nodes[0];
    const italic = nodes.find(node => node.data === 'italic words');
    if (!italic) throw new Error('italic run not found');
    const start = first.data.indexOf('paragraph');
    selectBetween(first, start, italic, italic.data.length);

    expect(formattedSelection()).toBe([
      'paragraph of the article.',
      '',
      'Second with <b>bold words</b> inside.',
      '',
      'Third with <i>italic words</i>',
    ].join('\n'));
  });

  it('collapses whitespace and keeps consecutive breaks inside one paragraph', () => {
    document.body.innerHTML = '<p>Hello   <strong>  bold  </strong>\nworld<br><br>next</p>';
    selectContents(document.querySelector('p') as HTMLElement);

    const quote = quoteDocumentFromSelection(window.getSelection() as Selection);
    expect(quote).toEqual({
      paragraphs: [{
        inlines: [
          run('text', 'Hello '),
          run('text', 'bold', true, false),
          run('text', ' world'),
          { kind: 'soft-break' },
          { kind: 'soft-break' },
          run('text', 'next'),
        ],
      }],
    } satisfies { paragraphs: QuoteDocument['paragraphs'] });
    expect(serializeQuote(quote)).toBe('Hello <b>bold</b> world\n\nnext');
  });

  it('sends Tom & Jerry <3 as raw text, and leaves asterisks literal', () => {
    document.body.innerHTML = '<p id="line">Tom &amp; Jerry &lt;3</p>';
    selectContents(document.getElementById('line') as HTMLElement);
    expect(formattedSelection()).toBe('Tom & Jerry <3');

    const quote: QuoteDocument = {
      paragraphs: [{
        inlines: [
          run('text', 'Tom & Jerry <3 * ** \\'),
          { kind: 'soft-break' },
          run('text', 'both', true, true),
        ],
      }],
    };

    expect(serializeQuote(quote)).toBe('Tom & Jerry <3 * ** \\\n<b><i>both</i></b>');
  });

  it('does not split a paragraph on a div that renders inline', () => {
    document.body.innerHTML = `
      <style>.inl { display: inline; }</style>
      <div id="root">Hello <div class="inl">there</div> friend</div>
    `;
    selectContents(document.getElementById('root') as HTMLElement);

    expect(formattedSelection()).toBe('Hello there friend');
  });

  it('treats a span with computed bold-italic as one run, and a normal span as plain', () => {
    document.body.innerHTML = `
      <style>
        .both { font-weight: 700; font-style: italic; }
        .plain { font-weight: 400; font-style: normal; }
      </style>
      <p id="styled"><span class="both">styled</span> <span class="plain">plain</span></p>
    `;
    selectContents(document.getElementById('styled') as HTMLElement);

    expect(formattedSelection()).toBe('<b><i>styled</i></b> plain');
  });
});
