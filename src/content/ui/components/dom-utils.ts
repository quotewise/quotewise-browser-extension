import type { QuoteMatch } from '../../../types/api';
import { getWebBaseUrl } from '../../../config/environment';

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function safeHttpsUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Quotewise page for a duplicate-check match, or null when it has no addressable quote. */
export function quotePageUrl(match: Pick<QuoteMatch, 'url' | 'short_code'>): string | null {
  if (match.url) return safeHttpsUrl(match.url);
  if (!match.short_code) return null;

  const baseUrl = getWebBaseUrl().replace(/\/+$/, '');
  return safeHttpsUrl(`${baseUrl}/quotes/${encodeURIComponent(match.short_code)}`);
}
