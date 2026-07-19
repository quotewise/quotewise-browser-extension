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

### Relation labels: don't render a variant group as independent candidates

Every match now carries three relation fields, free of extra queries (they are plain columns
already loaded by the dedup queryset):

```jsonc
"quote_role": "canonical",      // canonical | translation | variant | disputed | nested | …
"has_relations": true,
"canonical_quote_id": "…"       // null when this match IS the canonical
```

**Why they exist.** The vector sweep is unfiltered and returns up to 20 neighbours, so it routinely
returns *several members of one variant group at once*. Before these fields, they arrived as
independent, unlabelled candidates — so the tray would offer a "link as variant" decision for a
group that already exists, and the curator could create a second edge over the same pair.

**Suggested use:** group matches by `canonical_quote_id` (falling back to `quote_id` for the
canonical itself) and render one row per group with the members collapsed under it. Label a
non-canonical member as a known variant rather than offering it as a fresh link decision.

#### ⚠️ Treat these as display hints, not as proof

Measured against production 2026-07-19:

| claim | reality |
|---|---|
| `has_relations: true` | reliable — 0 rows claim it without an edge |
| `has_relations: false` | **NOT proof of "no relations"** — 948 quotes have edges but the flag is false |
| `quote_role: "variant"` | **NOT proof of a variant edge** — 1,780 rows carry the role with no backing edge |
| `canonical_quote_id: "…"` | reliable when present (a real FK); absence proves nothing |

`quote_role` is a curator-set label, not a value derived from the relation graph, so the two drift.
Use these fields to *decorate* what you show. Do **not** use `has_relations: false` to conclude a
pair is unlinked and therefore safe to link — that is wrong on ~948 quotes today, and it produces
exactly the duplicate-edge bug the fields were added to prevent.

#### ✅ Use `relations` for anything that gates a write

Each match now also carries authoritative edges read from the relation graph itself — no
denormalization, so no drift:

```jsonc
"relations": [
  { "other_quote_id": "…", "relation_type": "variant", "direction": "outgoing" }
]
```

Always present (`[]` when there are none). Scope is edges **between the returned matches**, which
answers the question that matters in the tray: *are these two results already linked, so should I
not offer the link decision again?* Both endpoints of an edge are recorded, so either match answers
it without reconstructing direction from the other row.

Edges to quotes *outside* the result set are not reported — they would enlarge the payload without
being actionable; `canonical_quote_id` already hints at group membership.

**Decision rule:** use `relations` to decide whether to offer a link action. Use `quote_role` /
`has_relations` only to decorate what you render. One indexed query, measured 0.162ms server-side,
and skipped entirely when fewer than two matches come back.

### When `originator_slug` is omitted — badge status without a known originator

Previously this path was both **incoherent and slow**, so it was not usable for badge status. Both
are fixed; it is now a supported flow.

**What you get.** With no originator claimed there is nothing to conflict *with*, so matches are
classified on strength alone:

| field | value when no originator is supplied |
|---|---|
| `different_originator` | always `false` |
| `match_class` | `exact` or `similar` — **never `conflict`** |
| `match_type` | `exact_same_originator` / `near_same_originator` / `similar` |
| `originator` | the matched quote's *actual* originator — read the attribution from here |

So the badge can say *"already in Quotewise — attributed to X"* by reading `match.originator`.
Conflict only becomes meaningful once the user names an originator; re-run the check then.

> Until this change the two engines disagreed with each other on this path: the lexical pass
> reported `different_originator: false` / `match_class: similar` while the vector pass reported
> `true` / `conflict` for the *same request*, because both short-circuited on "is an originator
> set?" in opposite directions. The label tracked which engine happened to find the match. If you
> wrote any client logic against the old behaviour, discard it.

**Latency.** This path used to run an unscoped trigram scan (8.2s) preceded by a 474ms sequential
exact-text scan. It is now **~10ms** (plus ~105ms if the query embedding is uncached) — an indexed
exact-text lookup plus the vector sweep, which is originator-agnostic by construction.

**One recall caveat.** The no-originator path no longer runs the lexical trigram pass, which is the
only engine that catches punctuation-only variants (a trailing period, curly vs straight
apostrophes) — 7 of 764 labeled pairs in the calibration set. Exact text and semantic neighbours
are still caught. This was accepted deliberately because a capture cannot be submitted without an
originator, so the no-originator check is advisory. Do **not** treat an empty result here as proof
the quote is new; re-check once the originator is chosen.

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

## Amendment — 2026-07-19: the badge path checks URLs, not text — and stays that way

