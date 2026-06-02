# Feature Specification: Twitter/X DOM Parsing & Captured-Data Usage

**Created**: 2026-06-02
**Status**: Implemented (baseline) — Living (canonical, drives implementation)
**Last Updated**: 2026-06-02 — Baseline from the live x.com audit + fixes (PR #6); clarified (4 Q&A — see Clarifications)

## Overview

The extension captures quotes from Twitter/X by reading the live page DOM and producing a `TwitterData`
object (`src/platforms/twitter/adapter.ts`). X ships no stable public markup contract and changes its
`data-testid` attributes and structure without notice, which silently breaks extraction. This spec is the
**canonical, implementation-driving contract** for that parsing: it defines what the parser MUST produce,
embeds the **current selector inventory**, and sets the **intention for how each captured field is used**
(field-by-field disposition).

It is a living document. The verification battery (`docs/twitter-dom-verification.md`) detects DOM drift
against this spec; on drift we **update this spec first, then bring the implementation back into line**.

## Background

- **Platform-adapter pattern.** Parsing is isolated behind `PlatformAdapter<TData>`
  (`src/platforms/types.ts`); `TwitterAdapter` (`src/platforms/twitter/adapter.ts`) is the only
  implementation today. New platforms implement the same interface.
- **Three-context flow.** Content script (page DOM) → service worker (auth, preflight, badge, API delegation)
  → Quotewise API. The adapter runs only in the content script, only on tweet permalink pages.
- **Where the volatile detail is verified.** `docs/twitter-dom-verification.md` holds the re-runnable
  verification battery (page-console probes + situation matrix) used to confirm/refute this spec against live
  x.com. That doc is the *method*; this spec is the *contract*.
- **Baseline.** This spec's selector inventory reflects the implementation after the 2026-06-02 audit + fixes
  (PR #6). See Version History.

## User Scenarios & Testing

### User Story 1 - Capture a quote from a standard tweet (P1)

A user on a tweet permalink (`x.com/<user>/status/<id>`) opens the capture bar and submits the tweet as a
quote attributed to the correct originator.

**Why this priority**: The core capture flow; everything else builds on it.

**Acceptance**:
- The system MUST identify the focal tweet (the one named in the URL), not a reply, quoted, or timeline tweet.
- The system MUST extract the tweet's text, author handle, date, and engagement metrics.
- The system MUST resolve the author handle to a Quotewise originator and submit the quote attributed to it.

### User Story 2 - Capture a selected passage from a long-form Article (P1)

A user reading a long-form X Article highlights a passage and captures it as a quote.

**Why this priority**: Articles are a distinct, high-value content type whose body is far too long to capture
wholesale, and which previously mis-captured a subscribe CTA.

**Acceptance**:
- While the post is an Article, the system MUST require an explicit text selection before allowing submission.
- The system MUST honor a selection anchored anywhere in the article content (body or title) and reject
  selections outside it (sidebar, nav).
- The system MUST capture the highlighted passage verbatim as the quote text.

### User Story 3 - Capture from quote tweets, replies, and threads (P2)

A user captures a quote from a quote tweet, a reply, or a tweet within a thread.

**Why this priority**: Common shapes; the parser must pick the right focal tweet and the right text.

**Acceptance**:
- For a quote tweet, the system MUST capture the **outer** author's text (the commentary), not the quoted
  tweet's text, and classify it `quote`.
- When viewing a reply or thread tweet directly, the system MUST capture that focal tweet.

### User Story 4 - Accurate metrics & attribution (P2)

Captured engagement metrics and attribution reflect the true values, including for viral tweets.

**Why this priority**: Wrong metrics (e.g. a 7.2M-view tweet recorded as "7.2") corrupt downstream data.

**Acceptance**:
- The system MUST record engagement counts as full integers, including when X displays them abbreviated
  ("7.2M", "35.9K").
- Attribution MUST use the resolved originator identity, not the raw handle.

### Edge Cases

- **Subscribe CTA**: An Article/creator post showing a "Subscribe to …" call-to-action MUST NOT have that CTA
  captured as the quote text.
- **Protected account**: A protected post is flagged but capture is not blocked on that basis.
- **Non-English / RTL**: A non-English tweet (e.g. Arabic, `dir="auto"`) MUST extract its text and language
  code; metric parsing is unaffected (aria labels follow the UI language).
- **Edited tweet**: The timestamp link may carry a `/history` suffix; the tweet id MUST still extract.
- **Non-status page** (`/home`, profile, `/explore`): the adapter MUST NOT activate.

## Requirements

### Functional Requirements

**Activation & focal-tweet selection**
- **FR-001**: The adapter MUST activate only on `https://(x|twitter).com/<user>/status/<id>` URLs
  (path regex `/^\/[^/]+\/status\/\d+/`; manifest match `*/status/*`).
- **FR-002**: Among candidate article elements, the system MUST select the focal tweet by score, where a URL
  tweet-id match dominates all other signals (so the focal tweet wins even when a parent/reply tweet holds the
  primary-column/first-cell position).
- **FR-003**: When the URL tweet id is not found among candidates, the system MUST fall back to the
  highest-scored candidate (best-effort) rather than failing.

**Content extraction**
- **FR-010**: The system MUST extract tweet text from the canonical `[data-testid="tweetText"]` node when
  present; for long-form Articles (no `tweetText`), from the article read-view body.
- **FR-011**: When extracting via the broad fallback selectors, the system MUST skip interactive controls and
  the "Subscribe to …" CTA, and MUST NOT return null while any text exists (so capture can still open and a
  user selection can drive the quote).
- **FR-012**: For a quote tweet (two `tweetText` nodes in the focal article), `text` MUST be the first
  (outer) node.

**Author & attribution**
- **FR-020**: The system MUST extract the author handle from the User-Name link and resolve it to a Quotewise
  originator; the **originator slug** (`unique_id`) is the attribution key submitted to the backend — the raw
  handle is used only to look the originator up and for duplicate-check context.
- **FR-021**: If a resolved originator has no slug, the system MUST NOT submit (clear error), rather than post
  an empty reference.
- **FR-022**: If the author handle does not resolve to a Quotewise originator (lookup not-found), the system
  MUST disable submission and surface a "Create on Quotewise" affordance; it MUST NOT submit an unattributed
  quote.

**Metrics**
- **FR-030**: Likes, retweets, replies, and bookmarks MUST be read from full-number aria-labels (accurate at
  all magnitudes).
- **FR-031**: Views MUST be read as a full integer from the article's aria-label summary
  ("… N likes, N bookmarks, N views"). When that summary is absent, the system MUST fall back to the
  abbreviated display parsed with K/M/B expansion; this yields an **approximate** value, which is acceptable
  for the (rare) fallback path.
- **FR-032**: Numeric parsing (`parseNumber`, `src/content/common.ts`) MUST expand K/M/B magnitude suffixes
  and MUST NOT treat a following word that begins with K/M/B (e.g. "Bookmarks") as a suffix.
- **FR-033** *(known gap)*: The quotes count is currently unavailable (no DOM source after X removed the
  `quoteTweet` testid) and is recorded as 0. See Out of Scope / future.

**Classification**
- **FR-040**: `tweetType` MUST be derived as: `quote` (two `tweetText` nodes) → `reply` ("Replying to" text)
  → `original`. It MUST NOT be derived from the reply *action button* (present on every tweet), and it MUST
  NOT block capture (informational only).

**Capture gating**
- **FR-050**: While the post is a long-form Article, submission MUST be disabled until the user selects text.
- **FR-051**: A selection is valid when its anchor is within the post content container (`article` / tweet /
  article read-view / longform component). **Any** selection inside that container is honored — body, title,
  image captions, and embedded quoted-tweet text included; only selections outside it (sidebar, nav, page
  chrome) MUST be rejected. (Article titles are within content and ARE quotable — accepted behavior.)

**Resilience**
- **FR-060**: Each extraction MUST degrade gracefully through a primary → fallback selector chain and prefer
  returning best-effort data over failing the whole capture.

**Data hygiene**
- **FR-070**: The REMOVE-disposition fields (see Key Entities) — `author.profileUrl`, `retweeter` +
  `platform_data.retweeter_username` / `retweeter_display_name`, `platform_data.quote_count`,
  `platform_data.reply_to_tweet_id` — MUST be dropped from the captured `TwitterData` and the submit payload.
  Before removal, confirm the Quotewise API tolerates their absence in `platform_data`. (`quoted_tweet_id`
  stays — it is FUTURE work to populate, not remove.)

### Selector Inventory (canonical — current implementation)

> This is the volatile part. When the verification battery (`docs/twitter-dom-verification.md`) shows drift,
> update this table, then the code.

**Article discovery** (`findPrimaryArticle`): `article[data-testid="tweet"]`, `article[role="article"]`,
`div[data-testid="tweet"]`, `[data-testid="primaryColumn"] article`.

**Scoring** (`calculateArticlePriority`): URL-id match **+1000**; first article in `[data-testid="primaryColumn"]`
**+100**; first `[data-testid="cellInnerDiv"]` **+50**; `tabindex="0"` **+25**; DOM order **+(10−index)**;
inside `[data-testid="quotedTweet"]` **−500** *(VESTIGIAL — testid no longer emitted)*; prev-sibling has
`[data-testid="socialContext"]` **−50** *(VESTIGIAL — socialContext is timeline-only, absent on permalinks)*.

**Tweet ID** (`extractTweetIdFromArticleElement`): `a[href*="/status/"] time` → parent anchor `href`,
regex `/status\/(\d+)/`; fallback: any `a[href*="/status/"]` skipping `/photo/` and `/video/`. Robust to a
`/history` suffix on edited tweets.

**Tweet text** (`extractTweetText`), in order: (1) `[data-testid="tweetText"]` (first node = focal/outer);
(2) article body `[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]`;
(3) fallbacks `[lang]`, `div[dir="auto"]`, `article span[lang]` — skipping anything inside
`button, [role="button"], [data-testid="placementTracking"]` and any text matching `/^(click to )?subscribe to /i`
(length < 80); last resort = first non-empty text found.

**Author** (`extractAuthor`): handle from `[data-testid="User-Name"] a[href*="/"]` via regex
`(twitter|x)\.com/([^/?]+)`; display name from `[data-testid="User-Name"] span:first-child span` →
`[data-testid="User-Names"] span:first-child` → `[role="link"][tabindex="-1"] span`; verified from
`[data-testid="icon-verified"], svg[aria-label*="Verified"]`; avatar from
`[data-testid="Tweet-User-Avatar"] img, [data-testid="UserAvatar-Container-unknown"] img` *(the `-unknown`
variant is now dynamic, `UserAvatar-Container-<handle>` — effectively dead; the primary works)*. **No
retweeter/socialContext extraction** (removed — see Decisions).

**Metrics** (`extractMetrics`): replies `[data-testid="reply"]`; retweets `[data-testid="retweet"]`,
`[data-testid="retweetConfirm"]`; likes `[data-testid="like"]`, `[data-testid="likeConfirm"]`; bookmarks
`[data-testid="bookmark"]`, `[aria-label*="Bookmark"]` — counts from aria-labels / nested
`[data-testid="app-text-transition-container"]`, parsed by K/M/B-aware `parseNumber`. **Views**
(`extractViewsFromSummary`): the focal `article` (or descendant) aria-label summary (identified by containing
`likes`), regex `/([\d,]+)\s+views?\b/i`; fallback selectors `[aria-label*="View"]`,
`[data-testid="app-text-transition-container"]`. **Quotes** `[data-testid="quoteTweet"] [data-testid="app-text-transition-container"]`
*(BROKEN — `quoteTweet` testid gone → always 0)*.

**Date** (`extractDate`): `time` → `datetime` attr → `aria-label` → ISO. **Language** (`extractLanguage`):
first `[lang]`. **Protected** (`detectProtected`): `[data-testid="icon-lock"], svg[aria-label*="Protected"],
[aria-label*="Protected account"]`. **Media** (`detectMedia`): `[data-testid="tweetPhoto"], video, audio`.
**Article** (`detectArticle`): `[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"],
[data-testid="longformRichTextComponent"]`. **tweetType** (`detectTweetType`): 2× `[data-testid="tweetText"]`
→ `quote`; text includes "Replying to" → `reply`; else `original`.

**Selection** (`QuotePreview.isSelectionWithinPostContent`): anchor
`.closest('article, [data-testid="tweet"], [data-testid="twitterArticleReadView"], [data-testid="longformRichTextComponent"]')`,
plus a verbatim-substring fast path against the extracted text.

### Key Entities — `TwitterData` field-by-field disposition

How each captured field is used today, and its intended disposition. **KEEP** = load-bearing;
**RESERVE** = retain for a credible near-future use; **REMOVE** = no consumer, slim it out;
**FUTURE** = should be populated/used by planned work. (Schema: `src/types/chrome.ts`.)

> Note on `platform_data`: the API currently **ignores the entire `platform_data` blob** (it has no serializer
> field — see Decisions). Its fields are *sent but not persisted*; the tweet id is effectively captured via
> `source_url` (`x.com/<user>/status/<id>` → the sighting's `platform_identifier`), so `platform_data.tweet_id`
> is redundant, not a gap. For `platform_data` rows, **KEEP** means "continue sending" (harmless), not
> "the backend uses it."

| Field | Used today | Disposition |
|---|---|---|
| `text` | submitted as quote text; selection-gated on Articles | **KEEP** |
| `author.username` | → originator lookup → `originator_slug`; duplicate `social_handle`; display chip | **KEEP** |
| `author.displayName` / `author.verified` / `author.avatarUrl` | not consumed | **RESERVE** (richer attribution UI) |
| `author.profileUrl` | not consumed | **REMOVE** (derivable from username) |
| `retweeter`, `platform_data.retweeter_username`/`_display_name` | not produced (extraction removed) | **REMOVE** (drop the type fields) |
| `url` | submitted `source_url`; duplicate key; display | **KEEP** |
| `date` | submitted `quote_date`; display chip | **KEEP** |
| `likes` | submitted `likes_count`; display chip | **KEEP** |
| `retweets` / `replies` / `views` / `bookmarks` | `platform_data` counts + display chips | **KEEP** |
| `tweetType` | not consumed (informational) | **RESERVE** (future filtering/analytics) |
| `language` | not consumed | **RESERVE** (future i18n submission) |
| `isProtected` | display badge; `platform_data.is_protected` | **KEEP** |
| `isArticle` | capture gating (requires selection) | **KEEP** |
| `platform_data.tweet_id`, `{reply,retweet,bookmark,view}_count` | submitted | **KEEP** |
| `platform_data.quote_count` | always 0 (no source) | **REMOVE** (misleading) until a source exists |
| `platform_data.has_media` | submitted | **KEEP** |
| `platform_data.reply_to_tweet_id` | always undefined | **REMOVE** (or FUTURE if reply linkage is wanted) |
| `platform_data.quoted_tweet_id` | always undefined | **FUTURE**: populatable now that quote tweets are detected and the quoted status link is in the DOM |

## Success Criteria

- **SC-001**: On any tweet permalink, the focal tweet (URL id) is the one captured — never a reply/quoted/feed
  tweet — including reply and thread-head pages.
- **SC-002**: Standard tweet text, the X Article body, and non-English/RTL text are all extracted via the
  canonical path (no fallthrough to a CTA or UI chrome).
- **SC-003**: Quote tweets capture the outer commentary and classify as `quote`; originals are not
  misclassified as `reply`.
- **SC-004**: Engagement counts are exact full integers for K/M/B-scale tweets when the article aria-label
  summary is present (e.g. a 7.2M-view tweet records 7,661,636, not 7.2); on the rare fallback (no summary),
  an approximate K/M/B-expanded value (7,200,000) is acceptable — never the raw "7.2".
- **SC-005**: On an Article, submission is blocked until a passage is selected; an in-article selection is
  honored and a sidebar/nav selection is rejected.
- **SC-006**: Every submitted quote carries a valid `originator_slug`; capture never posts an empty originator.
- **SC-007**: The adapter does not activate on non-status pages.

## Implementation

- **Primary**: `src/platforms/twitter/adapter.ts` (`TwitterAdapter` — discovery, extraction, classification),
  `src/content/common.ts` (`parseNumber`, `extractTextContent`), `src/content/ui/components/quote-preview.ts`
  (`getPageSelection` / `isSelectionWithinPostContent`),
  `src/content/ui/overlay-bar.ts` (capture flow, gating, submission), `src/types/chrome.ts` (`TwitterData`).
- **Submission contract** (`overlay-bar.ts submitQuote`): `{ text, originator_slug, source_url, platform_code:
  'TX', likes_count, quote_date, attribution_type: 'DIRECT', platform_data }`.
- **Tests**: `tests/platforms/twitter-adapter.test.ts`, `tests/content/common.test.ts`,
  `tests/content/ui/components/quote-preview.test.ts`, `tests/content/ui/overlay-bar.test.ts`.
- **Verification battery**: `docs/twitter-dom-verification.md`.

## Assumptions

- The browser UI language is English (aria-label parsing for metrics/verified/protected assumes English).
- The Quotewise API accepts `originator_slug` as the write identifier (backend contract).
- The content script runs only on `/status/` permalinks (manifest-enforced).

## Dependencies

- Quotewise API: originator-by-handle lookup / preflight, duplicate check, quote submission.
- `docs/twitter-dom-verification.md` for ongoing drift detection.

## Out of Scope

- **Timeline/feed extraction** (reposter/"X reposted" context) — the adapter runs only on permalinks, which
  show the original tweet; there is no reposter to capture.
- **Quotes count** and **reply/quoted tweet-id linkage** — no reliable DOM source today (quotes) or not yet
  wired (linkage); tracked as future FRs above.
- **SpecKit tooling port** into this repo (`.specify/`, scripts) — separate task.

## Clarifications

### Session 2026-06-02
- Q: On the views fallback (no full-integer aria summary), what value to record? → A: **Approximate via K/M/B expansion** — exact when the summary is present; approximate is acceptable on the rare fallback (FR-031, SC-004).
- Q: Within an Article, which selections are quotable? → A: **Any selection inside the article content container** (body, title, captions, embedded quoted text); only sidebar/nav are rejected (FR-051).
- Q: When the handle doesn't resolve to a Quotewise originator, what should capture do? → A: **Block submit + offer "Create on Quotewise"**; never submit an unattributed quote (FR-022).
- Q: Drop the REMOVE-disposition vestigial fields now or keep as backlog? → A: **Remove now** — authorized under this spec; verify the API tolerates omitted `platform_data` keys first (FR-070).

### Decisions
- **`platform_data` not persisted by the API — no change (2026-06-02)** — the submitted `platform_data` blob is
  ignored by `POST /v1/quotes/` (no serializer field; `QuoteCreateSerializer` consumes only `text`,
  `originator`, `source_url`, and a few optional top-level fields incl. `likes_count`). Evaluated for a
  backend change to persist an engagement snapshot (views/retweets/bookmarks/replies) and **declined — not
  relevant at this time**. The tweet id is already captured via `source_url` (→ `platform_identifier`), so
  `platform_data.tweet_id` is redundant, not a gap. The extension keeps sending `platform_data` (harmless);
  reviving the snapshot later would be a **backend-only** change (read what's already on the wire) — no
  extension work. Resolves the open decision raised in `plan.md`.
- **Selection required on Articles** — the full ~11k-char body is a poor default; Articles require an explicit
  highlight (FR-050).
- **Article titles are quotable** — the title is DOM-nested in the article content, so title selections are
  honored. Accepted as intended (no harm).
- **Retweeter dropped** — `socialContext` is a timeline-only banner; on a permalink you view the original
  tweet, so there is no reposter. Extraction and the `retweet` classification were removed.
- **Views via aria summary** — the per-element views display is K/M-abbreviated and parses lossily; the
  article aria-label summary carries the full integer.
- **`tweetType` is informational** — it never blocks or alters capture.

## Version History

- **2026-06-02 — baseline.** Established from a full live x.com verification battery (15 situations) plus the
  resulting fixes (PR #6): `tweetType` rework (removed the reply action-button signal; quote = 2× `tweetText`),
  quote detection via `tweetText` count, retweeter removal, views from the article aria-label summary, and a
  K/M/B-aware `parseNumber`. The pre-baseline bugs and the audit method are recorded in
  `docs/twitter-dom-verification.md`.
