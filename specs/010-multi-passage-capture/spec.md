# Feature Specification: Capture Multiple Passages from the Same Post

**Feature Branch**: `010-multi-passage-capture`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description: "Once we have captured a full-post quote, or a section of a longer post, we no longer have the option to capture a different section in the same post. Consider how to add this, what workflows/notifications/edge-case checks are needed, and what we show the user when a Sighting URL has multiple different captured quotes within it."

## Clarifications

### Session 2026-07-02

- Q: Scope of the "passages captured from this post" panel + toolbar badge count (US2) — the shared corpus (all users' captures at the URL) or the current user's captures only? → A: **Global** (shared corpus). The panel and count show every distinct passage captured at the URL by any user, using the shipped ADR-0007 response as-is. Per-user ownership labeling ("N passages, M yours") is deferred to a future enhancement (bead `qw-fcqd`, needs an additive backend ownership field).
- Q: How does the client decide the current selection is "already captured this passage" (block) vs a new passage (allow)? → A: **Normalized text match** — compare the selection against each returned passage after trimming, collapsing internal whitespace, and applying Unicode NFKC (mirrors the backend's `text_hash` normalization). Block on normalized equality; otherwise treat it as a new passage. The backend stays idempotent if a true duplicate slips through.
- Q: How does a user initiate capturing another passage — a persistent "capture another" button after each capture, or selection-driven? → A: **Selection-driven and contextual** (not a persistent button — that would disrupt the ~99% single-capture case). A new selection on a post whose URL already has a capture is the trigger: once the tray runs its logic it (1) notifies the user the post already has a captured quote, and (2) frames the action as adding another passage. Posts with no prior captures keep the current single-capture flow unchanged.

### Session 2026-07-13 (analyze remediation)

- Q: The automatic (page-load) preflight currently sends the full quote text before any explicit user action — outside Article II's identifier-only pre-action bound. Fix in this feature or defer? → A: **Fix here.** The passive preflight becomes **identifier-only** — tweet/user data within the `{tweet_id, handle, source_url}` allowlist (implemented as `{handle, source_url}` plus the fixed non-identifying `platform` constant); the quote-text send is removed. Exact per-passage identity is resolved **locally** by comparing the normalized selection against the URL-keyed `existing_sightings_for_url[]` list (returned from `source_url` alone). Text-bearing fuzzy/similar matching moves to **explicit selection** (an allowed explicit action). This **corrects a pre-existing Article II violation**; accepted tradeoff — the passive icon no longer shows pre-click fuzzy "similar" state (only URL-exact), resolving the moment the overlay opens or the user selects.
- Q: At exactly one captured passage, does the toolbar badge show "1" or a generic glyph? → A: **Numeric badge only at ≥ 2.** A single captured passage keeps today's generic collected/exists glyph; the number means "more than one passage here."
- Q: The backend returns at most 50 passages per URL; how do the panel and match behave beyond that? → A: **Qualify to the returned set.** Local exact-match runs against the full returned set (≤ 50); a match beyond it falls through to submit and is idempotently deduped by the backend. The panel **displays up to 5** snippets + a "+N more" indicator (from `existing_sightings_total`) — the display cap (5) is distinct from the backend return cap (50).
- Q: How is the new selection-watcher-on-all-posts behavior tested (Constitution VI.2)? → A: **Captured-HTML fixtures** for an ordinary post and an X Article characterize the in-post-content selection guard and the Shadow-DOM passages panel — not jsdom stubs alone.
- Q: The server kill-switch/min-version signal (V.2) and the scheduled live-X drift-check workflow (VI.3) don't exist in the repo. In scope? → A (revised 2026-07-13, analyze pass 2): **Split.** VI.3 (drift check) is **built here** (plan Phase 6; bead `qw-5j5nj`). V.2 (kill-switch) is deferred as a **standing tracked requirement** via **constitution amendment v1.1.0** (bead `qw-g4s31`) — not a per-feature gate until first shipped.

## User Scenarios & Testing *(mandatory)*

A single post — a long tweet, a thread, or an X Article — often contains more than one
quotable line. Today the overlay treats a post's URL as a **one-capture unit**: after a user
captures the full post or any one selection, re-opening the overlay on that URL shows
"Already Captured" with a disabled Submit, so a second, *different* passage from the same post
can never be captured. This feature lets a user capture several distinct passages from one post
and makes the overlay honest about how many passages a post already holds.

Terminology: a **passage** is a contiguous, verbatim excerpt the user selects (or the whole
post text when nothing is selected). Two passages from one post are two distinct quotes that
share one source URL.

### User Story 1 - Capture another passage from a post I already captured from (Priority: P1)

A user has already captured one passage (or the full text) from a post. They notice a second
quotable line in the same post, open the overlay again (or stay in it), highlight the new line,
and submit it as its own quote. The overlay recognizes that this selection is *new text* — even
though the post's URL already has a capture — and lets them submit, rather than blocking with
"Already Captured." Because most posts yield only a single quote, the extension adds no persistent
"capture another" control to that common flow; instead, a new selection on a post that already has
a capture is what surfaces a notice ("this post already has a captured quote") and reframes the
action as adding another passage.

**Why this priority**: This is the core gap and the entire reason for the feature — without it,
the multi-passage story does not exist. It is independently valuable and ships against the live
backend with no backend change (the write path already creates a distinct quote for distinct
text at the same URL; the block is entirely in the extension's duplicate classification).

**Independent Test**: On a long tweet or X Article, capture the full post; reopen the overlay,
highlight a *different* line, and confirm Submit is enabled and submitting creates a second,
distinct quote for the same URL. Re-selecting the *same* line still shows "Already captured
this passage."

**Acceptance Scenarios**:

1. **Given** a post whose URL already has one captured passage, **When** the user selects a
   different, non-overlapping line of the same post, **Then** the overlay treats it as a new
   quote and enables Submit (not "Already Captured").
2. **Given** a post whose URL already has a captured passage, **When** the user makes a new,
   distinct selection, **Then** the overlay notifies them that the post already has a captured
   quote and frames the submit action as adding another passage (e.g. "Capture another passage"),
   reusing the already-resolved author without a reload.
3. **Given** the user re-selects text that exactly matches a passage already captured from this
   post, **When** the duplicate check resolves, **Then** the overlay shows "Already captured
   this passage" with a link to view that quote, and Submit is disabled for that selection.
4. **Given** the user has selected a new passage, **When** they highlight a *different* range on
   the page instead, **Then** the preview and duplicate status update live to the new selection
   and Submit reflects the new selection's status.
5. **Given** a new passage is submitted successfully, **When** the confirmation is shown, **Then**
   the exact submitted text was visible to the user before submission (verbatim, no editable
   field), consistent with existing capture integrity.

---

### User Story 2 - See what a post already holds when it has multiple captured passages (Priority: P2)

When a user opens the overlay on a post that already has one or more captured passages, they see
how many passages exist and can jump to each on Quotewise. The toolbar action icon reflects that
the post has captures (and how many) without the user opening the overlay.

**Why this priority**: This turns the raw capability from US1 into an understandable state — it
answers "what's already here, and what's still worth capturing?" It depends on a backend
read-path change (delivering all distinct quotes for a sighting URL), so it follows US1 rather
than blocking it.

**Independent Test**: On a post with 3 captured passages, open the overlay and confirm a
"passages captured from this post" panel lists 3 entries (snippet + link each); confirm the
toolbar icon shows the count.

**Acceptance Scenarios**:

1. **Given** a post whose URL has multiple captured passages, **When** the overlay opens, **Then**
   it shows a "N passages captured from this post" panel listing **up to five** passages as short
   snippets, each linked to its quote on Quotewise when the link is valid, plus a "+N more" indicator
   when more passages exist than are shown.
2. **Given** a post whose URL has **two or more** captured passages, **When** the toolbar action icon
   resolves, **Then** it conveys the count (e.g. a small number on the badge) rather than a single
   generic "captured" glyph. A post with **exactly one** captured passage keeps the existing generic
   "captured" glyph (no number); the numeric badge starts at 2.
3. **Given** the user captures an additional passage, **When** the capture succeeds, **Then** the
   passage count and the panel update to include it (the previously cached duplicate status is
   refreshed, not stale) on the next open.
4. **Given** a post with no prior captures, **When** the overlay opens, **Then** no passages panel
   is shown and the toolbar icon shows the normal "new" state.

---

### Edge Cases

- **Same passage re-selected**: Exact-text match against an already-captured passage → "Already
  captured this passage" + View; Submit disabled. If the client ever mis-allows it, the backend
  is idempotent (re-confirms the sighting; no duplicate quote is created), so no data is corrupted.
- **Overlapping / near-identical selection** (e.g. the new selection contains or overlaps an
  existing passage but is not identical): treated as a *similar* match and routed through the
  existing sighting-vs-variant choice (spec 006), not silently duplicated or silently blocked. The
  near-match classifier MUST receive the current selection text so a near-identical selection at an
  **already-known URL** reaches the similar/variant path rather than being pre-empted as URL-exact
  (the short-circuit removed in FR-002).
- **Full post first, then a sub-section** (and the reverse): different text → a distinct new
  passage. Capturing a sub-section of an already-captured full post is allowed.
- **Empty or whitespace-only selection**: falls back to the full post text (existing selection
  behavior); the full-text passage's own captured/new status then applies.
- **Selection anchored outside the post content** (sidebar, nav, another post): rejected by the
  existing in-post-content guard; it does not become a passage.
- **Attribution conflict on a new passage**: if the new passage's text matches a quote attributed
  to a different originator, the existing attribution-conflict resolution path applies unchanged.
- **Post with many passages, user re-selects a passage that the read did not surface**: the
  "already captured this passage" detection is best-effort against the returned set; a missed
  match falls through to submit and is caught idempotently by the backend.
- **Unauthenticated / low-confidence extraction / unreadable post**: existing gates apply first;
  multi-passage capture never overrides the login requirement or the "couldn't read this reliably"
  refusal.
- **Collection destinations (spec 009)**: each passage is its own new quote with its own per-capture
  collection picker, seeded by spec 009's normal precedence (last-used → default → blank) — so a
  second passage in the same session is pre-seeded with the last-used set and remains editable per
  passage. No multi-passage-specific collection behavior is added.

## Requirements *(mandatory)*

### Functional Requirements

#### Capturing additional passages (US1)

- **FR-001**: The extension MUST allow a user to capture a passage whose normalized text differs
  from every passage already captured at the same source URL, even when that URL already has one or
  more captures.
- **FR-002** *(anti-regression to FR-001)*: The "already captured" block is **text-scoped**, never
  **URL-scoped** — a post merely having prior captures MUST NOT disable a new, distinct selection. A
  blocking decision MUST use the **resolved current text** — the selected excerpt, or the extracted
  full-post text when nothing is selected — and is non-blocking **only when no text can be resolved at
  all** (extraction unavailable/invalid), never merely because the URL has prior captures. The
  URL-presence short-circuit that returned `exact_sighting` for any prior capture is removed.
- **FR-003**: When the current selection matches a passage in the **returned set** of passages
  captured at this URL — compared after **normalization** (trim, collapse internal whitespace,
  Unicode NFKC; mirroring the backend's `text_hash`) — the extension MUST indicate "already captured
  this passage," offer a link to view **that specific matched quote** (the `existing_sightings_for_url[]`
  entry whose normalized text equals the selection — its validated `web_url`, not the first list
  entry), and MUST NOT submit it as a new quote. The returned set is capped (see FR-008); a passage
  beyond the returned set is not detectable client-side and falls through to submit, where the
  backend deduplicates idempotently.
- **FR-004**: Capturing an additional passage MUST be **selection-driven**, not a persistent
  control: the extension MUST NOT add a "capture another" affordance to the normal flow, and a post
  with **no** prior captures MUST keep the current single-capture experience unchanged. When the
  user makes a new selection on a post whose URL already has one or more captured passages, and that
  selection is a new passage (normalized-distinct per FR-003), the extension MUST (a) notify the
  user that the post already has a captured quote, and (b) present the submit action with
  intent-revealing copy (e.g. "Capture another passage" / "Add this passage"). Capturing another
  MUST reuse the already-resolved author and MUST NOT require reloading the page.
- **FR-005**: A change in the on-page text selection MUST re-run the passage/duplicate check for the
  new selection and update the notice and submit-action label accordingly — whether the selection is
  first evaluated when the overlay opens or changed while the overlay is open. This selection-driven
  re-check MUST apply to ordinary posts, not only long articles. Because the text-bearing fuzzy/similar
  lookup is non-blocking, a response for a **superseded** selection MUST NOT overwrite the current
  selection's state — the **newest selection wins** and stale responses are dropped.
- **FR-006**: The exact text of each passage MUST be shown to the user before submission, and the
  extension MUST NOT expose an editable quote-text field (capture integrity is unchanged; a
  passage is a verbatim excerpt only).
- **FR-007**: Each captured passage MUST be submitted with the post's source URL; distinct
  passages from one post MUST result in distinct quotes that share that URL (no new URL, no
  merging of distinct passages).

#### Surfacing multiple passages per post (US2)

- **FR-008**: When a post's URL has one or more captured passages, the overlay MUST show how many
  passages exist (from `existing_sightings_total`), **independent of the current selection's
  new/already-captured classification** — the panel appears whenever the URL has captures. It MUST
  display **up to 5** passages from the **returned set** (capped at 50 by the backend) as short
  **verbatim** snippets (the original `text`; normalization is used only for identity matching, never
  for display) — each **truncated to ~100 characters (by character count) with an ellipsis** and **linked to its
  quote on Quotewise when the link is valid** — plus a **"+N more"** indicator when more passages
  exist than are shown (N from `existing_sightings_total` minus the number shown). The count and list
  are **global** — every distinct passage captured at the URL by any user (the shared corpus), not
  scoped to the current user. Per-user ownership labeling ("N passages, M yours") is out of scope here
  (future enhancement — bead `qw-fcqd`).
- **FR-009**: The toolbar action icon MUST convey the **global** distinct-passage count as a numeric
  badge **only when the count is ≥ 2**, distinct from the "new quote" and single-capture
  presentations. A count of exactly **1** keeps the existing single-capture glyph (no number); a
  count of **0** shows the "new" state. The badge **MAY saturate** (e.g. "9+") given its ~4-character
  limit, **provided the accessible action title always states the exact count** in words. If the count
  cannot be validated, the icon shows a neutral "has captures" state with **no number** (never a wrong
  count).
- **FR-010**: After a successful capture, the extension MUST refresh (not reuse stale) the cached
  duplicate/passage status for the post so the count, the passages panel, and the toolbar icon
  reflect the newly added passage.
- **FR-011**: The passages panel and count MUST be accurate to the distinct quotes actually
  recorded at the URL. All consumed fields MUST be validated at runtime — arrays checked as arrays,
  `existing_sightings_total` accepted only as a non-negative integer — and if the underlying data is
  missing, malformed, or cannot be obtained, the extension MUST degrade to a **neutral state**
  (e.g. "this post already has captures") rather than showing a wrong count or throwing.

#### Cross-cutting

- **FR-012**: All new copy MUST be honest and MUST NOT overstate capture or verification (no
  "verified," no fake counts). Status MUST be conveyed by glyph/text, not color alone, and new
  controls MUST be keyboard-operable with ARIA labels.
- **FR-013**: Multi-passage behavior MUST NOT override the login requirement, the low-confidence
  "couldn't read this reliably" refusal, or the privacy boundary on pre-action network calls.
- **FR-014**: The **passive (page-load) preflight** MUST NOT include quote text or any tweet/user data
  **beyond** `{handle, source_url}` (⊆ the Article II allowlist `{tweet_id, handle, source_url}`) —
  that set is its entire tweet/user-data egress. The request also carries the fixed non-identifying `platform`
  client constant (`"twitter"`), permitted per Art. II.1 (amendment v1.1.0) as a build constant that
  carries no user information beyond what `source_url` already encodes. Exact per-passage
  identification is performed **locally** against the URL-keyed `existing_sightings_for_url[]` list
  (retrieved from `source_url` alone). Any **text-bearing** lookup (fuzzy/similar matching) MUST
  occur only on an **explicit user action** (a text selection or the overlay opening), never during
  passive preload. This **restores Article II compliance**: the automatic preflight previously sent
  quote text (`text: postData.text`) before any explicit action; this feature removes it. Accepted
  tradeoff — the passive toolbar icon reflects only URL-exact state (not fuzzy "similar") until the
  user acts.

### Key Entities *(include if feature involves data)*

- **Passage**: A contiguous, verbatim excerpt of a post's text selected by the user (or the whole
  post text when nothing is selected). Identity is the passage's text compared **normalized** (trim,
  collapsed whitespace, NFKC — matching the backend's dedup); there are no offsets or anchors. A
  passage becomes one quote.
- **Post / Sighting URL**: The source URL where passages are observed. One URL may hold many
  distinct passages (quotes); one quote may be sighted at many URLs. The URL is not a unique key
  for a quote.
- **Passage set for a URL**: The collection of **all** distinct quotes recorded at a given source
  URL (the shared corpus — any user's captures), each with its text and a link — the basis for the
  count, the passages panel, and the icon badge.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can capture a second, distinct passage from a post they have already captured
  from, in the same overlay session, without reloading the page.
- **SC-002**: Re-selecting an already-captured passage results in a "already captured this passage"
  outcome 100% of the time it is detectable, and never silently creates a duplicate quote (the
  worst case is an idempotent no-op).
- **SC-003**: When a post has multiple captured passages, the overlay shows the correct count and
  links to the **displayed** passages (up to five, each linked when valid, plus "+N more"); the
  toolbar icon reflects the count (saturating at "9+", with the exact count in its accessible title).
- **SC-004**: Capturing an additional passage takes no more user steps than capturing the first:
  **select → submit**, where the submit button is relabeled "Capture another passage." No extra
  interaction is added — there is no persistent "capture another" control (per FR-004).
- **SC-005**: After adding a passage, the reflected count and passages panel are up to date on the
  next open (no stale "one fewer" state).
- **SC-006**: No regression to first-capture behavior, capture-integrity gates, or the existing
  duplicate/similar/conflict flows for posts with a single or no prior capture.

## Assumptions

- **Backend write path is ready as-is**: submitting distinct text at an already-captured URL (with
  no explicit link-to-existing intent) already creates a distinct quote + sighting; identical text
  is idempotent. No backend write change is assumed (verified against the sibling backend).
- **Backend read path delivered (ADR-0007)**: `check_duplicate` now returns *all* distinct quotes
  for a sighting URL — each with text and a `short_code`/`web_url` link — plus a top-level
  `existing_sightings_total` (list capped at 50). Implemented and deploying to production 2026-07-02
  (bead `qw-1jzc`). The list is global (not user-scoped). **US1 depends on ADR-0007's response *text*
  shape** — `existing_sightings_for_url[].text` is exactly what US1's local text-scoping compares the
  selection against — but US1 does **not** depend on US2's presentation (panel/count/badge). US2
  additionally consumes the count and link fields for its panel and badge.
- **A passage is verbatim excerpt text only** — no start/end offsets or DOM anchors are stored;
  text identity is sufficient because the backend deduplicates on normalized text + originator.
- **Same author across passages**: all passages from one post share the post's originator, so the
  originator resolved for the first passage is reused for subsequent passages in the same session.
- **Existing selection, similar/variant, conflict, and collection-picker behaviors are reused**
  rather than reinvented (specs 003, 006/002, 009).

## Dependencies

- **ADR-0007** — backend read path: deliver all distinct quotes for a given sighting URL (each with
  text + link + `existing_sightings_total`). **Implemented and deploying to production (2026-07-02;
  bead `qw-1jzc`)** — neither story is backend-blocked. **US1 depends on the `text` field** (its local
  text-scoping compares the selection against `existing_sightings_for_url[].text`); **US2 depends on
  the count and link fields** (panel + badge). The list is global (all users' captures); per-user
  ownership labeling is a future enhancement (bead `qw-fcqd`).
- **Spec 009 (collection picker)** — composes per passage; must remain functional per-capture.
- **Spec 006 / ADR-0002 (sighting vs variant)** — the near-match path a near-identical passage
  routes through.
- **Spec 003 (DOM parsing / selection)** — the selection/excerpt primitive multi-passage builds on.

## Out of Scope

- Editing, merging, splitting, or deleting existing passages/quotes from the overlay.
- Any offset/anchor/highlight-persistence model for passages (text identity only).
- Per-user ownership labeling of the passages panel/count ("M of N are yours") — the panel is global
  for this spec; ownership labeling is a future enhancement (bead `qw-fcqd`, needs an additive
  backend ownership field).
- Capturing passages across *different* posts/URLs in one action.
- Backend changes to the write/dedup path (none are needed).
- Cross-device or historical listing of a user's passages beyond what a post's URL surfaces.
- **Server kill-switch / minimum-version signal (Constitution V.2)** — a **standing tracked
  requirement** per constitution amendment v1.1.0 (bead `qw-g4s31`); deferred, not built here.
  *(The scheduled live-X drift check, Constitution VI.3, **is** built by this feature — see the plan's
  Phase 6, bead `qw-5j5nj`.)*

## Constitution Notes

- **Article I (Capture Integrity)**: Preserved. Each passage is a verbatim excerpt shown before
  submission; no editable text field; no silent submission. §2 explicitly permits narrowing to a
  contiguous excerpt — multiple passages are multiple such excerpts.
- **Article VII (User Experience)**: New copy must be honest (no overstated counts/verification),
  status conveyed by glyph/text not color alone, controls keyboard-operable with ARIA labels; the
  overlay remains invited-only.
- **Article II (Privacy)**: **Strengthened.** The passive (page-load) preflight's tweet/user-data
  egress becomes `{handle, source_url}` (⊆ the allowlist), plus the fixed non-identifying `platform`
  client constant permitted per Art. II.1 (amendment v1.1.0); the quote-text send in the automatic
  preflight is removed (FR-014). Exact per-passage matching runs **locally** against the URL-keyed
  passage list; text-bearing (fuzzy) lookups occur only on explicit action. This **corrects a
  pre-existing Article II violation** — the automatic preflight previously sent quote text before any
  explicit action. Refreshing passage status after a capture stays within this pre-action bound; quote
  text still leaves only on explicit action.
- **Article V (Resilience)**: The passages panel/count MUST validate consumed fields at runtime
  (arrays as arrays, `existing_sightings_total` as a non-negative integer) and degrade to a neutral
  state on unexpected or missing data rather than throwing (FR-011).
- **Article VI (Quality & Testing)**: Deterministic logic (normalize / classify / count /
  badge-resolve) is developed test-first. The new selection-watcher-on-all-posts behavior and the
  Shadow-DOM passages panel are characterized against **captured-HTML fixtures** — an ordinary post
  and an X Article — per §2, not jsdom stubs alone.
- **Article V.2 (kill-switch)**: deferred as a **standing tracked requirement** per constitution
  amendment v1.1.0 (bead `qw-g4s31`) — not a per-feature gate until first shipped.
- **Article VI.3 (live-X drift check)**: **built by this feature** (plan Phase 6, bead `qw-5j5nj`) —
  a scheduled, non-blocking workflow that files a tracked issue on selector drift.
