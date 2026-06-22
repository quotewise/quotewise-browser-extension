# Threads DOM Audit Verdict

## Status

- Audit phase: Phase 2
- Promotion decision: do not promote
- Live URL set: original, reply, media, and reshare fixtures captured on 2026-06-21/2026-06-22
- Raw Probe A artifacts:
  - `raw/probe-a/original-hormozi-dz3ly0-larf.json`
  - `raw/probe-a/original-die-workwear-dz3u4c5j30i-authenticated.json`
  - `raw/probe-a/reply-arturoztalin-dz3e05qlnxc-authenticated.json`
  - `raw/probe-a/reply-njr354151-dz3xgpripmd-authenticated.json`
  - `raw/probe-a/media-huyquocc11-dz1dyikejeh-authenticated.json`
  - `raw/probe-a/repost-quote-9six7-dz3u2dnexyk-authenticated.json`
- Other-features artifacts:
  - `raw/other-features/original-hormozi-dz3ly0-larf.json`
  - `raw/other-features/original-die-workwear-dz3u4c5j30i-authenticated.json`
  - `raw/other-features/reply-arturoztalin-dz3e05qlnxc-authenticated.json`
  - `raw/other-features/reply-njr354151-dz3xgpripmd-authenticated.json`
  - `raw/other-features/media-huyquocc11-dz1dyikejeh-authenticated.json`
  - `raw/other-features/repost-quote-9six7-dz3u2dnexyk-authenticated.json`
- Contract-discovery artifacts:
  - `raw/contract-discovery/original-die-workwear-dz3u4c5j30i-authenticated.json`
  - `raw/contract-discovery/reply-arturoztalin-dz3e05qlnxc-authenticated.json`
  - `raw/contract-discovery/reply-njr354151-dz3xgpripmd-authenticated.json`
  - `raw/contract-discovery/media-huyquocc11-dz1dyikejeh-authenticated.json`
  - `raw/contract-discovery/repost-quote-9six7-dz3u2dnexyk-authenticated.json`
- Raw Probe B artifacts: pending in `raw/probe-b/`

## Contract Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Permalink extraction returns `platform`, `platformCode`, `sourceUrl`, and `sourceId` | Candidate pass for original permalinks | Contract-discovery returned `threads`, `TH`, canonical URL, source ID `DZ3U4c5j30i`, and handle `die_workwear` |
| `/post/` and `/t/` IDs are both reliable | Pending | Local fixtures cover both forms; live evidence pending |
| `threads.net` redirects are covered by runtime and manifest scope | Pending | Local fixture covers matching; live redirect behavior pending |
| Focal post selection excludes quoted/reposted/embedded/reply-context content | Candidate pass for original, reply, media, and reshare fixtures | Original and media fixtures support metadata-primary extraction; reply fixtures show canonical/OG can point to parent context, and the reshare fixture separates wrapper context text from embedded repost text/media |
| Author handle resolves through preflight to a slug-bearing originator | Pending | No live preflight result committed yet |
| Duplicate/preflight and submit succeed on live pages | Pending | No live submit result committed yet |
| Deterministic fixture tests match the audited selector contract | Pending update | Existing local tests cover article/testid-root assumptions; they should be updated after the Threads contract is validated across scenario fixtures |
| Chrome Web Store host permission rationale matches enabled hosts | Pending | Host permissions exist, but runtime flag remains disabled |

## Notes

Threads remains disabled by runtime flag until this verdict passes.

## Candidate Threads Contract

Current evidence supports this contract for an authenticated original Threads permalink:

| Field | Candidate Source | Current Confidence |
|-------|------------------|--------------------|
| `platform` / `platformCode` | Host match on `threads.com` / `threads.net` plus static code `TH` | High |
| `sourceUrl` | `link[rel="canonical"]`, when it remains a permalink URL | High for direct permalink reload |
| `sourceId` | `/@handle/post/{id}` or `/@handle/t/{id}` URL path | High for `/post/`; `/t/` live evidence pending |
| Author handle | URL path handle, cross-checked with `og:title` `(@handle)` | High for original permalink |
| Display name | `og:title` pattern `{displayName} (@handle) on Threads` | High for original permalink |
| Text | `meta[property="og:description"]` | High for original permalink |
| Posted date | `time[datetime]` whose nearest permalink link contains `sourceId` | Medium; needs more scenarios |
| Likes | Candidate: number between Like and Reply action icons | Medium for authenticated original, reply, and media fixtures; validate low/zero cases before promotion |
| Rendered body | `[dir="auto"]` text candidate | Supporting only; browser extraction can normalize/degrade text |

