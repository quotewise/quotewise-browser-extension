# Quickstart — Similarity Duplicate Sighting/Variant

## Build & test

```bash
bun run test        # Jest (jsdom) — new + existing suites must stay green
bun run type-check  # tsc --noEmit
bun run lint        # eslint
bun run build       # production bundle (load dist/ unpacked in chrome://extensions)
```

TDD order (Article VI — failing test first): `classifyMatchResolution` → `buildSimilarMatchView` → API client param threading → `duplicate-badge` routing → `overlay-bar` decision/submit.

## Manual verification (load `dist/` unpacked, sign in)

Each maps to a spec acceptance scenario. Use tweets that the backend classifies into each `match_class` (or stub the duplicate-check response via the API).

1. **Similar, tweet older (US1/AS1)** — capture a tweet whose text near-matches an existing same-originator quote, where the tweet predates the recorded quote. Overlay shows the existing quote + word-diff and **two** buttons: "Add another sighting" and "Add as variant".
   - Click **Add another sighting** → "Sighting added"; verify in Quotewise: a new sighting on the existing quote, **no new quote** (AS3).
   - (Re-run) Click **Add as variant** → "Added as variant"; verify a new quote linked as a needs-review variant (AS4).
2. **Similar, tweet not older (US1/AS2)** — same but the tweet is newer/equal/unknown date. Overlay offers **only** "Add as variant".
3. **Conflict (US3)** — capture text already attributed to a *different* originator. No sighting/variant buttons; **Submit is blocked**; an "already attributed to {other}" notice + a resolve-in-Quotewise link appears.
4. **Couldn't verify (US2)** — simulate a duplicate-check failure (offline, or backend 5xx). Overlay shows "⚠️ Couldn't verify duplicates", **Submit disabled**, **Retry** offered; no silent new-quote state. Click Retry once reachable → transitions to the correct state.
5. **Exact / already captured (edge)** — unchanged "Already captured" single action.
6. **Double-click guard (FR-011)** — double-click a decision button → exactly one network submission (check DevTools Network).
7. **Accessibility (SC-006)** — tab to each new control, activate via keyboard; verify focus visibility, `aria-label`s, and that status is conveyed by text/glyph (not color alone).
8. **Degradation (FR-013)** — with a response lacking `match_class`/`match_source`, the overlay falls back to the prior recommendation-based badges without error.

## Done = all spec Success Criteria (SC-001…008) demonstrable + suites green + type-check/lint clean.
