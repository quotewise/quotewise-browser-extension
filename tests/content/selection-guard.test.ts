import fs from 'node:fs';
import path from 'node:path';
import { QuotePreview } from '../../src/content/ui/components/quote-preview';

function loadFixture(name: string): void {
  document.body.innerHTML = fs.readFileSync(
    path.join(process.cwd(), 'tests', 'fixtures', name),
    'utf8',
  );
}

function selectFrom(id: string, text: string): void {
  const anchor = document.getElementById(id) as HTMLElement;
  jest.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    toString: () => text,
    anchorNode: anchor.firstChild,
  } as unknown as Selection);
}

describe.each([
  {
    name: 'ordinary post',
    fixture: 'x-ordinary-post.html',
    extractedText: 'A captured passage lives in the focal post.',
    selectedText: 'A captured passage',
    focal: 'ordinary-focal-content',
    outside: ['ordinary-nav', 'ordinary-other-content'],
  },
  {
    name: 'X Article',
    fixture: 'x-article.html',
    extractedText: 'Click to Subscribe to Kpaxs',
    selectedText: 'An article passage',
    focal: 'article-focal-content',
    outside: ['article-nav', 'article-other-content'],
  },
])('$name selection guard', ({ fixture, extractedText, selectedText, focal, outside }) => {
  beforeEach(() => loadFixture(fixture));
  afterEach(() => jest.restoreAllMocks());

  it('accepts a selection anchored in the focal post content', () => {
    selectFrom(focal, selectedText);
    expect(QuotePreview.getPageSelection(extractedText)).toBe(selectedText);
  });

  it.each(outside)('rejects a selection anchored at %s', (outsideId) => {
    selectFrom(outsideId, selectedText);
    expect(QuotePreview.getPageSelection(extractedText)).toBeNull();
  });
});
