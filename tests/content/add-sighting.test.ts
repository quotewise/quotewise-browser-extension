import { buildSimilarMatchView, renderSimilarDiff } from '../../src/content/ui/components/similar-diff';
import type { DuplicateCheckResult } from '../../src/types/api';

function result(matchOverrides: Partial<DuplicateCheckResult['matches'][number]> = {}): DuplicateCheckResult {
  return {
    recommendation: 'new_version',
    confidence: 0.9,
    in_quotewise: true,
    matches: [{
      quote_id: '1',
      version_id: 1,
      text: 'hello world',
      similarity: 0.9,
      match_type: 'near',
      in_user_collections: false,
      originator: { id: 'o1', full_name: 'Author', sort_name: null, birth_year: null, death_year: null },
      workflow_status: 'published',
      likes_count: 0,
      ...matchOverrides,
    }],
    reasoning: '',
    search_metadata: {},
  };
}

describe('add earlier sighting date gate', () => {
  it('is unavailable when quote_date is absent and ignores record-created timestamps', () => {
    const view = buildSimilarMatchView(
      result({ created_at: '2026-01-01T00:00:00Z' } as any),
      'hello world',
      '2025-01-01T00:00:00Z',
    );

    expect(view?.sightingAvailable).toBe(false);
  });

  it('is eligible only when the tweet is strictly older than quote_date', () => {
    const older = buildSimilarMatchView(
      result({ quote_date: '2026-01-01T00:00:00Z' }),
      'hello world',
      '2025-01-01T00:00:00Z',
    );
    const newer = buildSimilarMatchView(
      result({ quote_date: '2026-01-01T00:00:00Z' }),
      'hello world',
      '2026-01-01T00:00:00Z',
    );

    expect(older?.sightingAvailable).toBe(true);
    expect(older?.sightingHint).toBe('This tweet is older than our records');
    expect(newer?.sightingAvailable).toBe(false);
  });

  it('renders the honest sighting and variant labels', () => {
    const container = document.createElement('span');
    const view = buildSimilarMatchView(
      result({ quote_date: '2026-01-01T00:00:00Z' }),
      'hello new world',
      '2025-01-01T00:00:00Z',
    );

    renderSimilarDiff(container, view!, { onResolve: jest.fn() });

    expect(container.textContent).toContain('Add another sighting');
    expect(container.textContent).toContain('Add as variant');
  });
});
