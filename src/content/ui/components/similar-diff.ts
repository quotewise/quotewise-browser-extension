import type { DuplicateCheckResult } from '../../../types/api';
import { getWebBaseUrl } from '../../../config/environment';
import { diffWords, type WordDiffToken } from '../../../utils/word-diff';

export interface SimilarMatchView {
  isNearMatch: boolean;
  diff: WordDiffToken[] | null;
  existingQuoteUrl: string | null;
  addSighting: {
    eligible: boolean;
    available: boolean;
    hint: string | null;
    label: 'Add as earlier sighting of this similar quote';
  };
}

export function isNearMatchRecommendation(recommendation: string): boolean {
  return recommendation === 'new_version' || recommendation === 'new_version_known_author';
}

export function buildSimilarMatchView(
  result: DuplicateCheckResult,
  capturedText: string,
  tweetDate?: string | null,
): SimilarMatchView | null {
  if (!isNearMatchRecommendation(result.recommendation)) {
    return null;
  }

  const match = result.matches[0];
  if (!match) {
    return {
      isNearMatch: true,
      diff: null,
      existingQuoteUrl: null,
      addSighting: addSightingState(tweetDate, undefined),
    };
  }

  return {
    isNearMatch: true,
    diff: match.text?.trim() ? diffWords(match.text, capturedText) : null,
    existingQuoteUrl: quotePageUrl(match),
    addSighting: addSightingState(tweetDate, match.quote_date),
  };
}

export function renderSimilarDiff(container: HTMLElement, view: SimilarMatchView): void {
  container.innerHTML = '';
  container.className = 'similar-diff';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Similar quote comparison');

  if (!view.diff) {
    const fallback = document.createElement('span');
    fallback.className = 'badge info';
    fallback.textContent = 'Similar version';
    container.appendChild(fallback);
    appendViewLink(container, view.existingQuoteUrl);
    return;
  }

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

  if (view.addSighting.available && view.addSighting.eligible) {
    const hint = document.createElement('span');
    hint.className = 'sighting-hint';
    hint.textContent = view.addSighting.hint || '';
    container.appendChild(hint);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'add-sighting-action';
    action.disabled = true;
    action.textContent = view.addSighting.label;
    action.setAttribute('aria-disabled', 'true');
    container.appendChild(action);
  }
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

function markerFor(type: WordDiffToken['type']): string {
  if (type === 'added') return '+';
  if (type === 'removed') return '-';
  return '';
}

function quotePageUrl(match: DuplicateCheckResult['matches'][number]): string | null {
  if (match.url) return match.url;
  if (!match.short_code) return null;

  const baseUrl = getWebBaseUrl().replace(/\/+$/, '');
  return `${baseUrl}/quotes/${encodeURIComponent(match.short_code)}`;
}

function addSightingState(
  tweetDate: string | null | undefined,
  quoteDate: string | undefined,
): SimilarMatchView['addSighting'] {
  const label = 'Add as earlier sighting of this similar quote' as const;
  if (!quoteDate) {
    return {
      available: false,
      eligible: false,
      hint: null,
      label,
    };
  }

  const tweetTime = tweetDate ? new Date(tweetDate).getTime() : NaN;
  const quoteTime = new Date(quoteDate).getTime();
  const eligible = Number.isFinite(tweetTime) && Number.isFinite(quoteTime) && tweetTime < quoteTime;

  return {
    available: true,
    eligible,
    hint: eligible ? 'This tweet is older than our records' : null,
    label,
  };
}
