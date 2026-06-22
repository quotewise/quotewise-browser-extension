# Threads DOM Audit Verdict

## Status

- Audit phase: Phase 2
- Promotion decision: do not promote
- Live URL set: original fixtures captured on 2026-06-21
- Raw Probe A artifacts:
  - `raw/probe-a/original-hormozi-dz3ly0-larf.json`
  - `raw/probe-a/original-die-workwear-dz3u4c5j30i-authenticated.json`
- Other-features artifacts:
  - `raw/other-features/original-hormozi-dz3ly0-larf.json`
  - `raw/other-features/original-die-workwear-dz3u4c5j30i-authenticated.json`
- Contract-discovery artifacts:
  - `raw/contract-discovery/original-die-workwear-dz3u4c5j30i-authenticated.json`
- Raw Probe B artifacts: pending in `raw/probe-b/`

## Contract Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Permalink extraction returns `platform`, `platformCode`, `sourceUrl`, and `sourceId` | Candidate pass for original permalinks | Contract-discovery returned `threads`, `TH`, canonical URL, source ID `DZ3U4c5j30i`, and handle `die_workwear` |
| `/post/` and `/t/` IDs are both reliable | Pending | Local fixtures cover both forms; live evidence pending |
| `threads.net` redirects are covered by runtime and manifest scope | Pending | Local fixture covers matching; live redirect behavior pending |
| Focal post selection excludes quoted/reposted/embedded/reply-context content | Pending across scenarios | Original permalink evidence suggests metadata-primary focal text; reply, repost/quote, media, and related-thread scenarios still need live fixtures |
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
| Likes | Candidate: number between Like and Reply action icons | Medium for authenticated original fixture; validate low/zero and abbreviated/high-like cases before promotion |
| Rendered body | `[dir="auto"]` text candidate | Supporting only; browser extraction can normalize/degrade text |

The prior generic Probe A is useful as negative evidence for X-like selectors, but it is not the proposed Threads adapter contract.

## Scenario Matrix

| Fixture Class | Status | Notes |
|---------------|--------|-------|
| original | Candidate contract found | Two original fixtures captured; authenticated `die_workwear` discovery supports metadata-primary extraction |
| reply/comment | Pending | Need direct URL |
| repost/quote/reshare | Pending | Need direct URL |
| media | Pending | Need direct URL |
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
