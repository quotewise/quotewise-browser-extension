# Implementation Plan: Twitter/X DOM Parsing & Captured-Data Usage

**Spec**: `specs/003-twitter-dom-parsing/spec.md`
**Created**: 2026-06-02
**Branch**: `docs/twitter-dom-parsing-spec`
**Phase 0 research**: `specs/003-twitter-dom-parsing/research.md`

## Summary

Most of spec 003 is **already implemented** (baseline = PR #6: discovery/scoring, tweetText tiers + article
body, author/handle→slug attribution, metrics incl. views-from-aria-summary, K/M/B-aware `parseNumber`,
`tweetType` rework, `isArticle` gating, selection scoping). The clarify pass confirmed FR-022 (no-originator
block + create — already implemented), FR-031/SC-004 (views fallback — implemented), and FR-051 (selection
scope — implemented).

**The only net-new code this plan covers is FR-070** (drop the REMOVE-disposition vestigial fields). Phase 0
research changed the picture: the API ignores `platform_data` wholesale, so the cleanup is trivially safe and
a larger decision surfaces (below). `quoted_tweet_id` (FUTURE) is re-classified **blocked-on-backend**.

## Technical Context

- **Language/runtime**: TypeScript, bundled by webpack for Manifest V3 (single-file service worker + content
  script; `splitChunks: false` — do not change). Package manager: **Bun**.
- **Testing**: Jest + ts-jest in jsdom; tests mirror `src/` under `tests/`.
- **Architecture**: platform-adapter pattern; parsing isolated in `src/platforms/twitter/adapter.ts`.
- **External contract**: `POST /v1/quotes/` consumes `text`, `originator` (slug), `source_url`,
  `platform_code`, optional `likes_count`/`quote_date`/`attribution_type`; **`platform_data` is ignored**
  (research Finding 1).
- **No unknowns remain** (Phase 0 resolved the platform_data question). No `NEEDS CLARIFICATION`.

## Standards Check (no `.specify/constitution.md` in this repo)

Conform to `CLAUDE.md`: TDD (test-first), `bun run` everything, strict type-safety (`unknown` over `any`),
minimal Chrome permissions (unchanged here), keep `splitChunks: false`, 2-space indent. No new runtime
dependencies. No permission changes. ✓ All gates pass (cleanup only).

## Project Structure (files touched by FR-070)

- `src/types/chrome.ts` — `TwitterData`: remove `author.profileUrl`, `retweeter`, and
  `platform_data.{quote_count, reply_to_tweet_id, retweeter_username, retweeter_display_name}`.
- `src/platforms/twitter/adapter.ts` — `extractAuthor` (stop setting `profileUrl`), `extractFromDom` (stop
  emitting the removed `platform_data` keys; `extractMetrics` may keep computing `quotes` internally but it is
  no longer surfaced).
- `src/content/ui/overlay-bar.ts` — `submitQuote` already sends `currentData.platform_data` verbatim, so it
  needs **no change** once the adapter stops producing those keys.
- `src/utils/validators.ts` — remove the `retweeter` validation block.
- Tests: `tests/platforms/twitter-adapter.test.ts` (drop the `retweeter`-undefined assertion now that the
  field is gone), `tests/utils/validators.test.ts` (remove the "accepts data with retweeter info" test).

## Phase 0 — Research (complete → `research.md`)

Key result: **`platform_data` is silently ignored by the API.** Dropping the four fields is safe;
`quoted_tweet_id` population is inert until the backend consumes `platform_data`; a `originator_slug`
serializer flag is noted for separate verification (production submit already works).

## Phase 1 — Design & Data Model

**Target `TwitterData` (post-FR-070)** — removals only; everything else unchanged:

```
author: { username, displayName, verified, avatarUrl }          // − profileUrl
// (no top-level `retweeter`)                                    // − retweeter
platform_data: {
  tweet_id, reply_count, retweet_count, bookmark_count,
  view_count, is_protected, has_media                            // − quote_count, reply_to_tweet_id,
}                                                                //   retweeter_username, retweeter_display_name
```

- **RESERVE fields stay** (no change): `author.displayName`/`verified`/`avatarUrl`, `tweetType`, `language`.
- **FUTURE `quoted_tweet_id`**: design recorded but **not built** — extract from the quoted tweet's nested
  `a[href*="/status/"]` (distinct from the focal id) when a quote is detected; gated on the backend reading
  `platform_data`.
- No API contracts/ artifacts (the submit payload is documented in the spec; the backend ignores
  `platform_data`). No new entities.

## Implementation phases (preview for `speckit tasks`)

- **T1** — `TwitterData` type: remove the five fields (chrome.ts). *(Red: type-level; adjust tests.)*
- **T2** — `adapter.ts`: stop producing `author.profileUrl` and the removed `platform_data` keys (TDD against
  a fixture asserting the keys are absent).
- **T3** — `validators.ts`: remove `retweeter` validation; update `validators.test.ts`.
- **T4** — Update `twitter-adapter.test.ts` (drop the `retweeter` assertion).
- **T5** — Verify: `bun run type-check && bun run test && bun run lint && bun run build`; confirm a live submit
  still succeeds (API ignores `platform_data`).

Estimated: small, single PR, no backend coordination.

## Decisions surfaced (need a call before/with implementation)

1. **`platform_data` is entirely unused by the API** (research Finding 1) — **RESOLVED 2026-06-02: no API
   change, no extension change.** None of the `platform_data` engagement fields are worth persisting at this
   time, and the tweet id is already captured via `source_url` (→ `platform_identifier`), so
   `platform_data.tweet_id` is redundant — not a gap. The extension keeps sending `platform_data` as-is
   (harmless); an engagement snapshot, if ever wanted, is a backend-only change (read what's already on the
   wire). FR-070 still trims only the genuinely-dead fields. (See spec Decisions.)
2. **`originator_slug` serializer flag** (research Finding 3) — verify on the backend; not a spec-003 blocker
   (production submit works).

## Verification (quickstart)

- `bun run type-check`, `bun run test` (full suite), `bun run lint`, `bun run build` — all green.
- The removed fields no longer appear in the `SUBMIT_QUOTE` payload (assert in a test) and a live capture +
  submit still succeeds.
- Re-run the verification battery (`docs/twitter-dom-verification.md`) opportunistically to confirm no parsing
  regressions.

## Next

`speckit tasks` to expand T1–T5 into tracked tasks (or implement directly via the elevated beads task
`qw-8con`). The wholesale-`platform_data` decision (Decision 1) is the one item that may warrant a quick
follow-up clarify / backend coordination.
