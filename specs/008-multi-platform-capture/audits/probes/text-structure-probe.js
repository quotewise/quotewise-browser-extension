(() => {
  const PROBE_VERSION = '2026-06-22';
  const MAX_TEXT = 2500;
  const BLOCK_TAGS = new Set([
    'ADDRESS',
    'ARTICLE',
    'ASIDE',
    'BLOCKQUOTE',
    'DD',
    'DIV',
    'DL',
    'DT',
    'FIGCAPTION',
    'FIGURE',
    'FOOTER',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HEADER',
    'LI',
    'MAIN',
    'NAV',
    'OL',
    'P',
    'PRE',
    'SECTION',
    'UL',
  ]);

  const cleanLine = (value) => String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .trim();
  const compact = (value, limit = MAX_TEXT) => String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, limit);
  const normalizedInline = (value) => cleanLine(value).replace(/\s+/g, ' ');
  const compareText = (value) => normalizedInline(value).replace(/\s+/g, '');
  const parseUrl = (value) => {
    try {
      return new URL(value, location.href);
    } catch {
      return null;
    }
  };
  const platformFromLocation = () => {
    const host = location.hostname.toLowerCase();
    if (host === 'threads.com' || host === 'www.threads.com' || host === 'threads.net' || host === 'www.threads.net') return 'threads';
    if (host === 'bsky.app') return 'bluesky';
    if (host === 'substack.com' || host.endsWith('.substack.com')) return 'substack_notes';
    if (host === 'x.com' || host === 'twitter.com') return 'twitter';
    return 'unknown';
  };
  const sourceFrom = (value, platform = platformFromLocation()) => {
    const url = parseUrl(value);
    if (!url) return null;
    if (platform === 'threads') {
      const match = url.pathname.match(/\/@([^/]+)\/(?:post|t)\/([^/?#]+)/);
      return match ? { handle: match[1], sourceId: match[2], url: url.toString() } : null;
    }
    if (platform === 'bluesky') {
      const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
      return match ? { handle: match[1], sourceId: match[2], url: url.toString() } : null;
    }
    if (platform === 'substack_notes') {
      const byHandle = url.pathname.match(/\/@([^/]+)\/note\/([^/?#]+)/);
      if (byHandle) return { handle: byHandle[1], sourceId: byHandle[2], url: url.toString() };
      const byProfile = url.pathname.match(/\/profile\/([^/]+)\/note\/([^/?#]+)/);
      if (byProfile) return { handle: null, profileSlug: byProfile[1], sourceId: byProfile[2], url: url.toString() };
      const bare = url.pathname.match(/\/note\/([^/?#]+)/);
      return bare ? { handle: null, sourceId: bare[1], url: url.toString() } : null;
    }
    if (platform === 'twitter') {
      const match = url.pathname.match(/^\/([^/]+)\/status\/([^/?#]+)/);
      return match ? { handle: match[1], sourceId: match[2], url: url.toString() } : null;
    }
    return null;
  };
  const rectFor = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 &&
      rect.height > 0 &&
      rect.x + rect.width > 0 &&
      rect.y + rect.height > 0 &&
      rect.x < window.innerWidth &&
      rect.y < window.innerHeight;
  };
  const attrs = (element) => Object.fromEntries([
    'data-testid',
    'role',
    'aria-label',
    'dir',
    'href',
    'class',
  ].map((name) => [name, element.getAttribute(name)]).filter(([, value]) => value));
  const metaContent = (selector) => document.querySelector(selector)?.content || null;
  const allLinksForSource = (sourceId, platform) => Array.from(document.querySelectorAll('a[href]'))
    .map((link) => ({ link, source: sourceFrom(link.getAttribute('href'), platform) }))
    .filter((entry) => entry.source?.sourceId === sourceId);
  const findFocalRoot = (identity, platform) => {
    const sourceId = identity?.sourceId;
    if (!sourceId) return document.body;

    if (platform === 'bluesky') {
      const threadItems = Array.from(document.querySelectorAll('[data-testid^="postThreadItem-by-"]')).filter(isVisible);
      const exact = threadItems.find((root) =>
        Array.from(root.querySelectorAll('a[href]')).some((link) => {
          const source = sourceFrom(link.getAttribute('href'), platform);
          return source?.sourceId === sourceId && (!identity.handle || source.handle === identity.handle);
        }));
      return exact || threadItems[0] || document.body;
    }

    const sourceLink = allLinksForSource(sourceId, platform).find((entry) => isVisible(entry.link))?.link ||
      allLinksForSource(sourceId, platform)[0]?.link ||
      null;
    if (sourceLink) {
      return sourceLink.closest('[data-testid^="postThreadItem-by-"], [data-testid*="post" i], [data-testid*="thread" i], article, [role="article"], [class*="feedItem" i], [class*="feedUnit" i]') ||
        sourceLink.closest('div') ||
        document.body;
    }
    return document.body;
  };
  const candidateTextContainers = (root, platform) => {
    const selectors = platform === 'bluesky'
      ? ['[data-testid="postText"]', '[data-testid*="postText" i]', '[dir="auto"]']
      : platform === 'threads'
        ? ['[data-testid*="post-text" i]', '[data-testid*="thread-text" i]', '[dir="auto"]']
        : platform === 'substack_notes'
          ? ['.ProseMirror', '[class*="feedCommentBody" i]', '[dir="auto"]', 'article']
          : ['[dir="auto"]', 'article'];
    const elements = selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
    return elements.filter((element, index) =>
      elements.indexOf(element) === index &&
      isVisible(element) &&
      normalizedInline(element.textContent).length > 0);
  };
  const isChromeText = (candidate) => {
    const value = candidate.normalizedInlineText;
    const testId = candidate.attrs['data-testid'] || '';
    if (!value) return true;
    if (/like|repost|reply|quote|bookmark|save/i.test(testId)) return true;
    if (/^(Post|Follow|Following|Everybody can reply|Write your reply)$/i.test(value)) return true;
    if (/^\d[\d,.]*\s*(likes?|reposts?|replies?|quotes?|saves?)$/i.test(value)) return true;
    if (/^\d{1,2}:\d{2}\s+[AP]M\s+·\s+/i.test(value)) return true;
    if (/^@[A-Za-z0-9._-]+$/.test(value)) return true;
    if (value.length < 20) return true;
    return false;
  };
  const scoreTextCandidate = (candidate, metadataText) => {
    let score = 0;
    const metadataCompare = compareText(metadataText);
    const candidateCompare = compareText(candidate.recommendedText || candidate.normalizedInlineText);
    if (metadataCompare && candidateCompare.length > 40) {
      if (metadataCompare.startsWith(candidateCompare)) score += 600;
      if (candidateCompare.startsWith(metadataCompare.slice(0, Math.min(120, metadataCompare.length)))) score += 500;
    }
    if (candidate.attrs['data-testid'] === 'postText') score += 300;
    if (candidate.newlineEvidence.hasParagraphBreaks) score += 200;
    if (candidate.attrs.class && /ProseMirror|feedCommentBody|postText|thread/i.test(candidate.attrs.class)) score += 100;
    score += Math.min(candidate.normalizedInlineText.length, 300) / 10;
    return score;
  };
  const leafBlockTexts = (element) => {
    const blocks = Array.from(element.querySelectorAll('p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, div[dir="auto"]'))
      .filter((candidate) => {
        const nested = Array.from(candidate.children).some((child) => BLOCK_TAGS.has(child.tagName) && normalizedInline(child.textContent));
        return !nested && normalizedInline(candidate.textContent);
      });
    const base = blocks.length > 0 ? blocks : Array.from(element.children)
      .filter((child) => BLOCK_TAGS.has(child.tagName) && normalizedInline(child.textContent));
    return base.map((child, index) => ({
      index,
      tag: child.tagName.toLowerCase(),
      attrs: attrs(child),
      textContentRaw: compact(child.textContent),
      innerTextRaw: compact(child.innerText),
      normalizedText: normalizedInline(child.innerText || child.textContent),
      rect: rectFor(child),
    }));
  };
  const newlineCount = (value) => (String(value || '').match(/\n/g) || []).length;
  const textEvidenceFor = (element) => {
    const blocks = leafBlockTexts(element);
    const blockTexts = blocks.map((block) => block.normalizedText).filter(Boolean);
    const recommendedText = blockTexts.length > 1
      ? blockTexts.join('\n\n')
      : compact(element.innerText || element.textContent);
    return {
      tag: element.tagName.toLowerCase(),
      attrs: attrs(element),
      rect: rectFor(element),
      textContentRaw: compact(element.textContent),
      innerTextRaw: compact(element.innerText),
      normalizedInlineText: normalizedInline(element.innerText || element.textContent).slice(0, MAX_TEXT),
      recommendedText: recommendedText.slice(0, MAX_TEXT),
      newlineEvidence: {
        textContentNewlineCount: newlineCount(element.textContent),
        innerTextNewlineCount: newlineCount(element.innerText),
        brCount: element.querySelectorAll('br').length,
        leafBlockCount: blocks.length,
        hasParagraphBreaks: blocks.length > 1 || newlineCount(element.innerText) > 0 || element.querySelectorAll('br').length > 0,
      },
      leafBlocks: blocks.slice(0, 20),
    };
  };

  const platform = platformFromLocation();
  const identity = sourceFrom(location.href, platform) ||
    sourceFrom(document.querySelector('link[rel="canonical"]')?.href, platform) ||
    sourceFrom(metaContent('meta[property="og:url"]'), platform);
  const root = findFocalRoot(identity, platform);
  const metadataText = metaContent('meta[property="og:description"]') || metaContent('meta[name="description"]') || null;
  const clone = (value) => value ? JSON.parse(JSON.stringify(value)) : value;
  const containers = candidateTextContainers(root, platform)
    .map(textEvidenceFor)
    .filter((candidate) => candidate.normalizedInlineText.length > 0)
    .filter((candidate) => !isChromeText(candidate))
    .sort((a, b) => {
      const bScore = scoreTextCandidate(b, metadataText);
      const aScore = scoreTextCandidate(a, metadataText);
      return bScore - aScore || a.rect.y - b.rect.y || a.normalizedInlineText.length - b.normalizedInlineText.length;
    });
  const primary = containers[0] || null;

  const out = {
    meta: {
      probe: 'text-structure',
      version: PROBE_VERSION,
      url: location.href,
      uiLang: document.documentElement.lang || null,
    },
    platform,
    identity,
    metadata: {
      canonical: document.querySelector('link[rel="canonical"]')?.href || null,
      ogUrl: metaContent('meta[property="og:url"]'),
      ogTitle: metaContent('meta[property="og:title"]'),
      ogDescription: metadataText,
      ogDescriptionNewlineCount: newlineCount(metadataText),
      documentTitle: document.title,
    },
    focalRoot: root ? {
      tag: root.tagName.toLowerCase(),
      attrs: attrs(root),
      rect: rectFor(root),
      textLength: normalizedInline(root.textContent).length,
    } : null,
    primaryTextContainer: clone(primary),
    textContainers: containers.slice(0, 12).map(clone),
    sourceLinks: identity?.sourceId ? allLinksForSource(identity.sourceId, platform).slice(0, 20).map((entry) => ({
      href: entry.link.href,
      text: normalizedInline(entry.link.textContent).slice(0, 240),
      attrs: attrs(entry.link),
      rect: rectFor(entry.link),
      source: entry.source,
      visible: isVisible(entry.link),
    })) : [],
    observations: [
      primary?.newlineEvidence.hasParagraphBreaks ? 'Primary text container has explicit paragraph/newline evidence.' : 'Primary text container has no explicit paragraph/newline evidence.',
      metadataText && newlineCount(metadataText) > 0 ? 'Metadata description contains newline characters.' : null,
      primary && primary.textContentRaw !== primary.innerTextRaw ? 'textContent and innerText differ; raw text extraction may lose paragraph boundaries.' : null,
      primary?.newlineEvidence.leafBlockCount > 1 ? 'Leaf block joining can reconstruct paragraph breaks deterministically.' : null,
    ].filter(Boolean),
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
})();
