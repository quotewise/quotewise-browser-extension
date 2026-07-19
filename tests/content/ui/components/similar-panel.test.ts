import { SimilarPanel } from '../../../../src/content/ui/components/similar-panel';
import type { DuplicateCheckResult } from '../../../../src/types/api';
import { duplicateMatch, duplicateResult } from '../../../helpers/duplicate-fixtures';

function crossOriginator(
  overrides: Partial<DuplicateCheckResult['matches'][number]> = {},
) {
  return duplicateMatch({
    quote_id: 'cross',
    match_class: 'conflict',
    match_type: 'near_different_originator',
    different_originator: true,
    short_code: 'cross-quote',
    url: 'https://quotewise.io/quotes/cross-quote',
    originator: {
      id: 'originator-2',
      full_name: 'Different Author',
      sort_name: null,
      birth_year: null,
      death_year: null,
    },
    ...overrides,
  });
}

const primarySameOriginator = duplicateMatch({ quote_id: 'same', primary: true });

describe('SimilarPanel', () => {
  let container: HTMLElement;
  let panel: SimilarPanel;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    panel = new SimilarPanel(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('stays hidden with no result, no matches, or only same-originator matches', () => {
    panel.update(null);
    expect(container.hidden).toBe(true);

    panel.update(duplicateResult());
    expect(container.hidden).toBe(true);

    panel.update(duplicateResult({ matches: [primarySameOriginator] }));
    expect(container.hidden).toBe(true);
  });

  it('omits the primary match — the duplicate badge already shows it', () => {
    // A lone cross-originator match IS the primary, so the badge renders it as
    // the headline conflict. Repeating it here would say the same thing twice.
    panel.update(duplicateResult({ matches: [crossOriginator()] }));

    expect(container.hidden).toBe(true);
  });

  it('lists cross-originator matches sitting behind a same-originator primary', () => {
    panel.update(duplicateResult({
      matches: [primarySameOriginator, crossOriginator()],
    }));

    expect(container.hidden).toBe(false);
    expect(container.textContent).toContain('Might be a duplicate of a quote by another originator');
    expect(container.textContent).toContain('Different Author');
    expect(container.querySelector('a')?.getAttribute('href'))
      .toBe('https://quotewise.io/quotes/cross-quote');
  });

  it('keeps merely-similar matches collapsed and exact ones expanded', () => {
    panel.update(duplicateResult({
      matches: [primarySameOriginator, crossOriginator()],
    }));
    expect(container.querySelector('details')?.open).toBe(false);

    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        crossOriginator({ match_type: 'exact_different_originator' }),
      ],
    }));
    const details = container.querySelector('details');
    expect(details?.open).toBe(true);
    expect(container.textContent).toContain('This exact quote is already attributed to Different Author');
  });

  it('leads with the exact match when similar ones are also present', () => {
    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        crossOriginator({ quote_id: 'near', text: 'A merely similar quote' }),
        crossOriginator({
          quote_id: 'exact',
          text: 'The verbatim quote',
          match_type: 'exact_different_originator',
        }),
      ],
    }));

    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('The verbatim quote');
  });

  it('collapses one variant group into a single row', () => {
    // The unfiltered sweep returns up to 20 neighbours, so several members of one
    // variant group arrive together. Flat, they read as separate duplicates.
    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        crossOriginator({ quote_id: 'canon', text: 'The canonical wording' }),
        crossOriginator({ quote_id: 'v1', text: 'A variant wording', canonical_quote_id: 'canon' }),
        crossOriginator({ quote_id: 'v2', text: 'Another variant', canonical_quote_id: 'canon' }),
      ],
    }));

    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('The canonical wording');
    expect(rows[0].textContent).toContain('+2 known variants');
    expect(container.textContent).toContain('Might be a duplicate of a quote by another originator');
  });

  it('fronts the group with the canonical, not merely the closest member', () => {
    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        crossOriginator({ quote_id: 'v1', text: 'A variant wording', canonical_quote_id: 'canon' }),
        crossOriginator({ quote_id: 'canon', text: 'The canonical wording' }),
      ],
    }));

    expect(container.querySelector('li')?.textContent).toContain('The canonical wording');
  });

  it('marks a lone non-canonical member as a known variant', () => {
    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        crossOriginator({ quote_id: 'v1', canonical_quote_id: 'canon-not-returned' }),
      ],
    }));

    expect(container.querySelector('li')?.textContent).toContain('known variant');
  });

  it('never treats has_relations or quote_role as evidence', () => {
    // Both drift from the relation graph in production, so they must not group,
    // label, or suppress anything. Two unrelated quotes stay two rows.
    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        crossOriginator({ quote_id: 'a', has_relations: true, quote_role: 'variant' }),
        crossOriginator({ quote_id: 'b', has_relations: false, quote_role: 'canonical' }),
      ],
    }));

    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(container.textContent).not.toContain('known variant');
  });

  it('keeps the blocking exact match leading its own group', () => {
    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        crossOriginator({ quote_id: 'other', text: 'An unrelated near match' }),
        crossOriginator({
          quote_id: 'exact',
          text: 'The verbatim quote',
          match_type: 'exact_different_originator',
          canonical_quote_id: 'canon',
        }),
        crossOriginator({ quote_id: 'canon', text: 'Its canonical sibling' }),
      ],
    }));

    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    // The exact match is why the panel is expanded — it must not be demoted
    // behind its own canonical.
    expect(rows[0].textContent).toContain('The verbatim quote');
    expect(rows[0].textContent).toContain('+1 known variant');
  });

  it('caps the list and reports the remainder', () => {
    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        ...Array.from({ length: 7 }, (_, index) => crossOriginator({ quote_id: `cross-${index}` })),
      ],
    }));

    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(container.textContent).toContain('+2 more');
  });

  it('renders unlinked matches as plain text rather than a dead link', () => {
    panel.update(duplicateResult({
      matches: [
        primarySameOriginator,
        crossOriginator({ url: undefined, short_code: undefined }),
      ],
    }));

    expect(container.hidden).toBe(false);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Existing quote text');
  });

  it('reads as advisory rather than blocking after a submit', () => {
    panel.showPostSubmit([crossOriginator({ match_type: 'exact_different_originator' })]);

    expect(container.hidden).toBe(false);
    expect(container.className).toContain('info');
    expect(container.textContent).toContain('Similar quotes are also on record');
    expect(container.textContent).not.toContain('⛔');
  });

  it('clears prior content on every update', () => {
    panel.update(duplicateResult({ matches: [primarySameOriginator, crossOriginator()] }));
    expect(container.querySelectorAll('li')).toHaveLength(1);

    panel.update(duplicateResult());
    expect(container.hidden).toBe(true);
    expect(container.innerHTML).toBe('');
  });
});
