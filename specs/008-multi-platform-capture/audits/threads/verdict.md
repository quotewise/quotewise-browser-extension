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
- Raw Probe B artifacts: pending in `raw/probe-b/`

## Contract Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Permalink extraction returns `platform`, `platformCode`, `sourceUrl`, and `sourceId` | Partial | Probe A returned `threads`, `TH`, and source IDs for both original fixtures; authenticated fixture returned canonical `sourceUrl`, while root selection still failed |
| `/post/` and `/t/` IDs are both reliable | Pending | Local fixtures cover both forms; live evidence pending |
| `threads.net` redirects are covered by runtime and manifest scope | Pending | Local fixture covers matching; live redirect behavior pending |
| Focal post selection excludes quoted/reposted/embedded/reply-context content | Fail | Live DOM exposed no `article`, `role="article"`, or `data-testid` root; Probe A fell back to page-level text `Thread` and reported root drift |
| Author handle resolves through preflight to a slug-bearing originator | Pending | No live preflight result committed yet |
| Duplicate/preflight and submit succeed on live pages | Pending | No live submit result committed yet |
| Deterministic fixture tests match the audited selector contract | Fail | Current local fixture contract expects article/testid roots that this live original fixture did not expose |
| Chrome Web Store host permission rationale matches enabled hosts | Pending | Host permissions exist, but runtime flag remains disabled |

## Notes

Threads remains disabled by runtime flag until this verdict passes.

2026-06-21 original fixture notes:

- `https://www.threads.com/@hormozi/post/DZ3Ly0-larF` rendered without a login gate in the browser.
- The current probe extracted URL identity correctly but did not find a focal post root through the adapter selectors.
- Supporting metadata exposed canonical URL, `og:title`, `og:description`, and `time[datetime]`; the rendered DOM exposed a `role="region"` / `aria-label="Column body"` column, permalink/time links, and action labels.
- Likes were visible as a Like icon plus adjacent count, not as a reliable `likes` label; keep likes omitted.
- Do not promote or enable Threads from this evidence. A selector update needs another fixture pass before it can be trusted.

2026-06-21 authenticated original fixture notes:

- `https://www.threads.com/@die_workwear/post/DZ3U4c5j30i` was audited after logging into Threads in the in-app browser.
- Direct reload of the permalink produced canonical metadata for the post and stable URL/time links for `die_workwear` and `DZ3U4c5j30i`.
- Probe A still found no configured post root and captured the handle text (`die_workwear`) instead of the post body.
- Supporting metadata exposed the correct `og:title`, `og:description`, `og:url`, and `time[datetime]`; the rendered DOM still did not expose `article`, `role="article"`, or `data-testid` hooks.
- This confirms the blocker is not only a logged-out/public rendering issue.