The prior generic Probe A is useful as negative evidence for X-like selectors, but it is not the proposed Threads adapter contract.

For reply/comment permalinks where `location.href` and canonical metadata disagree:

| Field | Candidate Source | Current Confidence |
|-------|------------------|--------------------|
| `sourceUrl` / `sourceId` / author handle | Browser URL path, not canonical metadata | High for reply fixtures |
| Text | First non-action `[dir="auto"]` text after the permalink/time link for the browser URL source ID, excluding text inside another post link | Medium; two reply fixtures, including one with embedded linked content |
| Posted date | `time[datetime]` whose nearest permalink link contains the browser URL source ID | High for reply fixtures |
| Parent context | Canonical URL, `og:title`, and `og:description` | Parent-only when canonical and browser URL disagree; do not use as focal |
| Likes | Count between Like and Reply action icons in the same source-linked row | Medium; replies parsed `1` and `2` |

## Scenario Matrix

| Fixture Class | Status | Notes |
|---------------|--------|-------|
| original | Candidate contract found | Two original fixtures captured; authenticated `die_workwear` discovery supports metadata-primary extraction |
| reply/comment | Candidate contract found | Authenticated `arturoztalin` and `njr354151` replies show canonical/OG parent-context mismatch; `njr354151` also validates embedded linked-content exclusion |
| repost/quote/reshare | Candidate contract found | Authenticated `9six7` fixture validates wrapper context text, embedded repost text, and embedded media separation; canonical metadata is not usable |
| media | Candidate contract found | Authenticated `huyquocc11` media permalink confirms canonical metadata and source-linked text remain focal while media nodes are present |
| long/collapsed | Pending | Need direct URL |
| unavailable/private/login-gated | Pending | Need direct URL |
| non-English | Pending | Need direct URL |
| low/zero likes | Pending | Need direct URL |
| abbreviated/high likes | Pending | Need direct URL |

2026-06-21 original fixture notes:

- `https://www.threads.com/@hormozi/post/DZ3Ly0-larF` rendered without a login gate in the browser.
- The current probe extracted URL identity correctly but did not find a focal post root through the adapter selectors.
- Supporting metadata exposed canonical URL, `og:title`, `og:description`, and `time[datetime]`; the rendered DOM exposed a `role="region"` / `aria-label="Column body"` column, permalink/time links, and action labels.
- Likes were visible as a Like icon plus adjacent count. Treat the number between Like and Reply as a candidate likes selector, but keep likes omitted in the adapter until low/zero and abbreviated/high-like fixtures confirm the rule.
- Do not promote or enable Threads from this evidence. A selector update needs another fixture pass before it can be trusted.

2026-06-21 authenticated original fixture notes:

- `https://www.threads.com/@die_workwear/post/DZ3U4c5j30i` was audited after logging into Threads in the in-app browser.
- Direct reload of the permalink produced canonical metadata for the post and stable URL/time links for `die_workwear` and `DZ3U4c5j30i`.
- Generic Probe A still found no configured post root and captured the handle text (`die_workwear`) instead of the post body, confirming those root selectors are not the Threads contract.
- Threads contract-discovery probe found a high-confidence original-permalink candidate using canonical URL, URL identity, `og:title`, `og:description`, and source-linked `time[datetime]`.
- The same probe found an action-row count candidate: Like icon -> `2.3K` -> Reply icon, parsed as `2300` likes.
- Supporting metadata exposed the correct `og:title`, `og:description`, `og:url`, and `time[datetime]`; the rendered DOM still did not expose `article`, `role="article"`, or `data-testid` hooks.
- This confirms the blocker is not only a logged-out/public rendering issue; it also establishes metadata as the current primary candidate for original Threads permalinks.

2026-06-21 authenticated reply fixture notes:

