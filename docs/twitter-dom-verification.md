# Twitter/X DOM-parsing verification

**Purpose.** The extension scrapes Twitter/X almost entirely through `data-testid` selectors and structural
assumptions (see `src/platforms/twitter/adapter.ts`, `src/content/common.ts`,
`src/content/ui/components/quote-preview.ts`). X changes its DOM **without notice**, silently breaking
selectors. This doc is a **re-runnable verification battery** — point a browser agent at live x.com,
run two read-only probes across a set of representative page situations, and compare the output against the
expected assumptions to detect drift. Re-run it whenever capture misbehaves, before a release, or on a
cadence.

It serves two roles:
1. **Methodology / regression test** (sections 1–5) — reusable, version-controlled.
2. **Findings snapshot** (section 6) — what was true on a given run date.

> This is a **verification** tool. It changes nothing. Confirmed drift is fixed separately (TDD), tracked in beads.

---

## 1. How it runs

A **browser agent** (or a human in DevTools) executes page-context JavaScript in a **logged-in** browser
and returns the JSON. Hard constraints:

- Probes run in the **page's main world** — NOT the extension's content-script isolated world, NOT the
  service worker. They cannot call our adapter or read `chrome.storage`/`chrome.runtime`. So each probe
  **re-implements the adapter's selectors against `document`** and reports the RAW DOM it hits.
- The agent is logged in (can see protected/subscription/article content the account has access to).
- **English UI required** — aria-based checks (View/Bookmark/Verified/Protected/reposted) assume English
  accessibility labels. `meta.uiLang` records the UI language; if not English, aria assertions are invalid.
- **Do not** like/retweet/reply/post to test transient states (`likeConfirm`/`retweetConfirm`) — verify the
  base selectors instead.
- Some agents have a **DLP/redaction layer** that blocks values it flags as "Sensitive key" or
  "Base64 encoded data" (it has redacted `data-testid` values and URLs in past runs). The probes avoid
  emitting profile/avatar URLs for this reason; if a field comes back `[BLOCKED…]`, the functional booleans
  are still usable.

### Intro to give the browser agent first

