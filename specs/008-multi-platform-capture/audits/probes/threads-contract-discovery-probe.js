(() => {
  const PROBE_VERSION = '2026-06-21';
  const clean = (value, limit = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const parseUrl = (value) => {
    try {
      return new URL(value, location.href);
    } catch {
      return null;
    }
  };
  const sourceFrom = (value) => {
    const url = parseUrl(value);
    const match = url?.pathname.match(/\/@([^/]+)\/(?:post|t)\/([^/?#]+)/);
    return match ? { handle: match[1], sourceId: match[2], url: url.toString() } : null;
  };
  const metaContent = (selector) => document.querySelector(selector)?.content || null;
  const rectFor = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  const selectorForSourceId = (sourceId) => {
    if (!sourceId) return null;
    const escaped = sourceId.replace(/["\\]/g, '\\$&');
    return `a[href*="${escaped}"]`;
  };

  const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
  const identity = sourceFrom(canonical) || sourceFrom(location.href);
  const sourceSelector = selectorForSourceId(identity?.sourceId || null);
  const ogTitle = metaContent('meta[property="og:title"]');
  const ogDescription = metaContent('meta[property="og:description"]') || metaContent('meta[name="description"]');
  const displayFromTitle = ogTitle?.match(/^(.+?) \(@([^)]+)\) on Threads$/);
  const titleBody = document.title.replace(/^\(\d+\)\s*/, '');

  const links = Array.from(document.querySelectorAll('a[href]')).map((link, index) => ({
    index,
    href: link.getAttribute('href'),
    absoluteHref: link.href,
    text: clean(link.textContent, 240),
    ariaLabel: link.getAttribute('aria-label'),
    role: link.getAttribute('role'),
    containsSourceId: identity?.sourceId
      ? link.href.includes(identity.sourceId) || (link.getAttribute('href') || '').includes(identity.sourceId)
      : false,
    rect: rectFor(link),
  }));
  const sourceLinks = links.filter(link => link.containsSourceId);

  const times = Array.from(document.querySelectorAll('time[datetime]')).map((time, index) => ({
    index,
    datetime: time.getAttribute('datetime'),
    text: clean(time.textContent, 80),
    nearestSourceLinkHref: time.closest('a[href]')?.href || null,
    rect: rectFor(time),
  }));

  const renderedTextCandidates = Array.from(document.querySelectorAll('[dir="auto"]'))
    .map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      text: clean(element.textContent, 700),
      hrefAncestor: element.closest('a[href]')?.getAttribute('href') || null,
      sourceLinkAncestor: sourceSelector ? !!element.closest(sourceSelector) : false,
      rect: rectFor(element),
    }))
    .filter(candidate => candidate.text)
    .slice(0, 80);

  const actionLabels = Array.from(document.querySelectorAll('[aria-label]'))
    .map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      label: clean(element.getAttribute('aria-label'), 120),
      role: element.getAttribute('role'),
      parentText: clean(element.parentElement?.textContent, 120),
      rect: rectFor(element),
    }))
    .filter(item => /like|reply|comment|repost|share|view|more|verified/i.test(item.label))
    .slice(0, 100);

  const regions = Array.from(document.querySelectorAll('[role="region"], [aria-label="Column body"], [aria-label="Column title"]'))
    .map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      text: clean(element.textContent, 700),
      containsSourceId: sourceSelector ? !!element.querySelector(sourceSelector) : false,
      rect: rectFor(element),
    }));

  const postedAt = times.find(time => identity?.sourceId && time.nearestSourceLinkHref?.includes(identity.sourceId))?.datetime ||
    times[0]?.datetime ||
    null;
  const renderedBodyCandidate = renderedTextCandidates.find(candidate =>
    candidate.hrefAncestor === null &&
    candidate.text.length > 80 &&
    !/^reply to /i.test(candidate.text)
  ) || null;

  const observations = [
    document.querySelectorAll('article').length === 0 ? 'No article elements in rendered Threads permalink DOM.' : null,
    document.querySelectorAll('[data-testid]').length === 0 ? 'No data-testid hooks in rendered Threads permalink DOM.' : null,
    document.querySelectorAll('[role="article"]').length === 0 ? 'No role=article hooks in rendered Threads permalink DOM.' : null,
    ogDescription ? 'og:description contains exact post body text for this original permalink.' : null,
    renderedBodyCandidate ? 'Rendered body text exists as dir=auto text, but browser extraction may normalize/degrade characters.' : null,
    actionLabels.some(label => /like/i.test(label.label)) ? 'Like action label exists, but count appears as adjacent text; omit likes until adjacency is proven across fixtures.' : null,
  ].filter(Boolean);

  const out = {
    meta: {
      probe: 'threads-contract-discovery',
      version: PROBE_VERSION,
      url: location.href,
      uiLang: document.documentElement.lang || null,
    },
    identity,
    metadata: {
      canonical,
      ogUrl: metaContent('meta[property="og:url"]'),
      ogTitle,
      ogDescription,
      documentTitle: document.title,
    },
    contractCandidates: {
      metadataPrimary: {
        platform: 'threads',
        platformCode: 'TH',
        sourceUrl: canonical,
        sourceId: identity?.sourceId || null,
        authorHandle: identity?.handle || displayFromTitle?.[2] || null,
        displayName: displayFromTitle?.[1] || null,
        text: ogDescription,
        titleBody,
        postedAt,
        likesCount: null,
        confidence: canonical && identity?.sourceId && ogDescription && displayFromTitle
          ? 'high_for_original_permalink'
          : 'incomplete',
      },
      renderedBodyCandidate,
      likes: {
        disposition: 'omit_until_adjacent_action_counts_are_proven',
        actionLabels: actionLabels.filter(label => /like/i.test(label.label)).slice(0, 8),
      },
    },
    roots: {
      articleCount: document.querySelectorAll('article').length,
      roleArticleCount: document.querySelectorAll('[role="article"]').length,
      dataTestIdCount: document.querySelectorAll('[data-testid]').length,
      regions,
    },
    sourceLinks,
    times,
    renderedTextCandidates,
    actionLabels,
    observations,
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
})();

