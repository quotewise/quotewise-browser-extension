import {
  buildSimilarMatchView,
  renderSimilarDiff,
} from '../../src/content/ui/components/similar-diff';
import type { DuplicateCheckResult } from '../../src/types/api';

function result(overrides: Partial<DuplicateCheckResult> = {}): DuplicateCheckResult {
  return {
    recommendation: 'new_version',
    confidence: 0.91,
    in_quotewise: true,
    matches: [{
      quote_id: 'q1',
      version_id: 1,
      text: 'hello old world',
      similarity: 0.91,
      match_type: 'near',
      in_user_collections: false,
      originator: { id: 'o1', full_name: 'Author', sort_name: null, birth_year: null, death_year: null },
      workflow_status: 'published',
      likes_count: 0,
      short_code: 'abc123',
    }],
    reasoning: '',
    search_metadata: {},
    ...overrides,
  };
}

describe('similar-diff', () => {
  it('renders marked word diff and view link without similarity percentage', () => {
    const container = document.createElement('span');
    const view = buildSimilarMatchView(result(), 'hello new world');
    expect(view).not.toBeNull();

    renderSimilarDiff(container, view!);

    expect(container.textContent).toContain('-old ');
    expect(container.textContent).toContain('+new ');
    expect(container.textContent).toContain('View existing quote');
    expect(container.textContent).not.toContain('91');
    expect(container.querySelector('.diff-token.added')).toBeTruthy();
    expect(container.querySelector('.diff-token.removed')).toBeTruthy();
  });

  it('returns no view for exact or no-match recommendations', () => {
    expect(buildSimilarMatchView(result({ recommendation: 'duplicate' }), 'hello')).toBeNull();
    expect(buildSimilarMatchView(result({ recommendation: 'new_quote', matches: [] }), 'hello')).toBeNull();
  });

  it('falls back when on-record text is missing', () => {
    const container = document.createElement('span');
    const view = buildSimilarMatchView(result({
      matches: [{ ...result().matches[0], text: '' }],
    }), 'hello new world');

    renderSimilarDiff(container, view!);

    expect(container.querySelector('.diff-token')).toBeNull();
    expect(container.textContent).toContain('Similar version');
  });
});