> We maintain a Chrome extension that extracts data from Twitter/X posts by reading the page DOM. X changes
> its DOM without notice, which silently breaks our selectors. We're running a **read-only audit**. I'll give
> you labeled situations (S1, S2, …), each with an **x.com URL** and a **JavaScript snippet**. For each:
> navigate to the URL, open the console, paste the snippet exactly, and return its **full JSON output
> verbatim** (don't summarize or drop fields; pay attention to the `drift` array; paste any error). Some
> situations ask you to **highlight text first**, then run a second snippet — I'll say when. Rules: the
> snippets are read-only diagnostics — **do not** click, like, repost, reply, post, or change anything;
> keep the page in **English**; run one situation at a time and wait for the next.

### Soundness check

Run **S1 (a plain text tweet)** first. Every primary selector should match (`articleDiscovery.primaryMatched:true`,
`tweetText.tier:"tweetText"`, metrics `via:"aria"`) with a near-empty `drift[]`. If S1 shows unexpected drift,
the **probe** (not X) is suspect — reconcile against `adapter.ts` before trusting the rest.

---

## 2. Situation matrix

Supply one URL per row. S16 reuses S1/S9/S10.

| # | Situation | Validates |
|---|-----------|-----------|
| S1 | Plain text tweet (original, no media) | discovery+scoring, tweetText primary, author, tweetId, all metrics, date, lang, type |
| S2 | Photo tweet | `tweetPhoto`; tweetId skips `/photo/` |
| S3 | Video tweet | `video`; tweetId skips `/video/`; interactive-skip |
| S4 | Reply viewed directly | focal reply wins scoring; reply detection |
| S5 | Self-thread (head opened) | URL-id match dominates |
| S6 | Repost / Retweet | retweeter via `socialContext`; type=retweet |
| S7 | Quote tweet | `quoteTweet` detection; quotes metric; `quotedTweet` −500; text from OUTER |
| S8 | Verified author | `icon-verified` / aria Verified |
| S9 | Long-form X Article | `detectArticle` (3 testids); body via read-view; selection |
| S10 | Subscription / Subscribe-CTA | `isSubscribeCta` skip; non-null guard |
| S11 | Protected account | `icon-lock` / aria Protected |
| S12 | Viral (1M+ views, K/M counts) | `parseNumber` K/M; aria vs text |
| S13 | Non-English / RTL | `[lang]`; RTL `dir`; English aria on foreign tweet |
| S14 | Zero/low-metric | parsed 0 vs selector-missing |
| S15 | **Negative control** — non-status page | `adapterWouldMatch:false`; no over-activation |
| S16 | Selection probes (on S1/S9/S10) | `isSelectionWithinPostContent`: honor in-post, reject chrome |

---

## 3. Probe A — comprehensive DOM audit

Run on each `/status/` URL. Reports, per assumption: whether the **primary** selector matched, which
**fallback** fired (drift early-warning), the matched node's tag/testid/attrs/short-text, the extracted value,
and an assembled `drift[]`. Mirrors adapter scoping (article-scoped everywhere **except** `socialContext`,
which the adapter queries at **document** scope).

```js
(() => {
  const T = (s, n = 120) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const parseNumberReal = (s) => { if (!s) return 0; const n = parseFloat(String(s).replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n; };
  const humanParse = (s) => { if (!s) return 0; const t = String(s).replace(/,/g, ''); const m = t.match(/(\d[\d.]*)([KMB])(?![A-Za-z])/i); if (m) { const n = parseFloat(m[1]); const suf = m[2].toUpperCase(); return n * (suf === 'K' ? 1e3 : suf === 'M' ? 1e6 : 1e9); } const m2 = t.match(/\d[\d.]*/); return m2 ? parseFloat(m2[0]) : 0; };
  const tid = (el) => el && el.closest && el.closest('[data-testid]') ? el.closest('[data-testid]').getAttribute('data-testid') : null;
  const extractHandle = (href) => { if (!href) return null; const m = href.match(/twitter\.com\/([^/?]+)/i) || href.match(/x\.com\/([^/?]+)/i); return m ? m[1] : null; };
  const idFromArticle = (a) => {
    const tl = a.querySelector('a[href*="/status/"] time')?.parentElement;
    if (tl && tl.href) { const m = tl.href.match(/status\/(\d+)/); if (m) return { id: m[1], via: 'time-anchor', href: tl.href }; }
    for (const l of a.querySelectorAll('a[href*="/status/"]')) { const h = l.href; if (h.includes('/photo/') || h.includes('/video/')) continue; const m = h.match(/status\/(\d+)/); if (m) return { id: m[1], via: 'status-link', href: h }; }
    return { id: null, via: null, href: null };
  };

  const urlId = (location.href.match(/status\/(\d+)/) || [])[1] || null;
  const out = { meta: { url: location.href, tweetIdFromUrl: urlId, adapterWouldMatch: /^(x|twitter)\.com$/.test(location.hostname) && /^\/[^/]+\/status\/\d+/.test(location.pathname), uiLang: document.documentElement.getAttribute('lang') || null }, drift: [] };

  const discSels = ['article[data-testid="tweet"]', 'article[role="article"]', 'div[data-testid="tweet"]', '[data-testid="primaryColumn"] article'];
  const arts = []; const firstSelFor = new Map();
  discSels.forEach(s => document.querySelectorAll(s).forEach(e => { if (!arts.includes(e)) { arts.push(e); firstSelFor.set(e, s); } }));
  const pc = document.querySelector('[data-testid="primaryColumn"]');
  const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
  const score = (a, i) => { const b = {}; let p = 0; const aid = idFromArticle(a).id;
    if (urlId && aid === urlId) { p += 1000; b.urlIdMatch = 1000; }
    if (pc && pc.contains(a) && pc.querySelectorAll('article[data-testid="tweet"]')[0] === a) { p += 100; b.primaryColumnFirst = 100; }
    const cell = a.closest('[data-testid="cellInnerDiv"]'); if (cell && cells[0] === cell) { p += 50; b.firstCell = 50; }
    if (a.getAttribute('tabindex') === '0') { p += 25; b.tabindex0 = 25; }
    p += Math.max(0, 10 - i); b.domOrder = Math.max(0, 10 - i);
    if (a.closest('[data-testid="quotedTweet"]')) { p -= 500; b.quotedTweetPenalty = -500; }
    if (a.parentElement?.previousElementSibling?.querySelector('[data-testid="socialContext"]')) { p -= 50; b.socialSiblingPenalty = -50; }
    return { p, b }; };
  const scored = arts.map((a, i) => { const s = score(a, i); return { i, selectorMatched: firstSelFor.get(a), tag: a.tagName.toLowerCase(), tweetId: idFromArticle(a).id, score: s.p, breakdown: s.b }; });
  scored.sort((x, y) => y.score - x.score);
  const winner = arts[scored[0]?.i];
  out.articleDiscovery = { candidateCount: arts.length, candidates: scored.slice(0, 6), winnerTweetId: scored[0]?.tweetId ?? null, primaryMatched: document.querySelectorAll('article[data-testid="tweet"]').length > 0, winnerMatchesUrl: !!urlId && scored[0]?.tweetId === urlId };
  if (!out.articleDiscovery.primaryMatched && arts.length) out.drift.push('discovery: primary missed; fell back to ' + scored[0]?.selectorMatched);
  if (urlId && !out.articleDiscovery.winnerMatchesUrl) out.drift.push('discovery: winner tweetId != URL id');
  if (!winner) { console.log(JSON.stringify(out, null, 2)); return out; }
  const A = winner;

  out.tweetId = idFromArticle(A);
  if (out.tweetId.via === 'status-link') out.drift.push('tweetId: time-anchor missed, used status-link fallback');
  if (out.tweetId.href && /\/(photo|video)\//.test(out.tweetId.href)) out.drift.push('tweetId: sourceHref contains /photo|/video (skip failed)');

  const tt = A.querySelector('[data-testid="tweetText"]');
  let text = null, tier = null, node = null; const skippedCta = { hit: false, text: null }; let skippedInteractive = 0;
  if (tt && (tt.textContent || '').trim()) { text = tt.textContent.trim(); tier = 'tweetText'; node = tt; }
  if (!text) { const ab = A.querySelector('[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]'); if (ab && (ab.textContent || '').trim()) { text = ab.textContent.trim(); tier = 'articleBody'; node = ab; } }
  if (!text) { let firstAny = null;
    outer: for (const sel of ['[lang]', 'div[dir="auto"]', 'article span[lang]']) {
      for (const n of A.querySelectorAll(sel)) { const t = (n.textContent || '').trim(); if (!t) continue;
        if (firstAny === null) firstAny = { t, n };
        if (n.closest('button, [role="button"], [data-testid="placementTracking"]')) { skippedInteractive++; continue; }
        if (t.length < 80 && /^(click to )?subscribe to /i.test(t)) { skippedCta.hit = true; skippedCta.text = T(t, 60); continue; }
        text = t; tier = 'fallback-' + sel; node = n; break outer; } }
    if (!text && firstAny) { text = firstAny.t; tier = 'firstAnyText'; node = firstAny.n; } }
  out.tweetText = { tier, primaryMatched: !!tt, value: T(text, 200), matchedNode: node ? { tag: node.tagName.toLowerCase(), testid: tid(node), dir: node.getAttribute('dir'), lang: node.getAttribute('lang') } : null, skippedInteractive, skippedSubscribeCta: skippedCta };
  if (tier && tier.startsWith('fallback')) out.drift.push('tweetText: primary+articleBody missed, used ' + tier);
  if (tier === 'firstAnyText') out.drift.push('tweetText: nothing usable, returned firstAnyText (likely CTA/UI)');

  const uLink = A.querySelector('[data-testid="User-Name"] a[href*="/"]'); const uhref = uLink ? uLink.href : '';
  const uname = extractHandle(uhref);
  const dnTiers = [['User-Name span:first span', '[data-testid="User-Name"] span:first-child span'], ['User-Names span:first', '[data-testid="User-Names"] span:first-child'], ['role=link tabindex=-1 span', '[role="link"][tabindex="-1"] span']];
  let dnTier = null; for (const [label, s] of dnTiers) { const e = A.querySelector(s); if (e && (e.textContent || '').trim()) { dnTier = label; break; } }
  const ver = A.querySelector('[data-testid="icon-verified"]') ? 'icon-verified' : (A.querySelector('svg[aria-label*="Verified"]') ? 'aria-Verified' : null);
  const avImg = A.querySelector('[data-testid="Tweet-User-Avatar"] img, [data-testid="UserAvatar-Container-unknown"] img');
  const av = A.querySelector('[data-testid="Tweet-User-Avatar"] img') ? 'Tweet-User-Avatar' : (A.querySelector('[data-testid="UserAvatar-Container-unknown"] img') ? 'UserAvatar-Container-unknown' : null);
  const sc = document.querySelector('[data-testid="socialContext"]'); const scText = sc ? (sc.textContent || '').toLowerCase() : '';
  const rtWord = scText.includes('reposted') ? 'reposted' : (scText.includes('retweeted') ? 'retweeted' : null);
  const rtLink = sc && sc.querySelector('a[href*="/"]');
  out.acct = { handle: uname, handleFlavor: /x\.com/.test(uhref) ? 'x.com' : (/twitter\.com/.test(uhref) ? 'twitter.com' : null), userNameLinkFound: !!uLink, displayTier: dnTier, displayFound: !!dnTier, verifiedVia: ver, avatarVia: av, avatarHttp: !!(avImg && /^http/.test(avImg.src || '')), repost: { present: !!rtWord, word: rtWord, handle: rtWord ? extractHandle(rtLink && rtLink.href) : null, nameFound: !!(rtWord && rtLink) } };
  if (uLink && !uname) out.drift.push('acct: User-Name link found but handle regex yielded null');
  if (!uLink) out.drift.push('acct: [data-testid=User-Name] link MISSED');
  if (!dnTier) out.drift.push('acct: displayName missed all 3 tiers');

  const metricSels = { replies: { sels: ['[data-testid="reply"]'], hints: [] }, retweets: { sels: ['[data-testid="retweet"]', '[data-testid="retweetConfirm"]'], hints: [] }, likes: { sels: ['[data-testid="like"]', '[data-testid="likeConfirm"]'], hints: [] }, bookmarks: { sels: ['[data-testid="bookmark"]', '[aria-label*="Bookmark"]'], hints: ['bookmark'] }, views: { sels: ['[aria-label*="View"]', '[data-testid="app-text-transition-container"]'], hints: ['view'] }, quotes: { sels: ['[data-testid="quoteTweet"] [data-testid="app-text-transition-container"]'], hints: [] } };
  out.metrics = {};
  for (const [k, cfg] of Object.entries(metricSels)) { let res = { selectorThatMatched: null, raw: null, parsed: 0, via: null, suspectLossy: false };
    for (const sel of cfg.sels) { for (const el of A.querySelectorAll(sel)) { const cands = [el, ...el.querySelectorAll('[data-testid="app-text-transition-container"]')];
        for (const c of cands) { const aria = c.getAttribute('aria-label'); const txt = aria || c.textContent || ''; const lw = txt.toLowerCase();
          if (cfg.hints.length === 0 || cfg.hints.some(h => lw.includes(h)) || /\d/.test(txt)) { const p = parseNumberReal(txt); if (p >= 0) { res = { selectorThatMatched: sel, raw: T(txt, 60), parsed: p, via: aria ? 'aria' : 'text', suspectLossy: Math.abs(humanParse(txt) - p) > 0.5 }; break; } } }
        if (res.selectorThatMatched) break; } if (res.selectorThatMatched) break; }
    out.metrics[k] = res;
    if (res.suspectLossy) out.drift.push(`metrics.${k}: lossy raw="${res.raw}" -> ${res.parsed} (human ~${humanParse(res.raw)})`); }

  const time = A.querySelector('time');
  out.date = { datetime: time && time.getAttribute('datetime'), source: time ? (time.getAttribute('datetime') ? 'datetime' : (time.getAttribute('aria-label') ? 'aria-label' : null)) : null };
  if (time && !time.getAttribute('datetime')) out.drift.push('date: no datetime attr (aria-label fallback)');
  const langNode = A.querySelector('[lang]'); out.language = { value: langNode && langNode.getAttribute('lang') };
  out.protected = { via: A.querySelector('[data-testid="icon-lock"]') ? 'icon-lock' : (A.querySelector('svg[aria-label*="Protected"]') ? 'aria-Protected' : (A.querySelector('[aria-label*="Protected account"]') ? 'aria-Protected-account' : null)) };
  out.media = { photo: !!A.querySelector('[data-testid="tweetPhoto"]'), video: !!A.querySelector('video'), audio: !!A.querySelector('audio') };
  const ttSig = { quotedTweet: !!A.querySelector('[data-testid="quoteTweet"]'), hasRetweeter: !!rtWord, replyTestid: !!A.querySelector('[data-testid="reply"]'), replyingToText: (A.textContent || '').includes('Replying to') };
  out.tweetType = { value: ttSig.quotedTweet ? 'quote' : ttSig.hasRetweeter ? 'retweet' : (ttSig.replyTestid || ttSig.replyingToText) ? 'reply' : 'original', signals: ttSig };
  if (out.tweetType.value === 'reply' && ttSig.replyTestid && !ttSig.replyingToText && !ttSig.hasRetweeter) out.drift.push('tweetType: "reply" decided by [data-testid=reply] action button only (no "Replying to") — likely an ORIGINAL misclassified');
  out.isArticle = { readView: !!A.querySelector('[data-testid="twitterArticleReadView"]'), richTextView: !!A.querySelector('[data-testid="twitterArticleRichTextView"]'), longform: !!A.querySelector('[data-testid="longformRichTextComponent"]') };
  out.isArticle.value = out.isArticle.readView || out.isArticle.richTextView || out.isArticle.longform;

  console.log(JSON.stringify(out, null, 2));
  return out;
})();
```

> **Probe fidelity note:** `tweetType.signals.hasRetweeter` uses the raw `socialContext` "reposted"/"retweeted"
> word, but the **real adapter** gates `tweetType:"retweet"` on a successfully-extracted `author.retweeter`
> object (requires the reposter handle). So when `acct.repost.handle` is `null` (see findings), the probe may
> report `"retweet"` while the adapter actually yields `"reply"`. Trust the adapter logic for that case.

## 4. Probe B — selection audit

Run **after highlighting text**, three times per applicable page: (a) in the post body → expect
`wouldBeHonored:true`; (b) in the right sidebar/trends → expect `false`; (c) in the nav/header → expect `false`.

```js
(() => {
  const sel = window.getSelection();
  const anchor = sel && sel.anchorNode;
  const anchorEl = anchor ? (anchor.nodeType === 1 ? anchor : anchor.parentElement) : null;
  const container = anchorEl ? anchorEl.closest('article, [data-testid="tweet"], [data-testid="twitterArticleReadView"], [data-testid="longformRichTextComponent"]') : null;
  const out = {
    hasSelection: !!sel, isCollapsed: sel ? sel.isCollapsed : null,
    selectedText: sel ? sel.toString().replace(/\s+/g, ' ').trim().slice(0, 200) : null,
    anchorElTag: anchorEl ? anchorEl.tagName.toLowerCase() : null,
    anchorNearestTestid: anchorEl && anchorEl.closest('[data-testid]') ? anchorEl.closest('[data-testid]').getAttribute('data-testid') : null,
    withinPostContent: !!container,
    matchedContainer: container ? (container.getAttribute('data-testid') || container.tagName.toLowerCase()) : null,
    wouldBeHonored: !!(sel && !sel.isCollapsed && sel.toString().trim() && container)
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
```

## 5. Interpreting results

A **drift signal** is any of:
- `articleDiscovery.primaryMatched:false` while a fallback fired, or `winnerMatchesUrl:false` on a `/status/` URL.
- `tweetText.tier` is `fallback-*` or `firstAnyText` (the canonical/article-body selectors missed).
- A metric's `selectorThatMatched:null` where a count is visible, or `suspectLossy:true`.
- `acct.*` / `protected.via` / `isArticle.via` empty where the situation guarantees a value, or a matched
  node whose `testid` differs from the documented one (a rename hiding behind a working structural fallback —
  the exact thing this battery exists to catch).
- A `drift[]` entry (the probe assembles these for you).

Capture the full Probe A JSON per situation (at minimum `meta`, `articleDiscovery` summary, `tweetText.tier`,
`acct`, `metrics`, `tweetType`, `isArticle`, `drift[]`).

---

## 6. Findings — run of 2026-06-02

UI language: `en` throughout. 15 situations run; selection probes on the article (S9). **Verify-only** — fixes
tracked in beads `qw-io3r` (no code changed by this pass).

### Confirmed bugs (drifted), prioritized

| # | Bug | Evidence | Impact |
|---|-----|----------|--------|
| 1 | **`tweetType` is effectively always "reply"** | `detectTweetType` keys off `[data-testid="reply"]` (the reply *action button on every tweet*) → 15/15 classified "reply" regardless of type. "Replying to" didn't fire even on a real reply (S4). Retweet/quote overrides are themselves broken (#2/#3). | Systematic; field is constant. |
| 2 | **Quote-tweet detection dead** | `[data-testid="quoteTweet"]` no longer matches (S7) → never "quote", and the `quotes` metric never populates (0/null everywhere). The separate `[data-testid="quotedTweet"]` −500 scoring penalty is also stale/moot. Code uses both inconsistent testids. | Quote tweets misclassified; quotes count always 0. |
| 3 | **Retweeter extraction broken** | On reposts (S6, S10) `socialContext` shows "reposted" but `socialContext.querySelector('a[href*="/"]')` is null → handle/name null → `author.retweeter` never built → reposter lost AND `tweetType` falls to "reply" (not "retweet"). | Reposts lose attribution + misclassify. |
| 4 | **`views` lossy at K/M scale** | Status pages lack the full-number `[aria-label*="View"]` (it EXISTS on the timeline — S15: "7661636 views…" → accurate), so views falls to abbreviated text ("35.9K"/"7.2M") and `common.ts parseNumber` (strips all but `\d.`) yields 35.9 / 7.2. Confirmed on 6 K/M tweets (S1,S3,S5,S6,S10,S12). | Views off by 1e3–1e6×. Only views; all other metrics accurate at every scale. |

### Holds (verified)

- **Article discovery + scoring**: winner = URL-id-matching article every time; +1000 URL signal correctly
  dominates column/cell bonuses for replies (S4: focal 1008 vs parent 185) and thread heads (S5).
- **tweetId** via `time`-anchor: robust to `/photo/`, `/video/` (S2/S3) and `/history` on edited tweets (S10).
- **tweetText** `[data-testid="tweetText"]` primary: all standard tweets, all languages incl. Arabic RTL
  (`dir="auto"`, S13). **Article body** (S9): `isArticle` all 3 testids fire; body via `articleBody` tier.
- **acct**: handle (User-Name link + `x.com` regex), displayName (tier-1 everywhere), verified (`icon-verified`
  8/8), avatar (`Tweet-User-Avatar`).
- **metrics likes/retweets/replies/bookmarks**: full-number aria-labels, accurate at all scales incl. 100K+
  (S12). `retweet` testid still works despite the "reposts" UI label. **0 distinguishable from missing** (S14).
- **date** (datetime), **language** (`[lang]`, incl. `ar`), **media** (photo/video/audio — note a video tweet
  also reports `photo:true` for its poster), **isArticle** (3 testids), **selection scoping** (S9 Probe B:
  honors body + title, rejects sidebar), **activation gate** (`/home` → `adapterWouldMatch:false`, S15).

### Untested / gaps (low priority)
- **Protected positive case** — no example found; negative held everywhere; `isProtected` is **badge-only**
  (gates nothing in lookup/submit) → low impact.
- **Subscribe-CTA on standalone tweets** — subscriber-only tweets are **modal-gated/unreachable**; the article
  CTA path is covered by S9. `isSubscribeCta` is effectively article-only.
- Non-verified account (verified false-positive check) + gold/gray badge variants.
- `retweetConfirm`/`likeConfirm` (transient), `UserAvatar-Container-unknown`, `time` aria-label date fallback,
  bare `div[data-testid=tweet]` — legacy/transient; base selectors confirmed.

### Decisions & minor observations
- **Article titles are quotable** — the title (`twitter-article-title`) is DOM-nested inside the article
  content container, so selections there are honored like body. **Accepted as intended (2026-06-02)** — no harm.
- −50 `socialContext` prev-sibling scoring penalty didn't fire on a real repost (heuristic drift; low impact,
  +1000 dominates).
