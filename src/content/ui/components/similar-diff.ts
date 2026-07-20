import type { DuplicateCheckResult } from '../../../types/api';
import { classifyMatchResolution, primaryMatch } from '../../../utils/duplicate-status';
import { diffWords, type WordDiffToken } from '../../../utils/word-diff';
import { quotePageUrl } from './dom-utils';

export interface SimilarMatchView {
  quoteId: number | null;
  existingQuoteText: string | null;
  diff: WordDiffToken[] | null;
  existingQuoteUrl: string | null;
  /**
   * Who the matched quote is attributed to. The diff shows *what* differs; this
   * says *whose* it is, which is the question the diff cannot answer — most
   * sharply when the post's author is not the originator at all.
   */
  existingQuoteOriginator: string | null;
  sightingAvailable: boolean;
  sightingHint: string | null;
  variantAvailable: boolean;
}

export interface ResolutionDecision {
  quoteId: number;
  intent: 'sighting' | 'variant';
}

export function isNearMatchRecommendation(recommendation: string): boolean {
  return recommendation === 'new_version' || recommendation === 'new_version_known_author';
}

export function buildSimilarMatchView(
  result: DuplicateCheckResult,
  capturedText: string,
  postDate?: string | null,
): SimilarMatchView | null {
  if (classifyMatchResolution(result, capturedText) !== 'similar') {
    return null;
  }

  const match = primaryMatch(result.matches);
  const quoteId = coerceQuoteId(match?.quote_id);
  if (!match) {
    return {
      quoteId,
      existingQuoteText: null,
      diff: null,
      existingQuoteUrl: null,
      existingQuoteOriginator: null,
      sightingAvailable: false,
      sightingHint: null,
      variantAvailable: false,
    };
  }

  const existingQuoteText = match.text?.trim() ? match.text : null;
  const sightingState = addSightingState(postDate, match.quote_date);

  return {
    quoteId,
    existingQuoteText,
    diff: existingQuoteText ? diffWords(match.text, capturedText) : null,
    existingQuoteUrl: quotePageUrl(match),
    existingQuoteOriginator: match.originator?.full_name?.trim() || null,
    sightingAvailable: quoteId !== null && sightingState.eligible,
    sightingHint: sightingState.hint,
    variantAvailable: quoteId !== null,
  };
}

export function renderSimilarDiff(
  container: HTMLElement,
  view: SimilarMatchView,
  handlers: { onResolve: (decision: ResolutionDecision) => void },
): void {
  container.innerHTML = '';
  container.className = 'similar-diff';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Similar quote comparison');

  if (!view.diff) {
    const fallback = document.createElement('span');
    fallback.className = 'badge info';
    fallback.textContent = 'Similar quote';
    container.appendChild(fallback);
    appendViewLink(container, view.existingQuoteUrl, view.existingQuoteOriginator);
  } else {
    const diff = document.createElement('span');
    diff.className = 'similar-diff-text';

    for (const token of view.diff) {
      const span = document.createElement('span');
      span.className = `diff-token ${token.type}`;
      span.textContent = markerFor(token.type) + token.value;
      diff.appendChild(span);
    }

    container.appendChild(diff);
    appendViewLink(container, view.existingQuoteUrl, view.existingQuoteOriginator);
  }

  if (view.sightingAvailable && view.sightingHint) {
    const hint = document.createElement('span');
    hint.className = 'sighting-hint';
    hint.textContent = view.sightingHint;
    container.appendChild(hint);
  }

  if (view.quoteId === null) return;

  const actions = document.createElement('span');
  actions.className = 'similar-actions';

  if (view.sightingAvailable) {
    actions.appendChild(createDecisionButton(
      'Add another sighting',
      'Add another sighting of this existing quote',
      { quoteId: view.quoteId, intent: 'sighting' },
      handlers,
    ));
  }

  if (view.variantAvailable) {
    actions.appendChild(createDecisionButton(
      'Add as variant',
      'Add captured text as a variant of this existing quote',
      { quoteId: view.quoteId, intent: 'variant' },
      handlers,
    ));
  }

  if (actions.childElementCount === 0) return;

  container.appendChild(actions);
  (actions.querySelector('button') as HTMLButtonElement | null)?.focus();
}

function appendViewLink(
  container: HTMLElement,
  url: string | null,
  originator: string | null,
): void {
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // Named unconditionally, not only when it differs from the capture target.
  // Confirming the existing quote is by the same person is reassurance rather
  // than noise, and the case that matters most — the post's author is not an
  // originator at all — has no target to differ from.
  link.textContent = originator
    ? `View existing quote from ${originator}`
    : 'View existing quote';
  link.setAttribute('aria-label', `${link.textContent} (opens in a new tab)`);
  container.appendChild(link);
}

function createDecisionButton(
  label: string,
  ariaLabel: string,
  decision: ResolutionDecision,
  handlers: { onResolve: (decision: ResolutionDecision) => void },
): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'similar-decision';
  action.textContent = label;
  action.setAttribute('aria-label', ariaLabel);
  action.addEventListener('click', () => handlers.onResolve(decision));
  return action;
}

function markerFor(type: WordDiffToken['type']): string {
  if (type === 'added') return '+';
  if (type === 'removed') return '-';
  return '';
}

function addSightingState(
  postDate: string | null | undefined,
  quoteDate: string | undefined,
): { eligible: boolean; hint: string | null } {
  if (!quoteDate) {
    return {
      eligible: false,
      hint: null,
    };
  }

  const postTime = postDate ? new Date(postDate).getTime() : NaN;
  const quoteTime = new Date(quoteDate).getTime();
  const eligible = Number.isFinite(postTime) && Number.isFinite(quoteTime) && postTime < quoteTime;

  return {
    eligible,
    hint: eligible ? 'This post is older than our records' : null,
  };
}

function coerceQuoteId(quoteId: string | undefined): number | null {
  if (!quoteId) return null;
  if (!/^\d+$/.test(quoteId)) return null;
  const parsed = Number(quoteId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
