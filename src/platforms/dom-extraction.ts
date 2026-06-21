import { cleanUrl, extractTextContent, parseNumber } from '../content/common';

export function canonicalUrl(fallbackUrl: string): string {
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return cleanUrl(canonical || fallbackUrl);
}

export function textFromSelectors(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const text = element ? extractTextContent(element) : '';
    if (text) {
      return text;
    }
  }

  return '';
}

export function metaContent(...selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export function datetimeFrom(root: ParentNode): string | null {
  const datetime = root.querySelector<HTMLTimeElement>('time[datetime]')?.getAttribute('datetime');
  return datetime || metaContent(
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
  );
}

export function visibleLikesFrom(root: ParentNode): number | undefined {
  const candidates = [
    ...Array.from(root.querySelectorAll('[aria-label*="like" i], [aria-label*="likes" i]')),
    ...Array.from(root.querySelectorAll('[data-testid*="like" i], [class*="like" i]')),
  ];

  for (const candidate of candidates) {
    const raw = candidate.getAttribute('aria-label') || candidate.textContent || '';
    if (/\d/.test(raw) && /likes?/i.test(raw)) {
      return parseNumber(raw);
    }
  }

  return undefined;
}

export function normalizeHandle(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  return cleaned || undefined;
}

export function firstElementWithHrefContaining(root: ParentNode, sourceId: string): HTMLElement | null {
  const escaped = sourceId.replace(/["\\]/g, '\\$&');
  const link = root.querySelector<HTMLAnchorElement>(`a[href*="${escaped}"]`);
  return link?.closest<HTMLElement>('article, [role="article"], [data-testid*="post" i], [data-testid*="thread" i]') ?? null;
}