Reported case: a tweet by `@J_D_Landis` (not an originator) carrying a near-verbatim Asimov
quote that *is* in Quotewise. With the tray shut the toolbar badged `@` "originator not in
Quotewise"; opening the tray flipped it to `~`.

The cause is not an embedding cache miss, as first assumed. The badge path never sends the text at
all. Having found that, the question became whether to change it — and the answer is no.

### 1. The automatic preflight omits the post text

`checkQuoteCollectionStatus` sends `{ handle, platform, source_url }` and **no `text`**
(`service-worker.ts:2705`). `api-handler.ts:403` then falls back:

```ts
const duplicateProbe = typeof text === 'string' ? text : source_url;
```

So the duplicate check that drives the toolbar badge asks whether
`https://x.com/J_D_Landis/status/…` is a duplicate of any quote. URL-based sighting lookup still
works — that is the separate `source_url` parameter — but **text similarity is structurally
impossible on the badge path**, with or without an embedding.

This is almost certainly a leftover from the 8.2s era: the automatic path could not afford a text
check, so it degraded to URL-only. This ADR removed the performance reason — but see below, where
the behaviour is kept on different grounds.

### 2. Decision: keep it that way — text travels only on explicit engagement

What began as a performance workaround is hereby **ratified as a privacy boundary**. The automatic
preflight stays URL-scoped. Post text is sent only when the user opens the tray, which is the first
moment they have expressed any intent to interact with Quotewise.

The alternative was tested against and rejected: send the text on the automatic preflight, and have
preflight warm the embedding so the badge could report text similarity at a glance. It was
attractive on accuracy grounds — the §6 objection ("a path that runs on hover/selection") does not
even describe this path, since `runAutomaticPreflightForExtractedPost` fires once per post page and
selection-driven checks already go through `CHECK_DUPLICATE`, and the embedding cost is per unique
text, once, cached and shared.

**It was rejected anyway**, on two grounds that outrank badge accuracy:

1. **It collects data without intent.** Merely viewing a post would POST its full text to
   Quotewise and retain an embedding of it. The user has not asked for anything at that point.
   "We run a duplicate check on the text of every post you view" is not a description this product
   wants to have to make.
2. **It does not scale to where capture is going.** The boundary that is defensible for post pages
   collapses the moment capture extends toward general browsing. Better to hold the line while it
   is cheap to hold than to retreat from it later.

Private mode, which skips preflight entirely, remains a separate and stronger opt-out.

### Accepted consequence

The toolbar badge is **URL-scoped until the tray is opened**. It can say "this post already has
captures" and "this handle is not an originator"; it cannot say "this text is already in
Quotewise". So the reported case badges `@` at rest and becomes `~` when the tray opens and the
first text-bearing check runs.

This is a known, accepted side-effect, not a defect: the badge reports everything it is entitled to
know, and improves the moment the user shows intent. Do not "fix" it by moving text earlier.

Left open deliberately: `New` still reads *"New quote — not in Quotewise yet"* on a check that
never examined the text. That claim is now knowingly stronger than its evidence. Retitling it is a
candidate if it ever misleads in practice.

## Latency budget (production, us-west-2)

**With an originator** (the normal capture flow):

| step | cost |
|---|---|
| Bedrock titan-embed (skipped on cache hit) | ~105ms |
| HNSW top-k | ~10ms |
| scoped trigram | 18–76ms |
| pairwise relation edges | 0.16ms |
| **total** | **~200ms** (was ~8,200ms) |

**Without an originator** (badge status before attribution is known):

| step | cost |
|---|---|
| Bedrock titan-embed (skipped on cache hit) | ~105ms |
| indexed exact-text lookup (`text_hash`) | 0.03ms |
| HNSW top-k | ~10ms |
| **total** | **~10ms warm / ~115ms cold** (was ~8,700ms) |

The old no-originator figure includes a 474ms sequential exact-text scan that ran *before* the 8.2s
trigram; the indexed lookup replaced it.

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
5. Check a quote **omitting `originator_slug`** → every match must have `different_originator: false`
   and `match_class` of `exact` or `similar`, never `conflict`. `search_metadata` carries
   `lexical_search_skipped_unscoped: true`. Should return in ~10ms warm, not seconds.
6. Return two matches that are already linked as variants → both carry each other in `relations`,
   with opposite `direction` values. Return two unlinked matches → both carry `relations: []`.

## Notes

- A separate finding from the same investigation: ~4% of public quotes have an *unlabeled*
  near-duplicate (curly vs straight quotes, contractions, trailing periods) — roughly 12,000 pairs.
  Tracked as `qw-sx0e1`; not client-facing, but it means conflict/similar volume may rise once that
  cleanup runs.
