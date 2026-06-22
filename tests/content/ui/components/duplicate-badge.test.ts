import { DuplicateBadge, SubmitStateDirective } from '../../../../src/content/ui/components/duplicate-badge';
import type { DuplicateCheckResult } from '../../../../src/types/api';
import {
  conflictDuplicateResult,
  couldntVerifyDuplicateResult,
  duplicateMatch,
  duplicateResult,
  exactDuplicateResult,
  legacyNearMatchDuplicateResult,
} from '../../../helpers/duplicate-fixtures';

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

function makeMatch(
  overrides: Partial<DuplicateCheckResult['matches'][number]> = {}
): DuplicateCheckResult['matches'][number] {
  return {
    quote_id: 'q1',
    version_id: 1,
    text: 'hi',
    similarity: 1,
    match_type: 'exact',
    in_user_collections: false,
    originator: { id: '1', full_name: 'Test', sort_name: null, birth_year: null, death_year: null },
    workflow_status: 'published',
    likes_count: 0,
    ...overrides,
  };
}

describe('DuplicateBadge', () => {
  let container: HTMLElement;
  let directives: SubmitStateDirective[];
  let retry: jest.Mock;
  let resolveConflict: jest.Mock;
  let badge: DuplicateBadge;

  beforeEach(() => {
    container = document.createElement('span');
    directives = [];
    retry = jest.fn();
    resolveConflict = jest.fn();
    badge = new DuplicateBadge(container, {
      onSubmitStateChange: (d) => directives.push(d),
      onRetry: retry,
      onResolveConflict: resolveConflict,
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
        matches: [makeMatch({
          sighting_status: 'exact_url',
          url: 'https://quotewise.io/quotes/q1',
        })],
      }),
    });
    expect(container.textContent).toContain('Already captured');
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe('https://quotewise.io/quotes/q1');
    expect(link.target).toBe('_blank');
    expect(directives).toEqual([
      { type: 'view_quote', url: 'https://quotewise.io/quotes/q1', text: 'View Quote' },
    ]);
  });

  it('shows "Earlier Sighting saved" link for has_platform_sighting', () => {
    badge.update({
      result: makeResult({
        matches: [makeMatch({
          similarity: 0.95,
          match_type: 'fuzzy',
          sighting_status: 'has_platform_sighting',
          url: 'https://quotewise.io/quotes/q1',
        })],
      }),
    });
    expect(container.textContent).toContain('Earlier Sighting saved');
    expect(container.title).toBe('An earlier Sighting for this quote is already in Quotewise. We keep the earliest known source.');
    expect(container.querySelector('a')).toBeTruthy();
    expect(directives).toEqual([
      { type: 'view_quote', url: 'https://quotewise.io/quotes/q1', text: 'View Sighting' },
    ]);
  });

  it('shows "Add Twitter sighting" badge and submit action for no_platform_sighting with short_code', () => {
    badge.update({
      result: makeResult({
        matches: [makeMatch({
          similarity: 0.95,
          match_type: 'fuzzy',
          sighting_status: 'no_platform_sighting',
          short_code: 'abc123',
        })],
      }),
    });
    expect(container.textContent).toContain('Add Twitter sighting');
    expect(container.querySelector('a')).toBeTruthy();
    expect(directives).toEqual([
      { type: 'submit', enabled: true, text: 'Add Sighting' },
    ]);
  });

  it('disables submit for has_platform_sighting without a quote page URL', () => {
    badge.update({
      result: makeResult({
        matches: [makeMatch({
          sighting_status: 'has_platform_sighting',
        })],
      }),
    });
    expect(container.textContent).toContain('Earlier Sighting saved');
    expect(directives).toEqual([
      { type: 'submit', enabled: false, text: 'Earlier Saved' },
    ]);
  });

  it('shows earlier-sighting copy for exact quote matches that are not this URL', () => {
    badge.update({
      result: duplicateResult({
        recommendation: 'duplicate',
        in_quotewise: true,
        matches: [duplicateMatch({
          match_source: 'similarity',
          match_class: 'exact',
          sighting_status: 'has_platform_sighting',
          url: 'https://quotewise.io/quotes/earlier',
        })],
      }),
    });

    expect(container.textContent).toContain('Earlier Sighting saved');
    expect(container.textContent).not.toContain('Already captured');
    expect(container.title).toContain('earliest known source');
    expect(directives).toEqual([
      { type: 'view_quote', url: 'https://quotewise.io/quotes/earlier', text: 'View Sighting' },
    ]);
  });

  it('shows warning badge for duplicate recommendation', () => {
    badge.update({
      result: makeResult({
        recommendation: 'duplicate',
        reasoning: 'Very similar quote found',
        matches: [makeMatch({ url: 'https://quotewise.io/quotes/q1' })],
      }),
    });
    expect(container.textContent).toContain('Duplicate');
    expect(container.title).toBe('Very similar quote found');
    expect(container.className).toContain('warning');
    expect(directives).toEqual([
      { type: 'view_quote', url: 'https://quotewise.io/quotes/q1', text: 'View Quote' },
    ]);
  });

  it('shows info badge for new_version recommendation', () => {
    badge.update({
      result: makeResult({
        recommendation: 'new_version',
        reasoning: 'Similar quote exists',
        matches: [makeMatch({ short_code: 'versioned' })],
      }),
    });
    expect(container.textContent).toContain('New version');
    expect(container.className).toContain('info');
    expect(directives).toEqual([
      { type: 'view_quote', url: 'http://quotewise.test:8000/quotes/versioned', text: 'View Quote' },
    ]);
  });

  it('shows "In Quotewise" badge when in_quotewise is true', () => {
    badge.update({
      result: makeResult({
        in_quotewise: true,
        matches: [makeMatch({ url: 'https://quotewise.io/quotes/q1' })],
      }),
    });
    expect(container.textContent).toContain('In Quotewise');
    expect(container.className).toContain('success');
    expect(directives).toEqual([
      { type: 'view_quote', url: 'https://quotewise.io/quotes/q1', text: 'View Quote' },
    ]);
  });

  it('does not build a quote link from quote_id only', () => {
    badge.update({
      result: makeResult({
        recommendation: 'duplicate',
        matches: [makeMatch({ quote_id: 'quote-only' })],
      }),
    });
    expect(container.textContent).toContain('Duplicate');
    expect(container.querySelector('a')).toBeNull();
    expect(directives).toHaveLength(0);
  });

  it('falls back to disabled submit for exact_url without a quote page URL', () => {
    badge.update({
      result: makeResult({
        matches: [makeMatch({ sighting_status: 'exact_url' })],
      }),
    });
    expect(directives).toEqual([
      { type: 'submit', enabled: false, text: 'Already Captured' },
    ]);
  });

  it('shows nothing and enables submit for new_quote recommendation', () => {
    badge.update({ result: makeResult() });
    // new_quote with in_quotewise=false => no badge rendered
    expect(container.innerHTML).toBe('');
    expect(directives).toEqual([
      { type: 'submit', enabled: true },
    ]);
  });

  it('can restore submit after a previous disabled duplicate state', () => {
    badge.update({ result: couldntVerifyDuplicateResult() });
    badge.update({ result: makeResult() });

    expect(container.innerHTML).toBe('');
    expect(directives).toEqual([
      { type: 'submit', enabled: false, text: "Couldn't Verify" },
      { type: 'submit', enabled: true },
    ]);
  });

  it('renders a couldnt-verify warning with retry and disables submit', () => {
    badge.update({ result: couldntVerifyDuplicateResult() });

    expect(container.textContent).toContain("Couldn't verify duplicates");
    const retryButton = container.querySelector('button') as HTMLButtonElement;
    expect(retryButton).toBeTruthy();
    expect(retryButton.type).toBe('button');
    expect(retryButton.textContent).toBe('Retry');
    expect(retryButton.getAttribute('aria-label')).toBe('Retry duplicate check');
    expect(container.getAttribute('aria-live')).toBe('polite');
    expect(directives).toEqual([
      { type: 'submit', enabled: false, text: "Couldn't Verify" },
    ]);

    retryButton.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders an attribution conflict notice with resolve link and no decision buttons', () => {
    badge.update({ result: conflictDuplicateResult() });

    expect(container.textContent).toContain('Already attributed to Different Author');
    expect(container.textContent).not.toContain('Add another sighting');
    expect(container.textContent).not.toContain('Add as variant');

    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.textContent).toBe('Resolve in Quotewise');
    expect(link.href).toBe('https://quotewise.io/quotes/existing-quote');
    expect(link.getAttribute('aria-label')).toBe('Resolve attribution conflict in Quotewise');
    expect(directives).toEqual([
      { type: 'submit', enabled: false, text: 'Resolve Attribution' },
    ]);

    link.click();
    expect(resolveConflict).toHaveBeenCalledWith('https://quotewise.io/quotes/existing-quote');
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

  it('degrades gracefully for legacy near-match responses without match classification', () => {
    expect(() => badge.update({
      result: legacyNearMatchDuplicateResult({
        matches: [duplicateMatch({
          quote_id: '101',
          text: 'existing words',
          match_source: undefined,
          match_class: undefined,
        })],
      }),
    }, 'captured words')).not.toThrow();

    expect(container.textContent).toContain('Add as variant');
  });

  it('keeps exact URL matches on the single already-captured action', () => {
    badge.update({
      result: exactDuplicateResult({
        matches: [duplicateMatch({
          match_source: 'url',
          match_class: 'exact',
          url: 'https://quotewise.io/quotes/exact',
        })],
      }),
    }, 'captured words');

    expect(container.textContent).toContain('Already captured');
    expect(container.textContent).not.toContain('Add another sighting');
    expect(container.textContent).not.toContain('Add as variant');
    expect(directives).toEqual([
      { type: 'view_quote', url: 'https://quotewise.io/quotes/exact', text: 'View Quote' },
    ]);
  });

  it('does not render javascript hrefs in legacy badges', () => {
    badge.update({
      result: duplicateResult({
        recommendation: 'duplicate',
        matches: [makeMatch({ url: 'javascript:alert(1)' })],
      }),
    });

    expect(container.textContent).toContain('Duplicate');
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('does not render javascript hrefs in conflict badges', () => {
    badge.update({
      result: conflictDuplicateResult({
        matches: [duplicateMatch({
          match_source: 'similarity',
          match_class: 'conflict',
          url: 'javascript:alert(1)',
        })],
      }),
    });

    expect(container.textContent).toContain('Already attributed');
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('does not pass a javascript: match URL to the View Quote button', () => {
    badge.update({
      result: duplicateResult({
        recommendation: 'duplicate',
        matches: [makeMatch({ url: 'javascript:alert(1)' })],
      }),
    });

    // The View Quote button calls window.open(url); a non-http(s) URL must
    // never reach it via the view_quote directive.
    expect(directives.find((d) => d.type === 'view_quote')).toBeUndefined();
  });
});
