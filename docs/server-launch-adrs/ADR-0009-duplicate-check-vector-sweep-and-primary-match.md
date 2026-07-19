# ADR-0009 — Duplicate-check: vector sweep, mixed match list, server-selected primary

- **Status:** ✅ Backend implemented 2026-07-19 (branch `feat/vector-dupe-check` in `quotewise`) · Chrome client changes NOT started
- **Date:** 2026-07-19
- **Priority:** P1 (fixes an ~8s invisible check and a cross-originator detection gap)
- **Related beads:** `qw-5bbs8` (vector path — owns this), `qw-ym2km` (backend cleanup), `qw-h16j6` (verifying feedback), `qw-z5684` (epic)
- **Extends:** ADR-0001 (match provenance) — `match_class` semantics are unchanged
- **Endpoints:** `POST /v1/quotes/check_duplicate/`, `POST /v1/quotes/preflight/`

## Context

The duplicate check took ~8s and ran invisibly. The cause was not the trigram index, as
originally assumed — measured against production (621,891 rows):

| approach | time |
|---|---|
| as-written (unscoped trigram fallback) | 8.2s |
| **using** the GIN trigram index | 42.5s — 5× *worse* |
| trigram floor (any index/threshold/parallelism) | ~4s |
| HNSW vector query | **9.2ms** |

At the default `pg_trgm` threshold a 128-char string matches 316,691 rows — over half the
table — so the bitmap goes lossy and rechecks 445K rows. No amount of tuning fixes that.

The backend now runs a pgvector sweep against the existing HNSW index instead. Two consequences
matter to the client:

1. **Cross-originator detection is now free and always-on.** Previously it only ran when the
   originator-scoped pass found *nothing* (`if not matches`), so any weak same-originator hit
   suppressed attribution-conflict detection entirely. It is now the same result set.
2. **`matches` is no longer homogeneous.** It used to be all-same-originator *or*
   all-different-originator, never mixed. It is now one distance-sorted list containing both.

Both engines are retained: measured over 764 curator-labeled near-duplicate pairs, trigram and
vector each catch 97.4% but **miss different pairs** (union 98.3%). Trigram's unique saves are
`trgm=1.000` variants differing only by a trailing period or curly-vs-straight apostrophes —
which vector's top-K loses to crowding and exact-match cannot catch.

## Decision

### Response additions (all additive — no field removed, no type narrowed)

```jsonc
{
  "matches": [
    {
      // ... all ADR-0001 fields unchanged ...
      "primary": true,                    // NEW — the match driving recommendation/headline state
      "different_originator": false,      // NOW ALWAYS PRESENT (was set only on broad-search hits)
      "match_engine": "lexical" | "semantic" | "url",  // NEW — which engine produced this match
      "similarity": 93.1                  // unchanged scale: 0-100, higher is better
    }
  ],
  "search_metadata": {
    "vector_search_used": true,                 // NEW
    "vector_search_skipped_uncached": true,     // NEW — preflight only, see below
    "cross_originator_match_found": true        // NEW
  }
}
```

`similarity` **keeps its 0-100 higher-is-better scale** even for semantic matches (L2 distance is
mapped, not passed through). Client comparisons do not invert.

`match_class` is unchanged from ADR-0001 — `conflict` still means "matched a *different*
originator".

### Telling "exact text, different originator" apart from "merely similar, different originator"

`match_class` collapses both cross-originator cases to `conflict`, and they demand opposite UI: the
first should hard-block submission, the second is tentative and blocking on it would be infuriating.
**Use `match_type`, which already carries the distinction** — so the no-similarity-math rule below
still holds:

| `match_type` | `match_class` | client behaviour |
|---|---|---|
| `exact_different_originator` | `conflict` | **hard block** — this exact text is on record under someone else |
| `near_different_originator` | `conflict` | advise only — something similar exists elsewhere |

`exact_*` is **never inferred from vector distance** — not even distance 0.0. It is claimed only on
proven byte equality with the candidate's text, which is how "exact" is defined everywhere else in
the backend (the exact-text path uses `filter(text=text)`). So `exact_different_originator` is a
fact, not a threshold judgement.

This deliberately avoids orthogonalising `match_class` into a pure strength signal. Doing that would
make an exact cross-originator hit arrive as `match_class: 'exact'`, and un-updated clients would
read it as "same quote" and offer *add sighting* — attaching a sighting to **another originator's**
quote. ADR-0001's definition of `conflict` is left exactly as written, so nothing already shipped
breaks.

`exact_different_originator` also drives the `attribution_conflict` / `attribution_conflict_resolved`
values of the top-level `recommendation` field.

### Server owns thresholds and precedence

