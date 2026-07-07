# Quickstart: Capture Multiple Passages from the Same Post (Spec 010)

## Prerequisites

- Bun (project uses Bun; `bun run` scripts).
- ADR-0007 backend deployed (`existing_sightings_for_url` returns all distinct quotes at a URL with
  `text`/`short_code`/`web_url` + `existing_sightings_total`). US1 works without it; US2 needs it.

## Build & load

```bash
bun run dev           # webpack watch build to dist/
# then: chrome://extensions → Developer mode → Load unpacked → dist/  (reload after each build)
```

## Test (test-first for deterministic logic — Art. VI)

```bash
bun run test -- tests/utils/quote-text.test.ts            # normalizeQuoteText (NFKC + collapse + trim)
bun run test -- tests/utils/duplicate-status.test.ts      # text-scoped classifier
bun run test -- tests/background/icon-state-resolver.test.ts   # count badge state (≥2)
bun run test                                              # full suite (regression)
bun run type-check && bun run lint
```

Key unit assertions:
- **normalize**: NFKC + collapsed whitespace + trim; `"  A\n B "` and `"A B"` normalize equal.
- **classifier (text-scoped)**: a URL with a prior passage **and a different** current selection ⇒
  **not** `exact` (allow); the **same** selection (normalized) ⇒ `exact` (block). This is the
  regression that proves the URL-scoped short-circuit is gone.
- **icon resolver**: `existing_sightings_total >= 2` ⇒ count badge state; `1` ⇒ single-capture glyph;
  `0` ⇒ new. Missing total ⇒ falls back to list length.
- Selection-driven overlay tests use the existing `window.getSelection()` stub (see `tests/setup.ts`).

## End-to-end (manual) — on a long tweet / thread / X Article

1. **Capture the full post** (or one passage). Submit → success.
2. **Reopen the overlay, highlight a *different* line.** ⇒ Submit is **enabled**, action reads
   "Capture another passage," and a notice shows the post already has a captured quote. Submit ⇒
   backend `action="created"` (a second distinct quote at the same URL).
3. **Reopen, re-highlight passage #2.** ⇒ "Already captured this passage" + View; submit disabled.
   (Even if it slipped through, the backend returns idempotent `sighting_added` — no duplicate.)
4. **US2 panel:** the overlay shows "N passages captured from this post" listing each passage
   (snippet + working link to `web_url`).
5. **US2 badge:** the toolbar icon shows the count (e.g. `2`) once the post has ≥2 passages; hovering
   the icon reads "… N passages captured from this post" (screen-reader accessible title).
6. **Common case unchanged:** on a post with **no** prior captures, the overlay behaves exactly as
   today — no extra button, no notice.

## Verify no regressions / constitution

- First-capture flow, similar/variant (spec 006) and attribution-conflict paths unchanged for
  single/zero-capture posts.
- No new manifest permissions; `git diff manifest*.json` empty.
- No new pre-action network call; badge count reads an existing preload response field.
- `web_url` links only navigate on http/https (`safeHref`).
