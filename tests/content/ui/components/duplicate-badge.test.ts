import { DuplicateBadge, SubmitStateDirective } from '../../../../src/content/ui/components/duplicate-badge';
import type { DuplicateCheckResult } from '../../../../src/types/api';

function makeResult(overrides: Partial<DuplicateCheckResult> = {}): DuplicateCheckResult {
  return {
    recommendation: 'new_quote',
    confidence: 0.9,
    in_quotewise: false,
    matches: [],
    reasoning: '',
    search_metadata: {},
    ...overrides,
  };
}

describe('DuplicateBadge', () => {
  let container: HTMLElement;
  let directives: SubmitStateDirective[];
  let badge: DuplicateBadge;

  beforeEach(() => {
    container = document.createElement('span');
    directives = [];
    badge = new DuplicateBadge(container, {
      onSubmitStateChange: (d) => directives.push(d),
    });
  });

  it('shows nothing for null state', () => {
    badge.update(null);
    expect(container.innerHTML).toBe('');
    expect(directives).toHaveLength(0);
  });

  it('shows spinner when checking', () => {
    badge.update({ checking: true });
    expect(container.querySelector('.spinner')).toBeTruthy();
    expect(container.title).toBe('Checking for duplicates...');
  });

  it('shows "Already captured" link for exact_url with url', () => {
    badge.update({
      result: makeResult({
        matches: [{
          quote_id: 'q1', version_id: 1, text: 'hi', similarity: 1,
          match_type: 'exact', in_user_collections: false,
          originator: { id: '1', full_name: 'Test', sort_name: null, birth_year: null, death_year: null },
          workflow_status: 'published', likes_count: 0,
          sighting_status: 'exact_url',
          url: 'https://quotewise.io/quotes/q1',
        }],
      }),
    });
    expect(container.textContent).toContain('Already captured');
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe('https://quotewise.io/quotes/q1');
    expect(link.target).toBe('_blank');
    expect(directives).toEqual([{ enabled: false, text: 'Already Captured' }]);
  });

  it('shows "Platform sighting exists" link for has_platform_sighting', () => {
    badge.update({
      result: makeResult({
        matches: [{
          quote_id: 'q1', version_id: 1, text: 'hi', similarity: 0.95,
          match_type: 'fuzzy', in_user_collections: false,
          originator: { id: '1', full_name: 'Test', sort_name: null, birth_year: null, death_year: null },
          workflow_status: 'published', likes_count: 0,
          sighting_status: 'has_platform_sighting',
          url: 'https://quotewise.io/quotes/q1',
        }],
      }),
    });
    expect(container.textContent).toContain('Platform sighting exists');
    expect(container.querySelector('a')).toBeTruthy();
    expect(directives).toEqual([{ enabled: true, text: 'Add Another Sighting', style: 'warning' }]);
  });

  it('shows "Add sighting" badge for no_platform_sighting', () => {
    badge.update({
      result: makeResult({
        matches: [{
          quote_id: 'q1', version_id: 1, text: 'hi', similarity: 0.95,
          match_type: 'fuzzy', in_user_collections: false,
          originator: { id: '1', full_name: 'Test', sort_name: null, birth_year: null, death_year: null },
          workflow_status: 'published', likes_count: 0,
          sighting_status: 'no_platform_sighting',
        }],
      }),
    });
    expect(container.textContent).toContain('Add sighting');
    expect(directives).toHaveLength(0);
  });

  it('shows warning badge for duplicate recommendation', () => {
    badge.update({
      result: makeResult({
        recommendation: 'duplicate',
        reasoning: 'Very similar quote found',
      }),
    });
    expect(container.textContent).toContain('Duplicate');
    expect(container.title).toBe('Very similar quote found');
    expect(container.className).toContain('warning');
  });

  it('shows info badge for new_version recommendation', () => {
    badge.update({
      result: makeResult({
        recommendation: 'new_version',
        reasoning: 'Similar quote exists',
      }),
    });
    expect(container.textContent).toContain('New version');
    expect(container.className).toContain('info');
  });

  it('shows "In Quotewise" badge when in_quotewise is true', () => {
    badge.update({
      result: makeResult({ in_quotewise: true }),
    });
    expect(container.textContent).toContain('In Quotewise');
    expect(container.className).toContain('success');
  });

  it('shows nothing for new_quote recommendation', () => {
    badge.update({ result: makeResult() });
    // new_quote with in_quotewise=false => no badge rendered
    expect(container.innerHTML).toBe('');
  });

  it('clears previous content on update', () => {
    badge.update({ checking: true });
    expect(container.querySelector('.spinner')).toBeTruthy();
    badge.update(null);
    expect(container.innerHTML).toBe('');
  });

  it('escapes HTML in badge text', () => {
    badge.update({
      result: makeResult({
        recommendation: 'duplicate',
        reasoning: '<script>alert("xss")</script>',
      }),
    });
    expect(container.innerHTML).not.toContain('<script>');
  });
});
