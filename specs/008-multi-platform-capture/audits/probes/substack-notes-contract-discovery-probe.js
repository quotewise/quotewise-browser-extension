(() => {
  const PROBE_VERSION = '2026-06-22';
  const clean = (value, limit = 500) => String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
  const parseUrl = (value) => {
    try {
      return new URL(value, location.href);
    } catch {
      return null;
    }
  };
  const sourceFrom = (value) => {
    if (!value) return null;
    const url = parseUrl(value);
    const atHandle = url?.pathname.match(/\/@([^/]+)\/note\/([^/?#]+)/);
    if (atHandle) {
      return {
        handle: atHandle[1],
        sourceId: atHandle[2],
        url: url.toString(),
        exactPermalink: url.pathname === `/@${atHandle[1]}/note/${atHandle[2]}`,
      };
    }
    const bareNote = url?.pathname.match(/\/note\/([^/?#]+)/);
    if (bareNote) {
      return {
        handle: null,
        sourceId: bareNote[1],
        url: url.toString(),
        exactPermalink: url.pathname === `/note/${bareNote[1]}`,
      };
    }
    const profileNote = url?.pathname.match(/\/profile\/[^/]+\/note\/([^/?#]+)/);
    if (profileNote) {
      return {
        handle: null,
        sourceId: profileNote[1],
        url: url.toString(),
        exactPermalink: false,
      };
    }
    return null;
  };
  const attrs = (element, names) => Object.fromEntries(names
    .map((name) => [name, element.getAttribute(name)])
    .filter(([, value]) => value !== null));
  const rectFor = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  const isVisible = (rect) =>
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0 &&
    rect.x < window.innerWidth &&
    rect.y < window.innerHeight;
  const parseCount = (value) => {
    const compact = String(value || '').replace(/,/g, '').trim();
    const magnitude = compact.match(/(\d[\d.]*)([KMB])\b/i);
    if (magnitude) {
      const multiplier = magnitude[2].toUpperCase() === 'K' ? 1e3 : magnitude[2].toUpperCase() === 'M' ? 1e6 : 1e9;
      return Math.round(Number(magnitude[1]) * multiplier);
    }
    const numeric = compact.match(/\d[\d.]*/);
    return numeric ? Number(numeric[0]) : null;
  };
  const metaContent = (selector) => document.querySelector(selector)?.content || null;
  const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
  const ogUrl = metaContent('meta[property="og:url"]');
  const locationIdentity = sourceFrom(location.href);
  const canonicalIdentity = sourceFrom(canonical);
  const ogIdentity = sourceFrom(ogUrl);
  const identity = locationIdentity || canonicalIdentity || ogIdentity || null;
  const sourceId = identity?.sourceId || null;
  const handle = identity?.handle || null;
  const ogTitle = metaContent('meta[property="og:title"]') || metaContent('meta[name="twitter:title"]');
  const titleIdentity = ogTitle?.match(/^(.+?)\s+\(@([^)]+)\)$/);
  const displayNameFromTitle = clean(titleIdentity?.[1] || '', 160) || null;
  const handleFromTitle = titleIdentity?.[2] || null;
  const description = metaContent('meta[property="og:description"]') || metaContent('meta[name="description"]') || null;
  const publishedTime = metaContent('meta[property="og:published_time"]') ||
    metaContent('meta[property="article:published_time"]') ||
    null;
  const twitterCardMetrics = [1, 2].map((index) => {
    const label = metaContent(`meta[name="twitter:label${index}"]`);
    const data = metaContent(`meta[name="twitter:data${index}"]`);
    return label || data ? { label, data, parsedCount: parseCount(data) } : null;
  }).filter(Boolean);
  const sourceLinks = Array.from(document.querySelectorAll('a[href]'))
    .map((link, index) => {
      const rect = rectFor(link);
      const source = sourceFrom(link.getAttribute('href'));
      return {
        index,
        tag: link.tagName.toLowerCase(),
        attrs: attrs(link, ['href', 'role', 'aria-label', 'data-testid']),
        text: clean(link.textContent, 240),
        source,
        rect,
        visible: isVisible(rect),
      };
    })
    .filter((link) => link.source);
  const candidateRoots = Array.from(document.querySelectorAll('[role="article"], [aria-label="Note"], [class*="feedItem"]'))
    .map((element, index) => {
      const rect = rectFor(element);
      const rootSourceLinks = Array.from(element.querySelectorAll('a[href]'))
        .map((link) => ({
          href: link.getAttribute('href'),
          text: clean(link.textContent, 120),
          source: sourceFrom(link.getAttribute('href')),
        }))
        .filter((link) => link.source);
      const text = clean(element.textContent, 1200);
      const matchesSource = sourceId
        ? rootSourceLinks.some((link) => link.source?.sourceId === sourceId)
        : false;
      return {
        element,
        index,
        tag: element.tagName.toLowerCase(),
        attrs: attrs(element, ['role', 'aria-label', 'data-testid', 'class']),
        text,
        sourceLinks: rootSourceLinks.slice(0, 20),
        matchesSource,
        rect,
        visible: isVisible(rect),
      };
    })
    .filter((entry) => entry.visible);
  const focalRoot = candidateRoots
    .filter((entry) => entry.matchesSource)
    .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))[0] || null;
  const textCandidates = focalRoot ? Array.from(focalRoot.element.querySelectorAll('p, div, span'))
    .map((element, index) => {
      const rect = rectFor(element);
      const text = clean(element.textContent, 2000);
      const hasSameTextChild = Array.from(element.children).some((child) => clean(child.textContent, 2000) === text);
      return {
        index,
        tag: element.tagName.toLowerCase(),
        attrs: attrs(element, ['role', 'aria-label', 'data-testid', 'class']),
        text,
        rect,
        visible: isVisible(rect),
        hasSameTextChild,
      };
    })
    .filter((candidate) =>
      candidate.visible &&
      !candidate.hasSameTextChild &&
      candidate.text.length > 20 &&
      (!description || candidate.text === clean(description, 2000) || candidate.text.startsWith(clean(description, 80))))
    .sort((a, b) => a.text.length - b.text.length || a.rect.y - b.rect.y)
    .slice(0, 20) : [];
  const bodyCandidate = textCandidates[0] || null;
  const authorLink = focalRoot ? Array.from(focalRoot.element.querySelectorAll('a[href^="/@"]'))
    .map((link, index) => {
      const rect = rectFor(link);
      return {
        index,
        attrs: attrs(link, ['href', 'role', 'aria-label', 'data-testid']),
        text: clean(link.textContent, 240),
        rect,
        visible: isVisible(rect),
      };
    })
    .find((link) =>
      link.visible &&
      link.attrs.href?.replace(/\?.*$/, '') === `/@${handle || handleFromTitle}` &&
      link.text &&
      !link.text.startsWith('@')) || null : null;
  const countButton = (label) => {
    if (!focalRoot) return null;
    const element = Array.from(focalRoot.element.querySelectorAll('button, [role="button"]'))
      .find((button) => clean(button.getAttribute('aria-label'), 80).toLowerCase() === label);
    if (!element) return null;
    const rect = rectFor(element);
    const text = clean(element.textContent, 80);
    return {
      tag: element.tagName.toLowerCase(),
      attrs: attrs(element, ['role', 'aria-label', 'data-testid']),
      text,
      parsedCount: parseCount(text),
      rect,
      visible: isVisible(rect),
    };
  };
  const focalScope = focalRoot?.element || document;
  const visibleStatText = Array.from(focalScope.querySelectorAll('a, div, span'))
    .map((element, index) => {
      const rect = rectFor(element);
      return {
        index,
        tag: element.tagName.toLowerCase(),
        attrs: attrs(element, ['href', 'role', 'aria-label', 'data-testid']),
        text: clean(element.textContent, 200),
        rect,
        visible: isVisible(rect),
      };
    })
    .filter((entry) =>
      entry.visible &&
      /\b(?:Likes?|Replies?|Restacks?)\b/.test(entry.text) &&
      /\d/.test(entry.text))
    .slice(0, 30);
  const visibleDateText = Array.from(focalScope.querySelectorAll('div, span, a'))
    .map((element, index) => {
      const rect = rectFor(element);
      return {
        index,
        tag: element.tagName.toLowerCase(),
        attrs: attrs(element, ['href', 'role', 'aria-label', 'data-testid']),
        text: clean(element.textContent, 160),
        rect,
        visible: isVisible(rect),
      };
    })
    .filter((entry) => entry.visible && /\b[A-Z][a-z]{2}\s+\d{1,2}\b/.test(entry.text) && /\d{1,2}:\d{2}\s+[AP]M/.test(entry.text))
    .slice(0, 20);
  const observations = [
    document.querySelectorAll('time[datetime]').length === 0 ? 'No time[datetime] hooks in rendered Substack Notes DOM.' : null,
    canonical && sourceFrom(canonical)?.sourceId === sourceId ? 'Canonical link points to the Substack note permalink.' : null,
    ogUrl && sourceFrom(ogUrl)?.sourceId === sourceId ? 'OG URL points to the Substack note permalink.' : null,
    description ? 'OG/description metadata contains the note body.' : null,
    publishedTime ? 'Metadata exposes an ISO published timestamp.' : null,
    twitterCardMetrics.length > 0 ? 'Twitter card metadata exposes likes/replies counts.' : null,
    focalRoot ? 'Visible focal root candidate is a Note article with a matching note permalink link.' : null,
    bodyCandidate ? 'Visible note body candidate matches metadata description.' : null,
  ].filter(Boolean);
  const out = {
    meta: {
      probe: 'substack-notes-contract-discovery',
      version: PROBE_VERSION,
      url: location.href,
      uiLang: document.documentElement.lang || null,
    },
    identity: identity ? { ...identity } : null,
    metadata: {
      canonical,
      ogUrl,
      ogTitle,
      documentTitle: document.title,
      displayNameFromTitle,
      handleFromTitle,
      description,
      publishedTime,
      twitterCardMetrics,
    },
    roots: {
      articleCount: document.querySelectorAll('article').length,
      roleArticleCount: document.querySelectorAll('[role="article"]').length,
      ariaNoteCount: document.querySelectorAll('[aria-label="Note"]').length,
      timeDateTimeCount: document.querySelectorAll('time[datetime]').length,
      candidateRootCount: candidateRoots.length,
    },
    contractCandidates: {
      metadataPrimary: {
        platform: 'substack_notes',
        platformCode: 'SS',
        sourceUrl: canonical || ogUrl || location.href,
        sourceId,
        authorHandle: handle || handleFromTitle,
        displayName: displayNameFromTitle,
        text: description,
        postedAt: publishedTime,
        likesCount: twitterCardMetrics.find((metric) => /^likes?$/i.test(metric.label || ''))?.parsedCount ?? null,
        repliesCount: twitterCardMetrics.find((metric) => /^replies?$/i.test(metric.label || ''))?.parsedCount ?? null,
        confidence: canonical && ogUrl && description && publishedTime && (handle || handleFromTitle) && sourceId
          ? 'candidate_metadata_primary'
          : 'incomplete',
      },
      visibleNoteRoot: {
        platform: 'substack_notes',
        platformCode: 'SS',
        sourceUrl: location.href,
        sourceId,
        authorHandle: handle || handleFromTitle,
        displayName: authorLink?.text || displayNameFromTitle,
        text: bodyCandidate?.text || null,
        postedAt: null,
        postedAtEvidence: visibleDateText,
        likesCount: countButton('like')?.parsedCount ?? null,
        repliesCount: countButton('comment')?.parsedCount ?? null,
        restacksCount: countButton('restack')?.parsedCount ?? null,
        confidence: focalRoot && bodyCandidate ? 'candidate_visible_focal_root' : 'incomplete',
      },
      actionCounts: {
        likes: countButton('like'),
        replies: countButton('comment'),
        restacks: countButton('restack'),
        visibleStatText,
      },
    },
    sourceLinks: sourceLinks
      .filter((link) => link.source?.sourceId === sourceId)
      .map((link) => ({ ...link, source: link.source ? { ...link.source } : null, rect: { ...link.rect } }))
      .slice(0, 120),
    visibleRootCandidates: candidateRoots.map((entry) => ({
      index: entry.index,
      tag: entry.tag,
      attrs: entry.attrs,
      text: entry.matchesSource ? entry.text : null,
      sourceLinks: entry.sourceLinks,
      matchesSource: entry.matchesSource,
      rect: { ...entry.rect },
      visible: entry.visible,
    })).slice(0, 80),
    bodyTextCandidates: textCandidates.map((candidate) => ({ ...candidate, rect: { ...candidate.rect } })),
    observations,
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
})();
