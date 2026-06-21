import {
  buildSimilarMatchView,
  renderSimilarDiff,
} from '../../src/content/ui/components/similar-diff';
import {
  duplicateMatch,
  duplicateResult,
  similarDuplicateResult,
} from '../helpers/duplicate-fixtures';

describe('similar-diff', () => {
  it('builds a similar view with variant always available and sighting date-gated', () => {
    const olderTweet = buildSimilarMatchView(similarDuplicateResult({
      matches: [duplicateMatch({
        quote_id: '42',
        text: 'hello old world',
        quote_date: '2026-01-01T00:00:00Z',
      })],
    }), 'hello new world', '2025-01-01T00:00:00Z');
    const newerTweet = buildSimilarMatchView(similarDuplicateResult({
      matches: [duplicateMatch({
        quote_id: '42',
        text: 'hello old world',
        quote_date: '2026-01-01T00:00:00Z',
      })],
    }), 'hello new world', '2026-01-01T00:00:00Z');

    expect(olderTweet?.quoteId).toBe(42);
    expect(olderTweet?.variantAvailable).toBe(true);
    expect(olderTweet?.sightingAvailable).toBe(true);
    expect(olderTweet?.sightingHint).toBe('This tweet is older than our records');
    expect(newerTweet?.variantAvailable).toBe(true);
    expect(newerTweet?.sightingAvailable).toBe(false);
  });

  it('coerces quote_id to an integer and uses null for invalid IDs', () => {
    expect(buildSimilarMatchView(similarDuplicateResult({
      matches: [duplicateMatch({ quote_id: '987' })],
    }), 'captured')?.quoteId).toBe(987);

    expect(buildSimilarMatchView(similarDuplicateResult({
      matches: [duplicateMatch({ quote_id: 'not-a-number' })],
    }), 'captured')?.quoteId).toBeNull();
  });

  it('renders marked word diff, decision buttons, and view link without similarity percentage', () => {
    const container = document.createElement('span');
    const onResolve = jest.fn();
    const view = buildSimilarMatchView(similarDuplicateResult({
      matches: [duplicateMatch({
        quote_id: '42',
        text: 'hello old world',
        quote_date: '2026-01-01T00:00:00Z',
      })],
    }), 'hello new world', '2025-01-01T00:00:00Z');
    expect(view).not.toBeNull();

    renderSimilarDiff(container, view!, { onResolve });

    expect(container.textContent).toContain('-old ');
    expect(container.textContent).toContain('+new ');
    expect(container.textContent).toContain('View existing quote');
    expect(container.textContent).toContain('Add another sighting');
    expect(container.textContent).toContain('Add as variant');
    expect(container.textContent).not.toContain('91');
    expect(container.querySelector('.diff-token.added')).toBeTruthy();
    expect(container.querySelector('.diff-token.removed')).toBeTruthy();

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map(button => button.type)).toEqual(['button', 'button']);

    buttons.find(button => button.textContent === 'Add another sighting')?.click();
    buttons.find(button => button.textContent === 'Add as variant')?.click();
    expect(onResolve).toHaveBeenCalledWith({ quoteId: 42, intent: 'sighting' });
    expect(onResolve).toHaveBeenCalledWith({ quoteId: 42, intent: 'variant' });
  });

  it('returns no view for exact or no-match recommendations', () => {
    expect(buildSimilarMatchView(duplicateResult({ recommendation: 'duplicate' }), 'hello')).toBeNull();
    expect(buildSimilarMatchView(duplicateResult({ recommendation: 'new_quote', matches: [] }), 'hello')).toBeNull();
  });

  it('falls back to a link-only view when on-record text is missing', () => {
    const container = document.createElement('span');
    const view = buildSimilarMatchView(similarDuplicateResult({
      matches: [duplicateMatch({ text: '' })],
    }), 'hello new world');

    renderSimilarDiff(container, view!, { onResolve: jest.fn() });

    expect(container.querySelector('.diff-token')).toBeNull();
    expect(container.textContent).toContain('View existing quote');
    expect(container.textContent).toContain('Add as variant');
  });

  it('rejects non-https existing quote URLs', () => {
    const container = document.createElement('span');
    const view = buildSimilarMatchView(similarDuplicateResult({
      matches: [duplicateMatch({
        url: 'javascript:alert(1)',
        short_code: undefined,
      })],
    }), 'hello new world');

    renderSimilarDiff(container, view!, { onResolve: jest.fn() });

    expect(view?.existingQuoteUrl).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});