- The provided URL was `https://www.threads.com/@arturoztalin/post/DZ3e05qlNxc?xmt=AQG0Wg5Fei3m6HdTfEhA8VlIkLzFk8HVvIsmysisbgpy0w`; the browser normalized it to `https://www.threads.com/@arturoztalin/post/DZ3e05qlNxc`.
- Browser URL identity was `arturoztalin` / `DZ3e05qlNxc`, but canonical and OG metadata pointed to the parent original `die_workwear` / `DZ3U4c5j30i`.
- Generic Probe A still found no configured post root and returned empty extraction fields for the reply fixture.
- Contract discovery marked `metadataPrimary` as `mismatch_parent_context`, which means canonical/OG title and description must not be used as focal reply data when they disagree with the browser URL.
- The `sourceLinkedRendered` candidate found reply text `Wait a sec.... 😅`, posted date `2026-06-21T23:47:09.000Z`, and likes count `1`.
- The likes adjacency rule also held on this reply: Like icon -> `1` -> Reply icon.

2026-06-21 authenticated reply-with-embedded-content fixture notes:

- The provided URL was `https://www.threads.com/@njr354151/post/DZ3XgPRiPmD?xmt=AQG0Wg5Fei3m6HdTfEhA8VlIkLzFk8HVvIsmysisbgpy0w`; the browser normalized it to `https://www.threads.com/@njr354151/post/DZ3XgPRiPmD`.
- Browser URL identity was `njr354151` / `DZ3XgPRiPmD`, but canonical and OG metadata again pointed to the parent original `die_workwear` / `DZ3U4c5j30i`.
- The `sourceLinkedRendered` candidate found focal reply text `Pablo Thriftscobar" is a name I did not need but absolutely deserved`, posted date `2026-06-21T22:43:09.000Z`, and likes count `2`.
- The same DOM contained embedded linked content from `yourhappinessmatters10` / `DZ3UsDzCO57` beginning with `The reports coming out`; the focal text candidate excluded it because it was inside a different permalink link.
- Generic Probe A still followed parent canonical metadata and captured non-focal text, reinforcing that Probe A is negative evidence for Threads.
- The likes adjacency rule held again on this reply: Like icon -> `2` -> Reply icon.

2026-06-21 authenticated media fixture notes:

- `https://www.threads.com/@huyquocc11/post/DZ1dYiKEjeH` was audited as a media/carousel permalink whose visible text starts `My little brother finished this and now I'm questioning every academic achievement I've ever had`.
- Browser URL identity and canonical metadata both pointed to `huyquocc11` / `DZ1dYiKEjeH`; `metadataPrimary` was `high_for_original_permalink`.
- Metadata text captured the focal post body without the rendered carousel/page marker; source-linked rendered text included the visible `1/2` suffix.
- The other-features probe now records sanitized media counts and media element summaries without CDN URLs or profile-picture nodes. This fixture exposed one loaded `<video>` element in the visible DOM plus adjacent carousel media nodes; loaded `<video>` count should be treated as a visibility signal, not a total carousel-video count.
- Likes adjacency held on the media fixture: Like icon -> `5.4K` -> Reply icon, parsed as `5400`.
- Generic Probe A still found no configured Threads root and captured handle text (`huyquocc11`) instead of the post body.

2026-06-22 authenticated reshare/quote fixture notes:

- `https://www.threads.com/@9six7/post/DZ3u2dNEXYK` was audited as a reshare/quote-style permalink with wrapper context text, embedded repost text, and embedded media.
- Browser URL identity was `9six7` / `DZ3u2dNEXYK`, but canonical metadata pointed to `https://www.threads.com/`; `metadataPrimary` was `incomplete` and must not be used as focal text for this fixture.
- The visible source-linked rendered candidate found wrapper context text beginning `The President of the United States should not travel...`, posted date `2026-06-22T02:07:10.000Z`, and likes count `1000`.
- The embedded repost text was separately detected under `aaron.rupar` / `DZ0G2o5ic-m`, beginning `Trump on the new plane...`; this must be excluded from focal capture unless the user opens that embedded permalink directly.
- The sanitized media summary found one visible video element and image/video-player wrapper nodes below the embedded repost text. Hidden feed DOM also contained media nodes, so the other-features probe now reports visible media counts separately from document-wide counts.
- Generic Probe A found no configured Threads root and captured feed/navigation text, reinforcing that Probe A is negative evidence for Threads.
