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
  const parseCount = (value) => {
    const compact = String(value || '').replace(/,/g, '').trim();
    const magnitude = compact.match(/^(\d[\d.]*)([KMB])$/i);
    if (magnitude) {
      const multiplier = magnitude[2].toUpperCase() === 'K' ? 1e3 : magnitude[2].toUpperCase() === 'M' ? 1e6 : 1e9;
      return Math.round(Number(magnitude[1]) * multiplier);
    }
    const numeric = compact.match(/^\d[\d.]*$/);
    return numeric ? Number(numeric[0]) : null;
  };
  const selectorForSourceId = (sourceId) => {
    if (!sourceId) return null;
    const escaped = sourceId.replace(/["\\]/g, '\\$&');
    return `a[href*="${escaped}"]`;
  };

  const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
  const locationIdentity = sourceFrom(location.href);
  const canonicalIdentity = sourceFrom(canonical);
  const identity = locationIdentity || canonicalIdentity;
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
  const primarySourceLink = sourceLinks[0] || null;

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
  const numericTextCandidates = renderedTextCandidates
    .filter(candidate => parseCount(candidate.text) !== null)
    .map(candidate => ({ ...candidate, parsedCount: parseCount(candidate.text) }));
  const focalActionLabels = primarySourceLink
    ? actionLabels.filter(label => label.rect.y > primarySourceLink.rect.y && label.rect.y < primarySourceLink.rect.y + 500)
    : actionLabels;
  const focalNumericTextCandidates = primarySourceLink
    ? numericTextCandidates.filter(candidate => candidate.rect.y > primarySourceLink.rect.y && candidate.rect.y < primarySourceLink.rect.y + 500)
    : numericTextCandidates;
  const actionCountFor = (actionName, nextActionNames) => {
    const action = focalActionLabels.find(label => new RegExp(`^${actionName}$`, 'i').test(label.label));
    if (!action) return null;
    const nextAction = focalActionLabels.find(label =>
      nextActionNames.some(name => new RegExp(`^${name}$`, 'i').test(label.label)) &&
      Math.abs(label.rect.y - action.rect.y) <= 8 &&
      label.rect.x > action.rect.x
    );
    const candidates = focalNumericTextCandidates.filter(candidate =>
      Math.abs(candidate.rect.y - action.rect.y) <= 8 &&
      candidate.rect.x > action.rect.x &&
      (!nextAction || candidate.rect.x < nextAction.rect.x)
    );
    const count = candidates[0] || null;
    return count ? {
      actionLabel: action.label,
      actionRect: { ...action.rect },
      nextActionLabel: nextAction?.label || null,
      nextActionRect: nextAction ? { ...nextAction.rect } : null,
      raw: count.text,
      value: count.parsedCount,
      countRect: { ...count.rect },
      confidence: nextAction ? 'candidate_adjacent_between_actions' : 'candidate_adjacent_after_action',
    } : null;
  };
  const cloneActionCount = (candidate) => candidate ? {
    ...candidate,
    actionRect: candidate.actionRect ? { ...candidate.actionRect } : null,
    nextActionRect: candidate.nextActionRect ? { ...candidate.nextActionRect } : null,
    countRect: candidate.countRect ? { ...candidate.countRect } : null,
  } : null;
  const actionCountCandidates = {
    likes: actionCountFor('Like', ['Reply', 'Comment']),
    replies: actionCountFor('Reply', ['Repost', 'Share']),
    reposts: actionCountFor('Repost', ['Share']),
  };

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
  const renderedFocalBySourceLink = primarySourceLink ? renderedTextCandidates.find(candidate =>
    candidate.hrefAncestor === null &&
    candidate.rect.y > primarySourceLink.rect.y &&
    candidate.rect.y < primarySourceLink.rect.y + 220 &&
    candidate.text !== primarySourceLink.text &&
    candidate.text !== identity?.handle &&
    !/^\d+(\.\d+)?[KMB]?$/i.test(candidate.text) &&
    !/^\d+[hm]$/.test(candidate.text) &&
    !/^reply to /i.test(candidate.text) &&
    !/^view activity/i.test(candidate.text) &&
    candidate.text !== 'More' &&
    candidate.text !== 'Follow'
  ) || null : null;
  const canonicalMatchesLocation = !!identity?.sourceId &&
    canonicalIdentity?.sourceId === identity.sourceId &&
    canonicalIdentity?.handle === identity.handle;

  const observations = [
    document.querySelectorAll('article').length === 0 ? 'No article elements in rendered Threads permalink DOM.' : null,
    document.querySelectorAll('[data-testid]').length === 0 ? 'No data-testid hooks in rendered Threads permalink DOM.' : null,
    document.querySelectorAll('[role="article"]').length === 0 ? 'No role=article hooks in rendered Threads permalink DOM.' : null,
    ogDescription && canonicalMatchesLocation ? 'og:description contains exact post body text for this permalink.' : null,
    ogDescription && !canonicalMatchesLocation ? 'Canonical/OG metadata points to a different post than the browser URL; treat it as parent context for this fixture.' : null,
    renderedFocalBySourceLink ? 'Focal rendered text candidate exists after the source-linked timestamp for the browser URL.' : null,
    renderedBodyCandidate ? 'Rendered body text exists as dir=auto text, but browser extraction may normalize/degrade characters.' : null,
    actionCountCandidates.likes ? 'Like count candidate exists between Like and Reply action icons; validate across low/zero and abbreviated/high-like fixtures before promotion.' : null,
  ].filter(Boolean);

  const out = {
    meta: {
      probe: 'threads-contract-discovery',
      version: PROBE_VERSION,
      url: location.href,
      uiLang: document.documentElement.lang || null,
    },
    identity: identity ? { ...identity } : null,
    locationIdentity: locationIdentity ? { ...locationIdentity } : null,
    canonicalIdentity: canonicalIdentity ? { ...canonicalIdentity } : null,
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
        confidence: canonicalMatchesLocation && canonical && identity?.sourceId && ogDescription && displayFromTitle
          ? 'high_for_original_permalink'
          : canonical && canonicalIdentity && locationIdentity && !canonicalMatchesLocation
            ? 'mismatch_parent_context'
            : 'incomplete',
      },
      sourceLinkedRendered: {
        platform: 'threads',
        platformCode: 'TH',
        sourceUrl: location.href,
        sourceId: locationIdentity?.sourceId || identity?.sourceId || null,
        authorHandle: locationIdentity?.handle || identity?.handle || null,
        text: renderedFocalBySourceLink?.text || null,
        postedAt,
        likesCount: cloneActionCount(actionCountCandidates.likes)?.value ?? null,
        confidence: renderedFocalBySourceLink && locationIdentity?.sourceId
          ? 'candidate_for_reply_or_context_permalink'
          : 'incomplete',
      },
      renderedBodyCandidate,
      likes: {
        disposition: actionCountCandidates.likes
          ? 'candidate_adjacent_action_count_needs_fixture_validation'
          : 'omit_until_adjacent_action_counts_are_proven',
        candidate: cloneActionCount(actionCountCandidates.likes),
        actionLabels: actionLabels
          .filter(label => /like/i.test(label.label))
          .slice(0, 8)
          .map(label => ({ ...label, rect: { ...label.rect } })),
      },
      actionCounts: {
        likes: cloneActionCount(actionCountCandidates.likes),
        replies: cloneActionCount(actionCountCandidates.replies),
        reposts: cloneActionCount(actionCountCandidates.reposts),
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
