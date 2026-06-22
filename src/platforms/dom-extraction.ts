import { cleanUrl, parseNumber } from '../content/common';

export function canonicalUrl(fallbackUrl: string): string {
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return cleanUrl(canonical || fallbackUrl);
}

export function metadataUrl(...selectors: string[]): string | null {
  const value = metaContent(...selectors);
  return value ? cleanPermalinkUrl(value) : null;
}

export function cleanPermalinkUrl(url: string): string {
  try {
    const parsed = new URL(cleanUrl(url));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return cleanUrl(url);
  }
}

export function textFromSelectors(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const text = element ? textWithLineBreaks(element) : '';
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
    'meta[name="publish_date"]',
  );
}

export function datetimeFromSourceLink(root: ParentNode, sourceId: string): string | null {
  const times = Array.from(root.querySelectorAll<HTMLTimeElement>('time[datetime]'));

  for (const time of times) {
    const sourceLink = time.closest<HTMLAnchorElement>('a[href]');
    if (sourceLink?.href.includes(sourceId)) {
      return time.getAttribute('datetime');
    }
  }

  for (const time of times) {
    const nearestSourceLink = closestAncestorContaining<HTMLAnchorElement>(
      time,
      ancestor => ancestor.tagName === 'A' && (ancestor as HTMLAnchorElement).href.includes(sourceId),
    );
    if (nearestSourceLink) {
      return time.getAttribute('datetime');
    }
  }

  return null;
}

export function visibleLikesFrom(root: ParentNode): number | undefined {
  const candidates = [
    ...Array.from(root.querySelectorAll('[aria-label*="like" i], [aria-label*="likes" i]')),
    ...Array.from(root.querySelectorAll('[data-testid*="like" i], [class*="like" i]')),
  ];

  for (const candidate of candidates) {
    const raw = candidate.getAttribute('aria-label') || candidate.textContent || '';
    if (/\d/.test(raw) && /likes?/i.test(raw)) {
      const likeCount = parseLikeCount(raw);
      if (likeCount !== undefined) {
        return likeCount;
      }
    }
  }

  return undefined;
}

export function adjacentActionCountFrom(root: ParentNode, actionLabel: string, nextActionLabel?: string): number | undefined {
  const tokens = orderedTextTokens(root);
  const actionPattern = new RegExp(`^${escapeRegExp(actionLabel)}\\b`, 'i');
  const nextActionPattern = nextActionLabel
    ? new RegExp(`^${escapeRegExp(nextActionLabel)}\\b`, 'i')
    : null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!actionPattern.test(token)) {
      continue;
    }

    const inlineCount = parseActionInlineCount(token, actionLabel);
    if (inlineCount !== undefined) {
      return inlineCount;
    }

    for (let nextIndex = index + 1; nextIndex < tokens.length; nextIndex += 1) {
      const nextToken = tokens[nextIndex];
      if (nextActionPattern?.test(nextToken)) {
        break;
      }

      const count = parseStandaloneCount(nextToken);
      if (count !== undefined) {
        return count;
      }
    }
  }

  return undefined;
}

function parseLikeCount(value: string): number | undefined {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const countPattern = String.raw`\d[\d,.]*\s*[KMB]?`;
  const beforeLike = normalized.match(new RegExp(`(${countPattern})(?=\\s+likes?\\b)`, 'i'));
  if (beforeLike) {
    return parseNumber(beforeLike[1]);
  }

  const afterLike = normalized.match(new RegExp(`\\blikes?\\b[^\\d]{0,20}(${countPattern})`, 'i'));
  if (afterLike) {
    return parseNumber(afterLike[1]);
  }

  return undefined;
}

export function normalizeHandle(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  return cleaned || undefined;
}

