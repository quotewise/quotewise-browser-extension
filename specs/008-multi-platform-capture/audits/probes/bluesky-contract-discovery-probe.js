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
    const match = url?.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!match) return null;
    const exactPermalink = url.pathname === `/profile/${match[1]}/post/${match[2]}`;
    return { handle: match[1], sourceId: match[2], url: url.toString(), exactPermalink };
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
  const locationIdentity = sourceFrom(location.href);
  const sourceId = locationIdentity?.sourceId || null;
  const handle = locationIdentity?.handle || null;
  const allSourceLinks = Array.from(document.querySelectorAll('a[href]'))
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
  const sourceLinksForLocation = allSourceLinks.filter((link) =>
    link.source?.sourceId === sourceId &&
    link.source?.handle === handle);
  const visibleThreadItems = Array.from(document.querySelectorAll('[data-testid^="postThreadItem-by-"]'))
    .map((element, index) => {
      const rect = rectFor(element);
      return {
        element,
        index,
        tag: element.tagName.toLowerCase(),
        attrs: attrs(element, ['data-testid', 'role', 'aria-label']),
        text: clean(element.textContent, 900),
        rect,
        visible: isVisible(rect),
      };
    })
    .filter((entry) => entry.visible);
  const focalRoot = visibleThreadItems.find((entry) =>
    entry.attrs['data-testid'] === `postThreadItem-by-${handle}` &&
    Array.from(entry.element.querySelectorAll('a[href]')).some((link) => {
      const source = sourceFrom(link.getAttribute('href'));
      return source?.sourceId === sourceId && source?.handle === handle;
    })) ||
    visibleThreadItems.find((entry) =>
      entry.attrs['data-testid'] === `postThreadItem-by-${handle}`) ||
    visibleThreadItems.find((entry) => entry.text.includes(`@${handle}`)) ||
    null;
  const isActionOrChromeText = (value) =>
    !value ||
    value === 'Post' ||
    value === 'Follow' ||
    value === 'Write your reply' ||
    /^Everybody can reply$/i.test(value) ||
    /^\d+$/.test(value) ||
    /^\d[\d,.]*\s+(likes?|reposts?|replies?)$/i.test(value) ||
    /^\d{1,2}:\d{2}\s+[AP]M\s+·\s+/i.test(value);
  const textCandidateElements = focalRoot ? Array.from(focalRoot.element.querySelectorAll('div, span, a'))
    .map((element, index) => {
      const rect = rectFor(element);
      const text = clean(element.textContent, 1000);
      const hrefAncestor = element.closest('a[href]')?.getAttribute('href') || null;
      const hrefPath = hrefAncestor ? parseUrl(hrefAncestor)?.pathname || hrefAncestor : null;
      return {
        index,
        tag: element.tagName.toLowerCase(),
        attrs: attrs(element, ['data-testid', 'role', 'aria-label']),
        text,
        hrefAncestor,
        hrefPath,
        buttonAncestor: !!element.closest('button'),
        rect,
        visible: isVisible(rect),
      };
    })
    .filter((candidate) =>
      candidate.visible &&
      (!candidate.hrefAncestor || candidate.hrefPath?.startsWith('/hashtag/')) &&
      !candidate.buttonAncestor &&
      candidate.text.length > 20 &&
      !candidate.text.includes(`@${handle}`) &&
      candidate.text !== 'Follow' &&
      !candidate.text.includes('Everybody can reply') &&
      !/\d{1,2}:\d{2}\s+[AP]M\s+·\s+/i.test(candidate.text) &&
      !/\d[\d,.]*\s+likes?\b/i.test(candidate.text) &&
      !isActionOrChromeText(candidate.text))
    .sort((a, b) =>
      a.rect.y - b.rect.y ||
      Number(!!a.hrefAncestor) - Number(!!b.hrefAncestor) ||
      (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height) ||
      a.text.length - b.text.length) : [];
  const smallestTextCandidates = [];
  const seenTextCandidates = new Set();
  for (const candidate of textCandidateElements) {
    if (seenTextCandidates.has(candidate.text)) continue;
    seenTextCandidates.add(candidate.text);
    smallestTextCandidates.push(candidate);
    if (smallestTextCandidates.length >= 20) break;
  }
  const bodyCandidate = smallestTextCandidates[0] || null;
  const authorLink = focalRoot ? Array.from(focalRoot.element.querySelectorAll('a[href^="/profile/"]'))
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
      link.attrs.href === `/profile/${handle}` &&
      link.attrs['aria-label'] &&
      !/avatar/i.test(link.attrs['aria-label'])) || null : null;
  const dateLabels = [
    ...sourceLinksForLocation.map((link) => ({
      source: 'exact_permalink_link_aria_label',
      value: link.attrs['aria-label'] || null,
      rect: { ...link.rect },
      visible: link.visible,
    })),
    ...(focalRoot ? Array.from(focalRoot.element.querySelectorAll('div, span'))
      .map((element) => {
        const rect = rectFor(element);
        return { source: 'visible_text', value: clean(element.textContent, 120), rect, visible: isVisible(rect) };
      })
      .filter((entry) => entry.visible && /\b[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\b/.test(entry.value)) : []),
  ].filter((entry) => entry.value).slice(0, 12);
  const likeCandidates = focalRoot ? Array.from(focalRoot.element.querySelectorAll('[data-testid*="like" i], [aria-label*="like" i], a[href$="/liked-by"]'))
    .map((element, index) => {
      const rect = rectFor(element);
      const raw = element.getAttribute('aria-label') || clean(element.textContent, 120);
      return {
        index,
        tag: element.tagName.toLowerCase(),
        attrs: attrs(element, ['data-testid', 'role', 'aria-label', 'href']),
        raw,
        text: clean(element.textContent, 120),
        parsedCount: /likes?/i.test(raw) && /\d/.test(raw) ? parseCount(raw) : null,
        rect,
        visible: isVisible(rect),
      };
    })
    .filter((candidate) => candidate.visible && /likes?/i.test(candidate.raw))
    .slice(0, 20) : [];
  const primaryLikeCandidate = likeCandidates.find((candidate) => candidate.attrs['data-testid'] === 'likeCount-expanded') ||
    likeCandidates.find((candidate) => candidate.attrs['data-testid'] === 'likeBtn') ||
    likeCandidates.find((candidate) => candidate.parsedCount !== null) ||
    null;
  const countCandidate = (testId) => {
    if (!focalRoot) return null;
    const element = focalRoot.element.querySelector(`[data-testid="${testId}"]`);
    if (!element) return null;
    const rect = rectFor(element);
    const raw = element.getAttribute('aria-label') || clean(element.textContent, 120);
    return {
      tag: element.tagName.toLowerCase(),
      attrs: attrs(element, ['data-testid', 'role', 'aria-label', 'href']),
      raw,
      text: clean(element.textContent, 120),
      parsedCount: /\d/.test(raw) ? parseCount(raw) : null,
      rect,
      visible: isVisible(rect),
    };
  };
  const actionCounts = {
    replies: countCandidate('replyBtn'),
    reposts: countCandidate('repostBtn'),
    likes: countCandidate('likeBtn'),
    repostsExpanded: countCandidate('repostCount-expanded'),
    quotesExpanded: countCandidate('quoteCount-expanded'),
    likesExpanded: countCandidate('likeCount-expanded'),
    savesExpanded: countCandidate('bookmarkCount-expanded'),
  };
  const attachmentEvidence = focalRoot ? (() => {
    const externalLinks = Array.from(focalRoot.element.querySelectorAll('a[href]'))
      .map((link, index) => {
        const rect = rectFor(link);
        const url = parseUrl(link.getAttribute('href'));
        const href = url ? `${url.origin}${url.pathname}` : link.getAttribute('href');
        return {
          index,
          tag: link.tagName.toLowerCase(),
          attrs: attrs(link, ['role', 'aria-label', 'data-testid']),
          href,
          text: clean(link.textContent, 500),
          rect,
          visible: isVisible(rect),
        };
      })
      .filter((link) =>
        link.visible &&
        link.href &&
        parseUrl(link.href)?.origin !== location.origin)
      .slice(0, 20);
    const hashtags = Array.from(focalRoot.element.querySelectorAll('a[href^="/hashtag/"]'))
      .map((link, index) => {
        const rect = rectFor(link);
        return {
          index,
          tag: link.tagName.toLowerCase(),
          attrs: attrs(link, ['role', 'aria-label', 'data-testid']),
          href: link.getAttribute('href'),
          text: clean(link.textContent, 120),
          rect,
          visible: isVisible(rect),
        };
      })
      .filter((link) => link.visible)
      .slice(0, 20);
    const mediaElements = Array.from(focalRoot.element.querySelectorAll('img, video, canvas, [aria-label*="image" i], [aria-label*="video" i]'))
      .map((element, index) => {
        const rect = rectFor(element);
        const nearestLink = element.closest('a[href]');
        const nearestUrl = nearestLink ? parseUrl(nearestLink.getAttribute('href')) : null;
        return {
          index,
          tag: element.tagName.toLowerCase(),
          attrs: attrs(element, ['alt', 'role', 'aria-label', 'data-testid']),
          nearestHref: nearestUrl ? `${nearestUrl.origin}${nearestUrl.pathname}` : nearestLink?.getAttribute('href') || null,
          text: clean(element.textContent, 240),
          rect,
          visible: isVisible(rect),
        };
      })
      .filter((entry) =>
        entry.visible &&
        !entry.nearestHref?.startsWith(`${location.origin}/profile/${handle}`) &&
        !/avatar/i.test(entry.attrs['aria-label'] || entry.attrs.alt || ''))
      .slice(0, 40);
    return {
      externalLinks,
      hashtags,
      mediaElements,
      hasExternalLink: externalLinks.length > 0,
      hasHashtags: hashtags.length > 0,
      hasVisibleMedia: mediaElements.length > 0,
    };
  })() : { externalLinks: [], hashtags: [], mediaElements: [], hasExternalLink: false, hasHashtags: false, hasVisibleMedia: false };
  const cloneLikeCandidate = (candidate) => candidate ? ({
    index: candidate.index,
    tag: candidate.tag,
    attrs: { ...candidate.attrs },
    raw: candidate.raw,
    text: candidate.text,
    parsedCount: candidate.parsedCount,
    rect: { ...candidate.rect },
    visible: candidate.visible,
  }) : null;
  const currentAdapterRoot = (() => {
    if (!sourceId) return null;
    const escaped = sourceId.replace(/["\\]/g, '\\$&');
    const link = document.querySelector(`a[href*="${escaped}"]`);
    const root = link?.closest('article, [role="article"], [data-testid*="post" i], [data-testid*="thread" i]') ||
      document.querySelector('[data-testid="postThreadItem"], [data-testid="post"], article, [role="article"]') ||
      document.body;
    const rect = rectFor(root);
    const text = root.querySelector('[data-testid="postText"]')?.textContent ||
      root.querySelector('[data-testid*="post-text" i]')?.textContent ||
      root.querySelector('[data-testid*="postContent" i]')?.textContent ||
      root.querySelector('[dir="auto"]')?.textContent ||
      '';
    const like = Array.from(root.querySelectorAll('[aria-label*="like" i], [aria-label*="likes" i], [data-testid*="like" i], [class*="like" i]'))
      .map((element) => element.getAttribute('aria-label') || element.textContent || '')
      .find((raw) => /\d/.test(raw) && /likes?/i.test(raw)) || null;
    return {
      tag: root.tagName.toLowerCase(),
      attrs: attrs(root, ['data-testid', 'role', 'aria-label']),
      rect,
      visible: isVisible(rect),
      textCandidate: clean(text, 300),
      likeCandidate: clean(like, 120),
    };
  })();
  const observations = [
    document.querySelectorAll('article').length === 0 ? 'No article elements in rendered Bluesky permalink DOM.' : null,
    document.querySelectorAll('time[datetime]').length === 0 ? 'No time[datetime] hooks in rendered Bluesky permalink DOM.' : null,
    document.querySelectorAll('[data-testid="postThreadItem"]').length === 0 ? 'No exact data-testid=postThreadItem hook; live root uses postThreadItem-by-{handle}.' : null,
    document.querySelectorAll('[data-testid="postAuthorDisplayName"]').length === 0 ? 'No postAuthorDisplayName hook on this live permalink.' : null,
    document.querySelectorAll('[data-testid="postText"]').length > 0 ? 'Document contains postText hooks, but they can belong to hidden feed content and must be scoped to the visible focal root.' : null,
    canonical === 'https://bsky.app/' || canonical === 'https://bsky.app' ? 'Canonical metadata points to bsky.app root, not the permalink.' : null,
    bodyCandidate ? 'Visible focal body candidate exists inside postThreadItem-by-{handle} root.' : null,
    primaryLikeCandidate?.parsedCount !== null ? 'Visible like count candidate exists inside focal root.' : null,
    attachmentEvidence.hasExternalLink ? 'External link-card candidate exists inside focal root.' : null,
    attachmentEvidence.hasHashtags ? 'Hashtag candidates exist inside focal root.' : null,
    attachmentEvidence.hasVisibleMedia ? 'Visible media candidate exists inside focal root.' : null,
  ].filter(Boolean);
  const out = {
    meta: {
      probe: 'bluesky-contract-discovery',
      version: PROBE_VERSION,
      url: location.href,
      uiLang: document.documentElement.lang || null,
    },
    identity: locationIdentity ? { ...locationIdentity } : null,
    metadata: {
      canonical,
      ogUrl: metaContent('meta[property="og:url"]'),
      ogTitle: metaContent('meta[property="og:title"]'),
      ogDescription: metaContent('meta[property="og:description"]') || metaContent('meta[name="description"]'),
      documentTitle: document.title,
    },
    roots: {
      articleCount: document.querySelectorAll('article').length,
      roleArticleCount: document.querySelectorAll('[role="article"]').length,
      postThreadItemCount: document.querySelectorAll('[data-testid="postThreadItem"]').length,
      postThreadItemByCount: document.querySelectorAll('[data-testid^="postThreadItem-by-"]').length,
      postTextCount: document.querySelectorAll('[data-testid="postText"]').length,
      postAuthorDisplayNameCount: document.querySelectorAll('[data-testid="postAuthorDisplayName"]').length,
      timeDateTimeCount: document.querySelectorAll('time[datetime]').length,
    },
    contractCandidates: {
      metadataPrimary: {
        platform: 'bluesky',
        platformCode: 'BS',
        sourceUrl: canonical,
        sourceId,
        authorHandle: handle,
        text: metaContent('meta[property="og:description"]') || metaContent('meta[name="description"]'),
        confidence: canonical && sourceFrom(canonical)?.sourceId === sourceId ? 'candidate' : 'incomplete_or_root_metadata',
      },
      visibleThreadItem: {
        platform: 'bluesky',
        platformCode: 'BS',
        sourceUrl: location.href,
        sourceId,
        authorHandle: handle,
        displayName: authorLink?.attrs['aria-label'] || null,
        profileText: authorLink?.text || null,
        text: bodyCandidate?.text || null,
        postedAt: null,
        postedAtEvidence: dateLabels,
        likesCount: primaryLikeCandidate?.parsedCount ?? null,
        confidence: focalRoot && bodyCandidate && handle && sourceId ? 'candidate_visible_focal_root' : 'incomplete',
      },
      currentAdapterMimic: currentAdapterRoot,
      actionCounts,
      likes: {
        disposition: primaryLikeCandidate?.parsedCount !== null
          ? 'candidate_visible_focal_root_like_count_needs_more_fixtures'
          : 'omit_until_reliable',
        candidate: cloneLikeCandidate(primaryLikeCandidate),
        candidates: likeCandidates.map(cloneLikeCandidate),
      },
      attachments: attachmentEvidence,
    },
    sourceLinks: allSourceLinks.map((link) => ({ ...link, source: link.source ? { ...link.source } : null, rect: { ...link.rect } })).slice(0, 120),
    visibleThreadItems: visibleThreadItems.map((entry) => ({
      index: entry.index,
      tag: entry.tag,
      attrs: entry.attrs,
      text: entry.text,
      rect: { ...entry.rect },
      visible: entry.visible,
    })).slice(0, 40),
    bodyTextCandidates: smallestTextCandidates.map((candidate) => ({ ...candidate, rect: { ...candidate.rect } })),
    observations,
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
})();
