import type { DuplicateCheckResult } from '../../../types/api';
import { getWebBaseUrl } from '../../../config/environment';
import { classifyMatchResolution } from '../../../utils/duplicate-status';
import { diffWords, type WordDiffToken } from '../../../utils/word-diff';
import { safeHttpsUrl } from './dom-utils';

export interface SimilarMatchView {
  quoteId: number | null;
  existingQuoteText: string | null;
  diff: WordDiffToken[] | null;
  existingQuoteUrl: string | null;
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
  tweetDate?: string | null,
): SimilarMatchView | null {
  if (classifyMatchResolution(result) !== 'similar') {
    return null;
  }

  const match = Array.isArray(result.matches) ? result.matches[0] : undefined;
  const quoteId = coerceQuoteId(match?.quote_id);
  if (!match) {
    return {
      quoteId,
      existingQuoteText: null,
      diff: null,
      existingQuoteUrl: null,
      sightingAvailable: false,
      sightingHint: null,
      variantAvailable: false,
    };
  }

  const existingQuoteText = match.text?.trim() ? match.text : null;
  const sightingState = addSightingState(tweetDate, match.quote_date);

  return {
    quoteId,
    existingQuoteText,
    diff: existingQuoteText ? diffWords(match.text, capturedText) : null,
    existingQuoteUrl: quotePageUrl(match),
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
    appendViewLink(container, view.existingQuoteUrl);
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
    appendViewLink(container, view.existingQuoteUrl);
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

function appendViewLink(container: HTMLElement, url: string | null): void {
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'View existing quote';
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

function quotePageUrl(match: DuplicateCheckResult['matches'][number]): string | null {
  if (match.url) return safeHttpsUrl(match.url);
  if (!match.short_code) return null;

  const baseUrl = getWebBaseUrl().replace(/\/+$/, '');
  return safeHttpsUrl(`${baseUrl}/quotes/${encodeURIComponent(match.short_code)}`);
}

function addSightingState(
  tweetDate: string | null | undefined,
  quoteDate: string | undefined,
): { eligible: boolean; hint: string | null } {
  if (!quoteDate) {
    return {
      eligible: false,
      hint: null,
    };
  }

  const tweetTime = tweetDate ? new Date(tweetDate).getTime() : NaN;
  const quoteTime = new Date(quoteDate).getTime();
  const eligible = Number.isFinite(tweetTime) && Number.isFinite(quoteTime) && tweetTime < quoteTime;

  return {
    eligible,
    hint: eligible ? 'This tweet is older than our records' : null,
  };
}

function coerceQuoteId(quoteId: string | undefined): number | null {
  if (!quoteId) return null;
  const parsed = Number.parseInt(quoteId, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