export function firstElementWithHrefContaining(
  root: ParentNode,
  sourceId: string,
  closestSelectors = 'article, [role="article"], [data-testid*="post" i], [data-testid*="thread" i]',
): HTMLElement | null {
  const escaped = sourceId.replace(/["\\]/g, '\\$&');
  const link = root.querySelector<HTMLAnchorElement>(`a[href*="${escaped}"]`);
  return link?.closest<HTMLElement>(closestSelectors) ?? null;
}

export function sourceLinkedRoot(
  root: ParentNode,
  sourceId: string,
  closestSelectors: string,
): HTMLElement | null {
  const links = hrefLinksContaining(root, sourceId);

  for (const link of links) {
    const closest = link.closest<HTMLElement>(closestSelectors);
    if (closest) {
      return closest;
    }
  }

  let best: { element: HTMLElement; score: number } | null = null;

  for (const link of links) {
    for (const ancestor of elementAncestors(link)) {
      if (ancestor === document.body || ancestor === document.documentElement) {
        continue;
      }

      const score = sourceRootScore(ancestor, sourceId);
      if (!best || score > best.score) {
        best = { element: ancestor, score };
      }
    }
  }

  return best?.score && best.score > 0 ? best.element : null;
}

export function hrefLinksContaining(root: ParentNode, value: string): HTMLAnchorElement[] {
  const escaped = value.replace(/["\\]/g, '\\$&');
  return Array.from(root.querySelectorAll<HTMLAnchorElement>(`a[href*="${escaped}"]`));
}

export function textWithLineBreaks(element: Element): string {
  const innerText = (element as HTMLElement).innerText;
  if (typeof innerText === 'string' && innerText.trim()) {
    return normalizeMultilineText(innerText);
  }

  const rawText = element.textContent || '';
  if (rawText.includes('\n')) {
    return normalizeMultilineText(rawText);
  }

  const directBlockText = directChildBlockText(element);
  if (directBlockText) {
    return directBlockText;
  }

  return normalizeMultilineText(rawText);
}

export function bodyTextFromRoot(root: ParentNode, sourceId?: string, ignoredTexts: string[] = []): string {
  const ignored = ignoredTexts
    .map(text => normalizeInlineText(text))
    .filter(Boolean);
  const firstAction = firstPostActionElement(root);

  const candidates = Array.from(root.querySelectorAll<HTMLElement>('div, span, p'))
    .filter(element => bodyTextCandidate(element, sourceId, ignored, firstAction))
    .map(element => ({
      element,
      text: textWithLineBreaks(element),
    }))
    .filter(candidate => candidate.text.length >= 2)
    .sort((left, right) => {
      const scoreDiff = bodyTextScore(right.element, right.text) - bodyTextScore(left.element, left.text);
      return scoreDiff || left.text.length - right.text.length;
    });

  return candidates[0]?.text || '';
}

export function metadataCountByLabel(label: string): number | undefined {
  const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name^="twitter:label" i]'));
  for (const meta of metas) {
    if (meta.content.trim().toLowerCase() !== label.toLowerCase()) {
      continue;
    }

    const suffix = meta.name.match(/twitter:label(\d+)/i)?.[1];
    if (!suffix) {
      continue;
    }

    const count = document.querySelector<HTMLMetaElement>(`meta[name="twitter:data${suffix}" i]`)?.content;
    if (count !== undefined) {
      return parseNumber(count);
    }
  }

  return undefined;
}

function sourceRootScore(element: HTMLElement, sourceId: string): number {
  const text = normalizeInlineText(element.textContent || '');
  const sourceLinks = hrefLinksContaining(element, sourceId).length;
  const allSourceLinks = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"], a[href*="/note/"], a[href*="/profile/"]')).length;
  let score = 0;

  if (sourceLinks > 0) score += 4;
  if (text.length >= 8) score += 2;
  if (text.length > 2000) score -= 4;
  if (allSourceLinks > sourceLinks + 6) score -= 4;
  if (element.querySelector('time[datetime]')) score += 2;
  if (element.querySelector('[aria-label="Like" i], [aria-label^="Like " i], [aria-label*=" likes" i]')) score += 3;
  if (element.querySelector('[aria-label="Reply" i], [aria-label^="Reply " i]')) score += 2;

  return score;
}

function bodyTextCandidate(
  element: HTMLElement,
  sourceId?: string,
  ignoredTexts: string[] = [],
  firstAction?: HTMLElement | null,
): boolean {
  const text = textWithLineBreaks(element);
  if (!text || actionOrMetricText(text)) {
    return false;
  }

  if (firstAction && elementFollows(element, firstAction)) {
    return false;
  }

  const inlineText = normalizeInlineText(text);
  if (ignoredTexts.includes(inlineText) || ignoredAuthorMetadataText(inlineText, ignoredTexts)) {
    return false;
  }

  if (element.closest('button, [role="button"]')) {
    return false;
  }

  const link = element.closest<HTMLAnchorElement>('a[href]');
  if (link) {
    const href = link.href || link.getAttribute('href') || '';
    if (!sourceId || !href.includes(sourceId)) {
      return false;
    }
  }

  const sameTextChild = Array.from(element.children).some(child =>
    normalizeMultilineText(child.textContent || '') === text
  );
  if (sameTextChild) {
    return false;
  }

  return true;
}

function firstPostActionElement(root: ParentNode): HTMLElement | null {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"], [aria-label]'));
  return elements.find(element => {
    const label = normalizeInlineText(element.getAttribute('aria-label') || element.getAttribute('title') || '');
    const text = normalizeInlineText(element.textContent || '');
    return /^(Like|Reply|Repost|Share)\b/i.test(label || text);
  }) || null;
}

function elementFollows(element: Element, reference: Element): boolean {
  return !!(reference.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function ignoredAuthorMetadataText(value: string, ignoredTexts: string[]): boolean {
  for (const ignoredText of ignoredTexts) {
    if (!value.toLowerCase().startsWith(ignoredText.toLowerCase())) {
      continue;
    }

    const remainder = value.slice(ignoredText.length).trim();
    if (!remainder) {
      return true;
    }

    if (/^(Verified\s*)?(More\s*)?$/i.test(remainder) ||
      /^(Verified\s*)?\d+[smhdw](\s+More)?$/i.test(remainder)) {
      return true;
    }
  }

  return false;
}

function bodyTextScore(element: HTMLElement, text: string): number {
  let score = 0;

  if (element.matches('[data-testid="postText"], [data-testid*="text" i], [data-testid*="content" i]')) {
    score += 8;
  }
  if (element.closest('a[href]')) {
    score -= 5;
  }
  if (text.includes('\n')) {
    score += 3;
  }
  if (text.length >= 20) {
    score += 4;
  }
  if (text.length > 800) {
    score -= 2;
  }
  if (element.querySelector('button, [role="button"], [aria-label*="Like" i], [aria-label*="Reply" i], [aria-label*="Repost" i], [aria-label*="Share" i]')) {
    score -= 6;
  }
  if (element.querySelector('img, video, audio, a[href^="http"]')) {
    score -= 4;
  }

  return score;
}

function directChildBlockText(element: Element): string {
  const children = Array.from(element.children).filter(child => {
    const text = normalizeMultilineText(child.textContent || '');
    return text && !actionOrMetricText(text);
  });
  if (children.length < 2) {
    return '';
  }

  const parentInlineText = normalizeInlineText(element.textContent || '');
  const childTexts = children.map(child => textWithLineBreaks(child)).filter(Boolean);
  const childrenInlineText = normalizeInlineText(childTexts.join(' '));
  if (!childrenInlineText || compactText(childrenInlineText) !== compactText(parentInlineText)) {
    return '';
  }

  const separator = children.every(child => child.tagName === 'P') ? '\n\n' : '\n';
  return normalizeMultilineText(childTexts.join(separator));
}

function orderedTextTokens(root: ParentNode): string[] {
  const tokens: string[] = [];
  const elements = Array.from(root.querySelectorAll<HTMLElement>('*'));

  for (const element of elements) {
    const label = element.getAttribute('aria-label') || element.getAttribute('title') || '';
    if (label.trim()) {
      tokens.push(normalizeInlineText(label));
    }

    if (element.children.length === 0) {
      const text = normalizeInlineText(element.textContent || '');
      if (text && text !== label.trim()) {
        tokens.push(text);
      }
    }
  }

  const rootText = normalizeInlineText((root as Element).textContent || '');
  if (tokens.length === 0 && rootText) {
    tokens.push(rootText);
  }

  return tokens;
}

function parseActionInlineCount(value: string, actionLabel: string): number | undefined {
  const countPattern = String.raw`\d[\d,.]*\s*[KMB]?`;
  const match = value.match(new RegExp(`^${escapeRegExp(actionLabel)}\\s*\\(?\\s*(${countPattern})(?:\\s+likes?)?\\)?`, 'i'));
  return match ? parseNumber(match[1]) : undefined;
}

function parseStandaloneCount(value: string): number | undefined {
  if (!/^\d[\d,.]*\s*[KMB]?$/i.test(value.trim())) {
    return undefined;
  }

  return parseNumber(value);
}

function actionOrMetricText(value: string): boolean {
  const normalized = normalizeInlineText(value);
  return !normalized ||
    /^\d[\d,.]*\s*[KMB]?$/i.test(normalized) ||
    /^(Like|Reply|Repost|Share|More|Follow|Following|View activity|Mark spoiler)$/i.test(normalized) ||
    /^(?:@)?[a-z0-9._]{2,30}\s+(?:Verified\s+)?\d+[smhdw](?:\s+More)?$/i.test(normalized) ||
    /^Reply to .+\.\.\.$/i.test(normalized) ||
    /^\d{1,2}:\d{2}\s*(AM|PM)?\s*·\s*/i.test(normalized) ||
    /^\d+[smhdw]$/i.test(normalized) ||
    /^\d[\d,.]*\s*(likes?|replies|reposts?|quotes?|saves?)$/i.test(normalized);
}

function normalizeMultilineText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInlineText(value: string): string {
  return normalizeMultilineText(value).replace(/\s+/g, ' ').trim();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, '');
}

function elementAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let current: HTMLElement | null = element;
  while (current) {
    ancestors.push(current);
    current = current.parentElement;
  }
  return ancestors;
}

function closestAncestorContaining<T extends HTMLElement>(
  element: HTMLElement,
  predicate: (element: HTMLElement) => boolean,
): T | null {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    if (predicate(current)) {
      return current as T;
    }
    current = current.parentElement;
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