The client performs **no** similarity math and **no** precedence inference. Bands are calibrated
server-side (L2 ≤ 0.35 duplicate, ≤ 0.6 review) against the labeled pair set, and the server picks
the primary match: **same-originator always outranks cross-originator regardless of score.**
Someone re-capturing a quote already attributed to their originator must see "you already have
this", not an attribution conflict that happens to sit closer in the embedding space.

### Back-compat: no coordinated deploy required

The server **sorts the primary match to index 0**. Current extension builds read `matches[0]` and
will keep behaving exactly as they do today. The client changes below are an improvement, not a
prerequisite — the backend can ship first.

## Required client changes

### 1. Select by class, not by position — `src/utils/duplicate-status.ts:121-133`

`classifyMatchResolution` currently collapses the list to `matches[0]`. That was safe only while
the list was homogeneous.

```ts
// BEFORE
const match = Array.isArray(result.matches) ? result.matches[0] : undefined;

// AFTER
const matches = Array.isArray(result.matches) ? result.matches : [];
const match = matches.find(m => m.primary) ?? matches[0];   // ?? keeps old servers working
```

Do **not** reintroduce a positional or threshold-based rule here.

### 2. Add the "show similar quotes by other originators" toggle

No new API field is needed — filter the existing list:

```ts
const conflicts = matches.filter(m => m.match_class === 'conflict');
```

Render the primary match as the headline state and conflicts as a secondary, collapsible line.
Measured: a real in-originator duplicate and a cross-originator conflict coexist in **3.3%** of
cases, so the secondary line must not replace the primary one.

### 3. Type additions — `src/types/api.ts:56-74`

```ts
primary?: boolean;
different_originator?: boolean;
match_engine?: 'lexical' | 'semantic' | 'url';
```

Keep them optional so older server responses still typecheck.

### 4. Deletions

- `src/background/api-handler.ts:227` — `similarityThreshold: 0.8` in the error payload. Vestigial;
  nothing reads it, and thresholds are server-owned.
- `src/types/api.ts:57` — `version_id: number` is declared **required** but the server has never
  emitted it.

### 5. New: `attribution_conflicts` on the create response

`POST /v1/quotes/` now returns an optional `attribution_conflicts` array (present only when
non-empty) alongside the existing `action` / `message` / `quote` / `similarity_score` fields:

```jsonc
{
  "action": "created",
  "quote": { /* … */ },
  "attribution_conflicts": [
    { "quote_id": "…", "text": "…", "originator": {…}, "similarity": 96.4,
      "match_type": "exact_different_originator", "match_class": "conflict",
      "different_originator": true, "match_engine": "semantic" }
  ]
}
```

**Advisory only.** The quote was still created (or the sighting still attached) per the lexical
decision — this never changed the outcome, it reports what else is on record. Surfacing it as a
post-submit heads-up is the intended use; do **not** treat it as a failure or roll back the capture.

Empty when the text had no cached embedding, because surfacing must not add a Bedrock call to a
write. In practice the preceding duplicate check has cached it.

### 6. Preflight expectations changed

`preflight/` never generates an embedding (it would add a ~105ms Bedrock call to a path that runs
on hover/selection). It runs the vector sweep **only when the query embedding is already cached**,
signalled by `search_metadata.vector_search_skipped_uncached`. So preflight may legitimately return
fewer matches than a subsequent `check_duplicate/` for the same text. Treat preflight as a warm
preload, never as authoritative absence-of-duplicates.

## Latency budget (production, us-west-2)

| step | cost |
|---|---|
| Bedrock titan-embed (skipped on cache hit) | ~105ms |
| HNSW top-k | ~10ms |
| scoped trigram | 18–76ms |
| **total** | **~200ms** (was ~8,200ms) |

The check is now fast enough that gating Submit on it is unnecessary — that decision (`qw-h16j6`)
stands. What remains is showing non-blocking "verifying…" feedback while it runs.

## Verification

1. Capture a quote whose text exists **verbatim** under a **different** originator → expect
   `match_type: "exact_different_originator"`, `match_class: "conflict"`, and a top-level
   `recommendation` of `attribution_conflict`. Capture one that is merely *similar* to another
   originator's quote → expect `near_different_originator` with the same `match_class`. These two
   must be distinguishable without inspecting `similarity`.
2. Capture a quote that exists under **the target** originator *and* a different one → expect both
   in `matches`, with the same-originator one carrying `primary: true` at index 0.
3. Confirm an un-updated extension build behaves identically to today (primary-first ordering).
4. Preflight a never-before-seen text → `vector_search_skipped_uncached: true`, no Bedrock call.

## Notes

- A separate finding from the same investigation: ~4% of public quotes have an *unlabeled*
  near-duplicate (curly vs straight quotes, contractions, trailing periods) — roughly 12,000 pairs.
  Tracked as `qw-sx0e1`; not client-facing, but it means conflict/similar volume may rise once that
  cleanup runs.
