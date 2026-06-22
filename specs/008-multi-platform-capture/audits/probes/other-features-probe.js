(() => {
  const text = (value, limit = 200) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const attrs = (element, names) => Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]).filter(([, value]) => value !== null));
  const sanitizedHref = (value) => {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin ? url.pathname : `${url.origin}${url.pathname}`;
    } catch {
      return value.split(/[?#]/)[0] || null;
    }
  };
  const rectFor = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  };
  const intersectsViewport = (rect) =>
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0 &&
    rect.x < window.innerWidth &&
    rect.y < window.innerHeight;
  const meta = Array.from(document.querySelectorAll('meta[property], meta[name]')).map((element) => ({
    key: element.getAttribute('property') || element.getAttribute('name'),
    content: text(element.getAttribute('content'), 300)
  })).filter((entry) => /^(og:|twitter:|article:|description$|author$)/i.test(entry.key || ''));
  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((element, index) => {
    try {
      const parsed = JSON.parse(element.textContent || '{}');
      return {
        index,
        type: parsed['@type'] || null,
        hasAuthor: !!parsed.author,
        hasDatePublished: !!parsed.datePublished,
        hasUrl: !!parsed.url,
        keys: Object.keys(parsed).slice(0, 20)
      };
    } catch (error) {
      return { index, parseError: error instanceof Error ? error.message : String(error) };
    }
  });
  const hydration = Array.from(document.querySelectorAll('script[id], script[type="application/json"], script:not([src])')).map((element) => ({
    id: element.id || null,
    type: element.getAttribute('type') || null,
    textLength: (element.textContent || '').length,
    hasPostTerms: /post|thread|note|status|profile|author|handle/i.test(element.textContent || '')
  })).filter((entry) => entry.id || entry.type === 'application/json' || entry.hasPostTerms).slice(0, 30);
  const accessibleLabels = Array.from(document.querySelectorAll('[aria-label]')).map((element) => ({
    tag: element.tagName.toLowerCase(),
    attrs: attrs(element, ['role', 'data-testid', 'href']),
    label: text(element.getAttribute('aria-label'), 160)
  })).filter((entry) => /like|reply|repost|quote|bookmark|view|share|verified|protected|more|author|profile/i.test(entry.label)).slice(0, 80);
  const isViewerProfileNav = (entry) =>
    /^\/@[^/]+$/.test(entry.attrs.href || '') && (!entry.text || /^profile$/i.test(entry.text));
  const stableIdentifiers = Array.from(document.querySelectorAll('[data-testid], [role], time[datetime], a[href]')).map((element) => ({
    tag: element.tagName.toLowerCase(),
    attrs: attrs(element, ['data-testid', 'role', 'datetime', 'href', 'aria-label']),
    text: text(element.textContent, 120)
  })).filter((entry) =>
    !isViewerProfileNav(entry) &&
    (entry.attrs['data-testid'] || entry.attrs.datetime || /\/(status|post|note|notes|p|profile|@)/.test(entry.attrs.href || ''))
  ).slice(0, 120);
  const mediaElements = Array.from(document.querySelectorAll('video, img, canvas, [aria-label*="video" i], [aria-label*="play" i]')).map((element, index) => {
    const entry = {
      index,
      tag: element.tagName.toLowerCase(),
      attrs: attrs(element, ['alt', 'aria-label', 'role']),
      nearestHref: sanitizedHref(element.closest('a[href]')?.getAttribute('href')),
      text: text(element.textContent, 120),
      rect: rectFor(element)
    };
    return entry;
  }).filter((entry) =>
    !isViewerProfileNav({ attrs: { href: entry.nearestHref }, text: entry.text }) &&
    !/profile picture$/i.test(entry.attrs.alt || '') &&
    intersectsViewport(entry.rect)
  ).slice(0, 80);
  const out = {
    meta: {
      probe: 'other-features',
      version: '2026-06-21',
      url: location.href,
      uiLang: document.documentElement.getAttribute('lang') || null
    },
    canonical: document.querySelector('link[rel="canonical"]') ? document.querySelector('link[rel="canonical"]').href : null,
    metadata: meta,
    jsonLd,
    hydration,
    accessibleLabels,
    stableIdentifiers,
    media: {
      videoCount: mediaElements.filter((entry) => entry.tag === 'video').length,
      imageCount: mediaElements.filter((entry) => entry.tag === 'img').length,
      canvasCount: mediaElements.filter((entry) => entry.tag === 'canvas').length,
      documentVideoCount: document.querySelectorAll('video').length,
      documentImageCount: document.querySelectorAll('img').length,
      documentCanvasCount: document.querySelectorAll('canvas').length,
      elements: mediaElements
    }
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
