(() => {
  const text = (value, limit = 200) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const attrs = (element, names) => Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]).filter(([, value]) => value !== null));
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
  const stableIdentifiers = Array.from(document.querySelectorAll('[data-testid], [role], time[datetime], a[href]')).map((element) => ({
    tag: element.tagName.toLowerCase(),
    attrs: attrs(element, ['data-testid', 'role', 'datetime', 'href', 'aria-label']),
    text: text(element.textContent, 120)
  })).filter((entry) => entry.attrs['data-testid'] || entry.attrs.datetime || /\/(status|post|note|notes|p|profile|@)/.test(entry.attrs.href || '')).slice(0, 120);
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
    stableIdentifiers
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();

