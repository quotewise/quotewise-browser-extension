# Implementation Plan: Similarity Duplicate — Add Sighting vs Add Variant

**Branch**: `006-sighting-variant-choice` | **Date**: 2026-06-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-sighting-variant-choice/spec.md`

## Summary

Finish the chrome-side integration of the deployed similarity-duplicate contract (ADR-0001/0002) so the user — not the system — resolves a same-originator near match: **Add another sighting** (date-gated to earlier occurrences) or **Add as variant**. Different-originator `conflict` matches are blocked with a resolve-in-Quotewise link; a failed duplicate check shows an honest "couldn't verify" state that blocks submit and offers Retry (kills the fabricated `new_quote` fallback, `qw-0psq.4`).

Technical approach: a small pure **resolution classifier** maps the duplicate-check result to one UI route (`exact` / `conflict` / `similar` / `couldnt_verify` / `none`); the existing `similar-diff.ts` scaffolding is reworked from a disabled placeholder into the live two-button decision; `duplicate-badge.ts` routes by `match_class`; `overlay-bar.ts` threads the chosen `link_to_quote_id` + `user_intent` into the existing SUBMIT_QUOTE path; the API client and message pass-through carry the two new request fields and surface the response `action`. All deterministic logic is built test-first (Article VI); the contract is consumed defensively (ignore unknown fields, degrade when absent — Article V).

## Technical Context

**Language/Version**: TypeScript 5.3 (Manifest V3 Chrome extension), ES modules, 2-space indent.

**Primary Dependencies**: None new. Vanilla TS + Shadow DOM; reuses `src/utils/word-diff.ts`, `src/utils/duplicate-status.ts`, existing message/`fetch` plumbing.

**Storage**: `chrome.storage.local` (existing keys only — `currentTweet`, `preloadedDuplicateCheck`). No new keys; no new persisted data.

**Testing**: Jest + ts-jest in jsdom (`bun run test`). Deterministic logic test-first; Shadow-DOM UI via jsdom component tests; no live X dependency.

**Target Platform**: Chrome MV3 — content script on `x.com`/`twitter.com` status pages + background service worker; API at `https://api.quotewise.io` (Bearer auth).

**Project Type**: Single-project browser extension (content + background entry points; `splitChunks:false`).

**Performance Goals**: Decision UI renders within the existing duplicate-check round-trip; confirmation within ~1s of submit response (SC-002). No new heavy compute (diff already used).

**Constraints**: MV3 single-file bundles; no remote code/eval; pin `/v1/`, ignore unknown response fields, degrade (not throw) on unexpected shapes (Article V); no editable quote text (Article I); WCAG 2.1 AA for new controls (Article VII).

**Scale/Scope**: ~6 source files touched + ~5 test files; no schema/permission/dependency changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Gate | Status | Notes |
|---------|------|--------|-------|
| I — Capture Integrity | No editable quote-text input; verbatim/excerpt only; explicit submit | ✅ PASS | FR-012; feature only adds a *resolution choice*, never text editing. Conflict + couldn't-verify both **refuse** rather than guess. |
| II — Privacy | No new pre-action egress; pre-action limited to tweet_id/handle/source_url | ✅ PASS | `link_to_quote_id`/`user_intent` ride only the explicit **submit** (a write), never preload. No new stored data. |
| III — Security & Permissions | No new permission/dependency; no secret in logs | ✅ PASS | Zero manifest/dep changes. Opportunistically fixes `javascript:` URI hardening (`qw-0psq.6`) in the two components we touch. |
| IV — Observability | No token/PII/tweet-text in logs | ✅ PASS | New error logging (couldn't-verify) logs status/shape only, never tokens or quote text. |
| V — Resilience | Pin /v1/, ignore unknown fields, degrade not throw | ✅ PASS | FR-013: missing `match_source`/`match_class` → degrade to recommendation-based behavior. Classifier treats absent fields as "none/legacy", never throws. |
| VI — Quality & Testing | Deterministic logic test-first; UI characterized | ✅ PASS | Classifier, view-builder, API-client param threading all TDD; badge/overlay covered by jsdom component tests. |
| VII — User Experience | Quiet presence; WCAG 2.1 AA; honest copy, no dark patterns | ✅ PASS | Overlay still on-demand. FR-010 (keyboard/aria/glyph-not-color). Equal-weight buttons (no nudge); "Added as variant" with no verification overclaim. |
| VIII — Platform Scope | No multi-platform abstraction; X logic behind adapter | ✅ PASS | No adapter changes; logic lives in shared UI/API layers already platform-agnostic. |
| IX — Release Discipline | Version single-sourced | ✅ PASS (N/A) | No version bump in this feature; bump happens at release via `bump-version.js`. |

**Result: All gates pass. No violations → Complexity Tracking empty.**

**Post-Design re-check (after Phase 1):** No new violations — the design adds no permissions/dependencies/storage, keeps a single submit path, parses the contract defensively (degrade-not-throw), and bakes TDD + WCAG 2.1 AA + honest copy into the contracts. Gates remain ✅.

## Project Structure

### Documentation (this feature)

```text
specs/006-sighting-variant-choice/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — client-side entities/types
├── quickstart.md        # Phase 1 — how to test/verify
├── contracts/
│   ├── api-consumption.md      # check_duplicate fields + submit fields the client binds to
│   └── ui-decision-contract.md # DuplicateBadge callbacks, similar-diff view, overlay submit signature
├── checklists/
│   └── requirements.md  # spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 — /speckit-tasks (NOT created here)
```

### Source Code (repository root)

```text
src/
├── types/
│   └── api.ts                              # +match_source/match_class/existing_sighting_for_this_url on matches[]; +link_to_quote_id/user_intent on QuoteSubmissionRequest; +action on QuoteSubmissionResult
├── utils/
│   └── duplicate-status.ts                 # +classifyMatchResolution(): pure router → exact|conflict|similar|couldnt_verify|none
├── api/
│   └── quotewise-api.ts                    # submitQuote() threads link_to_quote_id/user_intent; surfaces response action; checkQuoteDuplicate() error→couldnt_verify (no fabricated new_quote)
├── background/
│   └── api-handler.ts                      # pass link_to_quote_id/user_intent through SUBMIT_QUOTE; return action
└── content/ui/
    ├── overlay-bar.ts                      # thread decision into submitQuote({linkToQuoteId,userIntent}); couldnt-verify block+retry; conflict block; confirmations; double-submit guard (qw-0psq.1)
    └── components/
        ├── duplicate-badge.ts             # route by match_class; new onResolveDecision callback; href hardening (qw-0psq.6)
        └── similar-diff.ts                # rework: live two-button decision (variant always; sighting date-gated); remove disabled placeholder

tests/
├── utils/duplicate-status.test.ts          # classifyMatchResolution cases
├── content/similar-diff.test.ts            # view-builder eligibility + both-options + render
├── content/ui/components/duplicate-badge.test.ts  # match_class routing + couldnt_verify + conflict
├── content/ui/overlay-bar.test.ts          # decision→submit params; block+retry; conflict block; double-submit; confirmations
└── api/quotewise-api.test.ts (or existing) # submit threads fields; error→couldnt_verify
```

**Structure Decision**: Single-project extension layout (existing). The feature is additive within current modules — no new directories, entry points, permissions, or dependencies. A new **pure classifier** in `utils/duplicate-status.ts` is the deterministic seam everything else routes through (keeps the badge/overlay thin and test-first per Article VI).

## Complexity Tracking

> No Constitution violations — no entries.
