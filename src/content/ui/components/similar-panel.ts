import type { DuplicateCheckResult, QuoteMatch } from '../../../types/api';
import {
  blockingExactConflict,
  secondaryConflicts,
  EXACT_CONFLICT_MATCH_TYPE,
} from '../../../utils/duplicate-status';
import { quotePageUrl } from './dom-utils';

/** Rows beyond this collapse into a "+N more" line rather than growing the tray. */
const MAX_ROWS = 5;

const SNIPPET_LENGTH = 100;

/**
 * "This might already be someone else's quote" — the cross-originator matches
 * the pgvector sweep now surfaces on every check (ADR-0009).
 *
 * Sits between the quote row and the collection rows, and renders only matches
 * the duplicate badge is NOT already showing as the headline state.
 *
 * Certainty is carried by the disclosure state rather than by hedging copy: a
 * proven byte-identical match under another originator opens expanded and reads
 * as a statement of fact, while merely-similar matches stay collapsed and read
 * as a maybe.
 */
export class SimilarPanel {
  constructor(private container: HTMLElement) {}

  update(result: DuplicateCheckResult | null): void {
    this.clear();
    if (!result) return;

    const conflicts = secondaryConflicts(result);
    if (conflicts.length === 0) return;

    const blocking = conflicts.find(match => match.match_type === EXACT_CONFLICT_MATCH_TYPE);
    this.render(conflicts, blocking);
  }

  /**
   * Post-submit variant (ADR-0009 §5): the quote was created regardless, so this
   * reports what else is on record instead of warning about it. Advisory — it
   * must never read as a failure.
   */
  showPostSubmit(conflicts: QuoteMatch[]): void {
    this.clear();
    if (conflicts.length === 0) return;

    this.renderPanel(conflicts, 'Similar quotes are also on record:', true, 'info');
  }

  clear(): void {
    this.container.innerHTML = '';
    this.container.hidden = true;
    this.container.className = 'similar-panel';
  }

  private render(conflicts: QuoteMatch[], blocking?: QuoteMatch): void {
    if (blocking) {
      const name = originatorName(blocking);
      this.renderPanel(
        [blocking, ...conflicts.filter(match => match !== blocking)],
        `This exact quote is already attributed to ${name}`,
        true,
        'warning',
      );
      return;
    }

    this.renderPanel(
      conflicts,
      conflicts.length === 1
        ? 'Might be a duplicate of a quote by another originator'
        : `Might be a duplicate of ${conflicts.length} quotes by other originators`,
      false,
      'info',
    );
  }

  private renderPanel(
    conflicts: QuoteMatch[],
    summaryText: string,
    open: boolean,
    tone: 'warning' | 'info',
  ): void {
    this.container.hidden = false;
    this.container.className = `similar-panel ${tone}`;

    const details = document.createElement('details');
    details.className = 'similar-panel-details';
    if (open) details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'similar-panel-summary';
    summary.textContent = `${tone === 'warning' ? '⛔' : 'ℹ️'} ${summaryText}`;
    details.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'similar-panel-list';
    conflicts.slice(0, MAX_ROWS).forEach(match => list.appendChild(row(match)));
    details.appendChild(list);

    if (conflicts.length > MAX_ROWS) {
      const more = document.createElement('div');
      more.className = 'similar-panel-more';
      more.textContent = `+${conflicts.length - MAX_ROWS} more`;
      details.appendChild(more);
    }

    this.container.appendChild(details);
  }
}

function row(match: QuoteMatch): HTMLLIElement {
  const item = document.createElement('li');
  const url = quotePageUrl(match);
  const snippet = quoteSnippet(match.text);

  // The quote page is where an attribution gets resolved, so the snippet itself
  // is the affordance — a separate "Resolve" link would point at the same URL.
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = snippet;
    link.setAttribute('aria-label', `View ${snippet} in Quotewise (opens in a new tab)`);
    item.appendChild(link);
  } else {
    const text = document.createElement('span');
    text.textContent = snippet;
    item.appendChild(text);
  }

  const attribution = document.createElement('span');
  attribution.className = 'similar-panel-attribution';
  attribution.textContent = ` — ${originatorName(match)}`;
  item.appendChild(attribution);

  return item;
}

function quoteSnippet(text: string | undefined): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'Untitled quote';
  return trimmed.length > SNIPPET_LENGTH ? `“${trimmed.slice(0, SNIPPET_LENGTH)}…”` : `“${trimmed}”`;
}

function originatorName(match: QuoteMatch): string {
  return match.originator?.full_name?.trim() || 'another originator';
}
