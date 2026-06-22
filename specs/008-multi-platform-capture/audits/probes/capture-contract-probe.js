(() => {
  const PROBE_VERSION = '2026-06-21';
  const text = (value, limit = 200) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const parseNumber = (value) => {
    if (!value) return 0;
    const compact = String(value).replace(/,/g, '');
    const magnitude = compact.match(/(\d[\d.]*)\s*([KMB])(?![A-Za-z])/i);
    if (magnitude) {
      const multiplier = magnitude[2].toUpperCase() === 'K' ? 1e3 : magnitude[2].toUpperCase() === 'M' ? 1e6 : 1e9;
      return Math.round(Number(magnitude[1]) * multiplier);
    }
    const number = compact.replace(/[^\d.]/g, '').match(/\d[\d.]*/);
    return number ? Number(number[0]) : 0;
  };
  const cleanUrl = (value) => {
    try {
      const url = new URL(value);
      ['s', 't', 'ref_src', 'ref_url', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((param) => url.searchParams.delete(param));
      return url.toString();
    } catch {
      return value || '';
    }
  };
  const firstText = (root, selectors) => {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value = text(element && element.textContent);
      if (value) return { selector, value };
    }
    return { selector: null, value: '' };
  };
  const firstAttr = (root, selectors, attr) => {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value = element && element.getAttribute(attr);
      if (value) return { selector, value };
    }
    return { selector: null, value: null };
  };
  const normalizeHandle = (value) => {
    const cleaned = String(value || '').trim().replace(/^@/, '').replace(/^\/+|\/+$/g, '');
    return cleaned || null;
  };
  const handleFromHref = (href) => {
    if (!href) return null;
    try {
      const url = new URL(href, location.href);
      const threads = url.pathname.match(/\/@([^/]+)/);
      if (threads) return normalizeHandle(threads[1]);
      const bsky = url.pathname.match(/^\/profile\/([^/]+)/);
      if (bsky) return normalizeHandle(bsky[1]);
      const x = url.pathname.match(/^\/([^/]+)$/);
      if (x && !['home', 'i', 'settings', 'explore'].includes(x[1])) return normalizeHandle(x[1]);
    } catch {
      return null;
    }
    return null;
  };
  const likeCount = (value) => {
    const normalized = text(value, 300);
    const countPattern = '\\d[\\d,.]*\\s*[KMB]?';
    const beforeLike = normalized.match(new RegExp(`(${countPattern})(?=\\s+likes?\\b)`, 'i'));
    if (beforeLike) return parseNumber(beforeLike[1]);
    const afterLike = normalized.match(new RegExp(`\\blikes?\\b[^\\d]{0,20}(${countPattern})`, 'i'));
    if (afterLike) return parseNumber(afterLike[1]);
    return null;
  };
  const visibleLikes = (root, selectors) => {
    const elements = selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
    for (const element of elements) {
      const raw = element.getAttribute('aria-label') || element.textContent || '';
      if (/\d/.test(raw) && /likes?/i.test(raw)) {
        const parsed = likeCount(raw);
        if (parsed !== null) return { selector: selectors.find((selector) => element.matches(selector)) || null, raw: text(raw), value: parsed };
      }
    }
    return { selector: null, raw: null, value: null };
  };
  const sourceIdFromUrl = (urlValue, platform) => {
    try {
      const url = new URL(urlValue, location.href);
      if (platform === 'twitter') return (url.pathname.match(/\/status\/(\d+)/) || [])[1] || null;
      if (platform === 'threads') return (url.pathname.match(/\/(?:post|t)\/([^/?#]+)/) || [])[1] || null;
      if (platform === 'bluesky') return (url.pathname.match(/\/profile\/[^/]+\/post\/([^/?#]+)/) || [])[1] || null;
      if (platform === 'substack_notes') return (url.pathname.match(/\/(?:note|p)\/([^/?#]+)/) || url.pathname.match(/\/notes?\/([^/?#]+)/) || [])[1] || null;
    } catch {
      return null;
    }
    return null;
  };
  const platformFromLocation = () => {
    const host = location.hostname.toLowerCase();
    if (host === 'x.com' || host === 'twitter.com') return 'twitter';
    if (host === 'threads.com' || host === 'www.threads.com' || host === 'threads.net' || host === 'www.threads.net') return 'threads';
    if (host === 'bsky.app') return 'bluesky';
    if (host === 'substack.com' || host.endsWith('.substack.com')) return 'substack_notes';
    return null;
  };
  const configs = {
    twitter: {
      code: 'TX',
      rootSelectors: ['article[data-testid="tweet"]', 'article[role="article"]', 'div[data-testid="tweet"]', '[data-testid="primaryColumn"] article'],
      textSelectors: ['[data-testid="tweetText"]', '[data-testid="twitterArticleRichTextView"]', '[data-testid="longformRichTextComponent"]', '[lang]', 'div[dir="auto"]'],
      authorLinks: ['[data-testid="User-Name"] a[href*="/"]'],
      displaySelectors: ['[data-testid="User-Name"] span:first-child span', '[data-testid="User-Names"] span:first-child', '[role="link"][tabindex="-1"] span'],
      likeSelectors: ['[data-testid="like"]', '[data-testid="likeConfirm"]', '[aria-label*="like" i]'],
      idLinkSelector: 'a[href*="/status/"]'
    },
    threads: {
      code: 'TH',
      rootSelectors: ['article', '[role="article"]', '[data-testid*="post" i]', '[data-testid*="thread" i]'],
      textSelectors: ['[data-testid="post-text"]', '[data-testid="thread-text"]', '[data-testid*="post-text" i]', '[dir="auto"]'],
      authorLinks: ['a[href*="/@"]'],
      displaySelectors: ['[data-testid="post-author-name"]', '[data-testid*="author" i] [dir="auto"]', 'h1'],
      likeSelectors: ['[aria-label*="like" i]', '[data-testid*="like" i]', '[class*="like" i]'],
      idLinkSelector: 'a[href*="/post/"], a[href*="/t/"]'
    },
    bluesky: {
      code: 'BS',
      rootSelectors: ['[data-testid="postThreadItem"]', '[data-testid="post"]', 'article', '[role="article"]'],
      textSelectors: ['[data-testid="postText"]', '[data-testid*="post-text" i]', '[data-testid*="postContent" i]', '[dir="auto"]'],
      authorLinks: ['a[href*="/profile/"]'],
      displaySelectors: ['[data-testid="postAuthorDisplayName"]', '[data-testid*="author" i] [dir="auto"]', 'h1'],
      likeSelectors: ['[aria-label*="like" i]', '[data-testid*="like" i]', '[class*="like" i]'],
      idLinkSelector: 'a[href*="/post/"]'
    },
    substack_notes: {
      code: 'SS',
      rootSelectors: ['article', '[role="article"]', '[data-testid*="note" i]', '[class*="note" i]'],
      textSelectors: ['[data-testid="note-content"]', '[data-testid*="note" i] [dir="auto"]', '.available-content', '[dir="auto"]', 'article'],
      authorLinks: ['a[href*="/@"]', 'a[href*="/profile/"]'],
      displaySelectors: ['[data-testid*="author" i]', '.byline', 'h1'],
      likeSelectors: ['[aria-label*="like" i]', '[data-testid*="like" i]', '[class*="like" i]'],
      idLinkSelector: 'a[href*="/note/"], a[href*="/notes/"], a[href*="/p/"]'
    }
  };
  const platform = platformFromLocation();
  const config = platform && configs[platform];
  const canonical = document.querySelector('link[rel="canonical"]') && document.querySelector('link[rel="canonical"]').href;
  const sourceUrl = cleanUrl(canonical || location.href);
  const sourceId = config ? sourceIdFromUrl(sourceUrl, platform) || sourceIdFromUrl(location.href, platform) : null;
  const roots = config ? config.rootSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))) : [];
  const uniqueRoots = roots.filter((root, index) => roots.indexOf(root) === index);
  const focalByLink = sourceId ? uniqueRoots.find((root) => Array.from(root.querySelectorAll(config.idLinkSelector)).some((link) => sourceIdFromUrl(link.href || link.getAttribute('href'), platform) === sourceId)) : null;
  const root = focalByLink || uniqueRoots[0] || document.body;
  const textCandidate = config ? firstText(root, config.textSelectors) : { selector: null, value: '' };
  const authorLink = config ? config.authorLinks.map((selector) => root.querySelector(selector)).find(Boolean) : null;
  const authorHandleFromUrl = platform === 'threads' || platform === 'substack_notes' ? normalizeHandle((location.pathname.match(/\/@([^/]+)/) || [])[1]) : platform === 'bluesky' ? normalizeHandle((location.pathname.match(/^\/profile\/([^/]+)/) || [])[1]) : null;
  const authorHandle = authorHandleFromUrl || handleFromHref(authorLink && (authorLink.href || authorLink.getAttribute('href')));
  const displayName = config ? firstText(root, config.displaySelectors) : { selector: null, value: '' };
  const postedAt = firstAttr(root, ['time[datetime]'], 'datetime').value || (document.querySelector('meta[property="article:published_time"], meta[name="article:published_time"], meta[property="og:published_time"]') || {}).content || null;
  const likes = config ? visibleLikes(root, config.likeSelectors) : { selector: null, raw: null, value: null };
  const drift = [];
  if (!platform) drift.push('platform: unsupported host');
  if (config && uniqueRoots.length === 0) drift.push('root: no configured root selector matched');
  if (config && sourceId && !focalByLink) drift.push('root: no root contained a permalink for the URL sourceId');
  if (config && !sourceId) drift.push('sourceId: could not extract from canonical or location URL');
  if (config && !textCandidate.value) drift.push('text: no configured selector produced text');
  if (config && !authorHandle) drift.push('author: no handle from URL or configured links');
  const out = {
    meta: {
      probe: 'capture-contract',
      version: PROBE_VERSION,
      url: location.href,
      uiLang: document.documentElement.getAttribute('lang') || null
    },
    contract: {
      platform,
      platformCode: config ? config.code : null,
      sourceUrl,
      sourceId,
      text: textCandidate.value || null,
      author: {
        handle: authorHandle,
        displayName: displayName.value || authorHandle || null
      },
      postedAt,
      likesCount: likes.value,
      requiresSelection: platform === 'twitter' && !!root.querySelector('[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]'),
      platformData: sourceId ? { source_id: sourceId } : {}
    },
    selectors: {
      rootSelectorCount: uniqueRoots.length,
      focalRootFoundBySourceIdLink: !!focalByLink,
      textSelector: textCandidate.selector,
      authorSelector: authorLink ? config.authorLinks.find((selector) => authorLink.matches(selector)) || null : null,
      displaySelector: displayName.selector,
      likesSelector: likes.selector,
      likesRaw: likes.raw
    },
    drift
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