- Article `language:null` (articles carry no `[lang]`).
- DLP layer redacted some testid values / URLs in this run; functional booleans were unaffected.

---

## 7. Follow-up fix plan (separate, TDD, gated)

**Phase A — one targeted discovery probe** on a quote tweet + a repost + a status page, to capture the
*current* DOM for the four broken assumptions before coding: (1) quote-tweet container testid, (2) reposter
link structure inside `socialContext`, (3) full-number views source on the status page, (4) a reliable reply
indicator. (We don't yet know the new selectors — same approach used to discover the article read-view testids.)

**Phase B — TDD fixes** in `src/platforms/twitter/adapter.ts` (+ `src/content/common.ts`), each with a faithful
DOM fixture: tweetType (drop action-button signal, real reply indicator, working retweet/quote overrides);
quote detection (current testid, quotes metric, −500 penalty, reconcile `quotedTweet`/`quoteTweet`); retweeter
(`socialContext` reposter-link selector); views (full-number source case-insensitive + K/M/B-aware
`parseNumber`). Verify full suite + type-check + lint + build; PR.

Tracked: beads `qw-io3r`.

## 8. Phase A discovery results & applied fixes (2026-06-02)

A targeted discovery probe on a quote tweet, a repost, and a high-views status page found the current DOM, and the four bugs were fixed (TDD; `src/platforms/twitter/adapter.ts` + `src/content/common.ts`; beads `qw-0ihz`):

- **Quote** — X exposes **no** `*quote*` testid anymore; the quoted tweet is nested inline, so the focal article has **two `[data-testid="tweetText"]` nodes**. → `detectTweetType` now returns `quote` when `tweetText` count ≥ 2 (outer text is the first node, already what we extract).
- **Views** — the `article[data-testid="tweet"]` element (or a descendant) carries a **full-integer** aria-label summary: `"… N likes, N bookmarks, N views"`. The standalone display is K/M-abbreviated. → new `extractViewsFromSummary()` reads `"N views"` from that aria-label (primary); falls back to the abbreviated display, now parsed by a **K/M/B-aware `parseNumber`**.
- **Retweeter** — `[data-testid="socialContext"]` is **absent on `/status/` permalinks** (it's a timeline-only banner; a permalink shows the original tweet). → retweeter/socialContext extraction **removed**, and the `retweet` tweetType branch dropped. (The optional `TwitterData.retweeter` type fields remain, always undefined; the validator still permits them.)
- **tweetType** — removed the `[data-testid="reply"]` **action-button** signal (present on every tweet → misclassified all originals). New order: `quote` (2× tweetText) → `reply` ("Replying to" text) → `original`. Self-thread quote-threads read as `original` (accepted).

> When re-running this battery as a regression test, note that **Probe A above still tests the pre-fix selectors** (it reports raw DOM + what the *old* adapter would do). Update its `tweetType`/`views`/`quote`/retweeter checks to match the current adapter logic, or just rely on its raw-DOM dumps + the per-assumption holds in §6.

New testids observed for the inventory: `UserAvatar-Container-<handle>` (dynamic, replaces the `-unknown` variant), `<userId>-subscribe`, `birdwatch-pivot`/`icon-birdwatch-fill` (Community Notes).
