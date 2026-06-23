# Feature Specification: Per-Capture Collection Picker & Add-to-Collection for Existing Quotes

**Feature Branch**: `009-collection-picker`

**Created**: 2026-06-22

**Status**: Draft

**Input**: User description: "Add a per-capture collection picker to the capture overlay, and let users add already-captured ('already on the site') quotes to their own collections — including showing whether a quote is already in one of their collections."

## Clarifications

### Session 2026-06-22

- Q: How should the inline "create a new collection" capability (FR-003) be resolved in the frozen API contract? → A: Defer inline-create — v1 lists existing collections only; no create-collection endpoint is added. Inline creation moves to a follow-up spec.
- Q: When a NEW quote is captured into multiple collections and the quote is created but one collection-add fails, what happens? → A: The capture always survives (never rolled back over a filing failure); the overlay stays open showing per-collection outcome + retry. Inline retry is the target but MAY degrade to "capture + warning + auto-hide" if idempotency edge cases prove hard — the surviving capture is the non-negotiable invariant.
- Remediation (analyze C1/C2/I1/U1, 2026-06-22): (C1) the collection list is fetched ONLY on explicit picker open and cached — never preloaded on tweet-page load — to satisfy Article II.1; FR-022/FR-023 updated. (C2) added a store-listing/privacy-policy disclosure task (T025) for the new fetch/cache/synced last-used set (Article II.3). (I1) capture-survival and honest failure-surfacing are MUST; inline retry is the SHOULD target with a defined warning+auto-hide fallback (FR-013/FR-015/SC-005 reconciled). (U1) capturing with zero collections selected is explicitly allowed (FR-002).
- Backend realignment (ADR-0006 resolution, 2026-06-22): the membership add reuses the existing **slug**-keyed `POST /v1/collections/{slug}/quotes/` (no new endpoint); `member_collections` is `{ slug, name }` and always present (empty `[]` when none); errors are 404 (not-owned) / 400 (missing quote). The extension keys collections by **slug** everywhere (picker, last-used set, default setting) and ignores the UUID `id`; `POST /v1/quotes/` accepts a slug in `collection_id` for new captures.

## User Scenarios & Testing *(mandatory)*

Today the extension can attach a capture to a single, pre-configured "default" collection (the "Auto-add Captures" toggle + default-collection selector, which currently live only on the options page). Two gaps motivate this feature:

1. **No one-off destination choice.** A user cannot decide, at the moment of capture, *which* collection(s) a quote should go into instead of their default — e.g. filing quotes by a specific author during a research project, or fanning a quote out to several personal collections.
2. **Dead end on already-captured quotes.** When a quote is already in Quotewise and capture is blocked, the overlay neither indicates whether that quote is already in one of the user's own collections, nor offers a way to add the existing quote to their collection.

### User Story 1 - Pick the destination collection(s) at capture time (Priority: P1)

A user is capturing a brand-new quote. Beside the capture action, a collection picker lets them tick one or more of their existing collections, and the quote is filed into exactly those collections — overriding their usual default for this capture only, without changing the default for future captures.

**Why this priority**: This is the core gap and the smallest slice that delivers standalone value. It turns the extension from "everything lands in one default bucket" into "I decide where this one goes," which is the heart of the research-project and multi-collection workflows the user described.

**Independent Test**: With at least two collections configured, capture a new quote, tick a non-default existing collection, complete the capture, and confirm in Quotewise that the quote landed only in the chosen collection(s) and that the user's default collection is unchanged for the next capture.

**Acceptance Scenarios**:

1. **Given** an authenticated user on a tweet page with a new (not-yet-in-Quotewise) quote and two or more collections, **When** they open the overlay, **Then** a collection picker appears next to the capture action showing their collections as a multi-select checklist.
2. **Given** the picker is open, **When** the user ticks two collections and captures, **Then** the quote is added to both of those collections and to no others.
3. **Given** the user has no existing collections, **When** the picker opens, **Then** it shows an honest empty state pointing the user to create a collection in the Quotewise web app (inline creation is out of scope for this feature) rather than an empty silent list.
4. **Given** the user has a default collection and Auto-add is ON, **When** they override the picker selection for one capture, **Then** that capture honors the override and the very next capture's picker is seeded from the default/last-used again (the default is not mutated).
5. **Given** the picker is open, **When** the user toggles checkboxes, **Then** nothing is written to Quotewise until they take the explicit capture action (selections are staged).
6. **Given** Auto-add is OFF or the user has no collections, so the picker opens with nothing selected, **When** the user captures without selecting any collection, **Then** the quote is still captured (enters Quotewise) with no collection assignment and no membership calls.
7. **Given** the picker is open and the user has just created a new collection in the Quotewise web app, **When** they click Refresh in the picker, **Then** the list re-fetches on demand and the new collection appears and can be selected, with prior staged selections preserved.

---

### User Story 2 - Add an already-captured quote to my collection(s), and see if it's already there (Priority: P2)

A user lands on a quote that Quotewise already has (capture is blocked). The overlay now tells them whether that quote is already in one of their collections (naming which), and lets them add the existing quote to additional collections of their choosing — without re-capturing it and without recording a new sighting.

**Why this priority**: This removes the current dead end. It is independently valuable (it works on its own even without P1's new-capture picker) but is ranked second because the new-capture path is the more common moment and the simpler MVP.

**Independent Test**: Visit a page whose quote already exists in Quotewise. Confirm the overlay states whether the quote is already in the user's collections (and names them), offers a picker limited to collections the quote is *not* yet in, and that choosing one adds the existing quote to that collection (membership only — no new sighting, no source URL recorded).

**Acceptance Scenarios**:

1. **Given** a quote already in Quotewise that IS in one of the user's collections, **When** the overlay opens, **Then** it shows a clear "✓ In your collection" indication naming the specific collection(s).
2. **Given** a quote already in Quotewise that is NOT in any of the user's collections, **When** the overlay opens, **Then** it shows that status and offers the picker to add the existing quote to one or more collections.
3. **Given** an already-captured quote shown with the picker, **When** the user adds it to a collection, **Then** only collection membership changes — no new sighting is created and no source URL is attached.
4. **Given** the picker for an already-captured quote, **When** it renders, **Then** collections the quote is already in are shown read-only ("Already in: …") and the editable list offers only collections it is not yet a member of.
5. **Given** a user adds an existing quote to two collections at once and one add fails, **When** the operation completes, **Then** the overlay reports which collections succeeded and which failed and lets the user retry just the failed one(s).

---

### User Story 3 - Configure the default destination from the overlay, with remembered last-used collections (Priority: P3)

A user can set and change their auto-add behavior and default collection from the capture overlay's dropdown tray (not only the options page), and the extension remembers the full set of collections they last filed into and pre-selects it next time — so a multi-collection research run stays one click per capture across days and devices.

**Why this priority**: This is a convenience and discoverability improvement layered on P1/P2. It is valuable but not required for the core gaps, and it carries the most cross-surface coordination (settings parity), so it is sequenced last.

**Independent Test**: Open the overlay dropdown, toggle Auto-add and choose a default collection there; confirm the same value is reflected on the options page (one setting, two surfaces). Capture into a set of collections, restart the browser (and check on a second signed-in device), and confirm the picker pre-selects that same last-used set.

**Acceptance Scenarios**:

1. **Given** the overlay dropdown tray, **When** the user opens it, **Then** it offers the "Auto-add Captures" toggle and default-collection selector in addition to the existing items.
2. **Given** the user changes the default collection in the dropdown, **When** they open the options page, **Then** it shows the same default (the surfaces edit one shared setting and never disagree).
3. **Given** Auto-add is ON with a default collection and no prior last-used set, **When** the picker opens for a new capture, **Then** the default collection is pre-selected.
4. **Given** the user previously filed into a set of collections, **When** the picker next opens for a new capture, **Then** that same set is pre-selected (last-used takes precedence over the bare default).
5. **Given** Auto-add is OFF, **When** the picker opens for a new capture, **Then** nothing is pre-selected and the user must choose deliberately.

---

### Edge Cases

- **No collections yet**: The picker has no existing collections to offer; it MUST surface an honest empty state directing the user to create a collection in the Quotewise web app (inline creation is out of scope), rather than showing an empty silent list.
- **Capture with nothing selected**: Capturing a new quote with no collection selected (Auto-add OFF, or no collections exist) is allowed — the quote is captured with no collection assignment and no membership calls. Selection is never required to capture (FR-002).
- **Already in every collection**: For an already-captured quote that is already in all of the user's collections, the picker's editable list is empty; the overlay shows the "Already in: …" status with no redundant re-add offered.
- **Logged out**: No collection picker or settings render; the existing Login affordance is shown instead. Collections are never fetched or displayed without authentication.
- **Private mode**: Capture is paused; no capture UI (and therefore no picker) is shown.
- **Collection list stale/unavailable at picker open**: If the cached list is missing or expired, the overlay fetches it on open; if it cannot be loaded, the picker surfaces an honest "couldn't load your collections" state rather than an empty silent list.
- **Preload disabled by the user**: Unaffected for collections — the collection list is never part of page-load preload; it is always fetched on explicit picker open. The setting continues to gate the duplicate/originator preloads only.
- **Partial multi-add failure**: Successful adds are kept; failed adds are reported per-collection and retryable; the user is never told "added" when an add failed.
- **Service-worker restart mid-add**: An add that is retried after a worker restart MUST NOT create duplicate membership or corrupt state (idempotent add).

## Requirements *(mandatory)*

### Functional Requirements

#### New-capture picker (P1)

- **FR-001**: The overlay MUST present a collection picker adjacent to the capture/primary action for a new (not-already-in-Quotewise) quote when the user is authenticated and not in private mode.
- **FR-002**: The picker MUST allow selecting multiple collections (multi-select), and a single capture MUST be fileable into all selected collections in one action. Selecting collections is OPTIONAL: a new quote MUST remain capturable with zero collections selected (e.g. Auto-add OFF, or the user has no collections) — in that case the quote is captured with no collection assignment and no membership calls are made. Capture is never blocked on collection selection (consistent with FR-013).
- **FR-003**: The picker MUST list only the user's existing collections. Inline creation of a new collection from the picker is OUT OF SCOPE for this feature (deferred to a follow-up spec). When the user has no existing collection to file into, the picker MUST present an honest empty state directing them to create one in the Quotewise web app.
- **FR-004**: A per-capture selection MUST override the auto-add default for that capture only and MUST NOT mutate the stored default or last-used set except as defined by FR-016.
- **FR-005**: Picker selections MUST be staged locally; no collection membership or quote write MUST occur until the user takes the explicit capture action (consistent with "no silent submission").
- **FR-006**: The system MUST NOT expose any editing of quote text in the picker flow; the picker governs destination only.

#### Already-captured quotes (P2)

- **FR-007**: When a quote is already in Quotewise (the "already captured" block state), the overlay MUST indicate whether that quote is already in one or more of the user's own collections, naming the specific collection(s) when it is.
- **FR-008**: For an already-captured quote, the overlay MUST offer a picker to add the existing quote to additional collections it is not already a member of.
- **FR-009**: Adding an already-captured quote to a collection MUST change collection membership only — it MUST NOT create a new sighting and MUST NOT attach a source URL.
- **FR-010**: Collections the already-captured quote is already in MUST be presented read-only (not removable); the editable list MUST contain only collections it is not yet in.
- **FR-011**: The overlay MUST NOT provide a way to remove a quote from a collection (removal is a web-app concern); no membership-delete action is in scope.

#### Multi-add behavior & feedback (P1, P2)

- **FR-012**: A multi-collection add MUST be best-effort per collection: each target is attempted independently, and the result MUST report which collections succeeded and which failed.
- **FR-013**: A captured quote MUST NOT be discarded because a collection-add failed — the capture (the quote entering Quotewise) is the primary outcome and MUST survive any secondary collection-filing failure (no all-or-nothing rollback). On partial failure, successful adds MUST be preserved and the failure MUST be surfaced honestly (a failed collection is never reported as added). Per-collection inline retry with the overlay staying open is the target (SHOULD); where it is not implemented, the defined fallback in Assumptions ("Pragmatic fallback for partial-failure UX") applies.
- **FR-014**: Adding the same quote to a collection it is already a member of MUST be a safe no-op (idempotent), never producing a duplicate or an error the user must resolve.
- **FR-015**: On FULL success, the overlay MUST show a brief confirmation that names the collection(s) added to, then auto-dismiss (matching the existing post-action pattern), and MUST NOT offer an Undo affordance. On PARTIAL failure, the overlay MUST surface which collection(s) failed and MUST NOT report them as added. The target (SHOULD) is to stay open with per-collection inline retry; the defined fallback (Assumptions) is a brief warning naming the unsaved collection(s) before auto-hide. Either path surfaces the failure honestly (Article VII).

#### Defaults, settings surfacing & memory (P3)

- **FR-016**: The extension MUST remember the full set of collections from the user's most recent add and pre-select that set the next time the picker opens for a new capture.
- **FR-017**: The picker's initial selection for a new capture MUST follow this precedence: (1) the remembered last-used set if present; else (2) the default collection when Auto-add is ON; else (3) nothing selected when Auto-add is OFF.
- **FR-018**: The remembered last-used set and the auto-add/default settings MUST persist across browser restarts and synchronize across the user's signed-in devices.
- **FR-019**: The "Auto-add Captures" toggle and default-collection selector MUST be available in the overlay dropdown tray, and MUST edit the same single stored setting value as the options-page controls so the two surfaces can never diverge.
- **FR-020**: The Auto-add toggle MUST govern whether a new-capture picker opens pre-selected (ON) or blank (OFF); it MUST NOT be a second, separate copy of the destination value.

#### States, privacy & badge (cross-cutting)

- **FR-021**: The collection picker and the dropdown collection settings MUST NOT render when the user is logged out (show the existing Login affordance) or in private mode (capture paused).
- **FR-022**: The user's collection list MUST be fetched ONLY on an explicit user action — opening the overlay/picker — and MUST NOT be fetched passively on tweet-page load (Article II.1). The fetched list MUST be cached (`chrome.storage.local`, target ≈ 5 minutes) so that subsequent picker opens within the window render synchronously without a network round trip; a cold (cache-miss) open MAY show a brief loading state while the list fetches.
- **FR-023**: Because the collection list is fetched only on explicit picker open (FR-022), the extension MUST issue no collection request on tweet-page load in any setting state — so it makes no pre-action collection egress and needs no preload gate. The existing "disable pre-action network calls" setting continues to govern the duplicate/originator preloads, unchanged.
- **FR-024**: The cached collection list and the remembered last-used set are user-identifying data and MUST be wiped on logout, on entering private mode, and by the existing manual "clear my data" affordance.
- **FR-025**: After a successful add (a new capture filed into a collection, or an existing quote added to a collection), the toolbar icon state MUST reflect collection membership using the existing canonical "in your collection" state, replacing the current hardcoded "exists, not collected" post-action value. No new icon states are introduced.
- **FR-026**: All new injected UI (picker, status indicators, confirmations, dropdown controls) MUST meet the extension's accessibility bar: keyboard-operable, status conveyed by glyph/text and not color alone, visible focus, ARIA labels, and no host-page layout shift.
- **FR-027**: All new copy (status, confirmations, errors) MUST be honest and non-manipulative, and MUST NOT overstate what was captured or imply membership/verification beyond the data.
- **FR-028**: The collection picker MUST provide a manual "Refresh" control that re-fetches the user's collection list on demand (an explicit user action), bypassing and updating the cache — so a collection the user just created elsewhere (e.g. the Quotewise web app) appears without waiting for the cache window to expire or reopening the overlay. Refresh MUST reconcile against the new list, preserving the user's current staged selections for collections that still exist and dropping any that no longer exist.

### Key Entities *(include if feature involves data)*

- **Collection**: A user-owned, named grouping of quotes. Relevant attributes: identity, display name, whether it is the user's default. The picker lists these and shows per-quote membership.
- **Collection membership**: The association between a specific quote and a collection. This feature creates memberships (add) but never deletes them. Membership is idempotent — a quote is either in a collection or not.
- **Default-destination setting**: The user's auto-add preference (on/off) plus the chosen default collection. A single stored value surfaced in both the overlay dropdown and the options page.
- **Last-used selection**: The full set of collections the user most recently filed into, remembered to pre-seed the picker; user-identifying and cleared with other user data.
- **Duplicate/already-captured match**: An existing Quotewise quote matched to the current page, carrying whether — and into which of the user's collections — it is already filed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can file a captured quote into one or more non-default collections in a single capture action without altering their default — verified by the next capture defaulting normally.
- **SC-002**: For a quote already in Quotewise, the overlay states whether it is in the user's collections (and names them) before the user takes any action.
- **SC-003**: A user can add an already-captured quote to a collection from the blocked state in no more than two interactions, without re-capturing and without creating a sighting.
- **SC-004**: On a warm cache (collection list fetched within the last ≈ 5 minutes), opening the picker renders the list synchronously with no network round trip and no spinner; on a cold open the picker MAY show a brief loading state while the list fetches.
- **SC-005**: A multi-collection add reports a per-collection outcome; in a partial-failure case, every successful add is retained and every failure is surfaced honestly to the user — retryable inline where implemented, otherwise reported by name for re-filing.
- **SC-006**: The default destination is configurable from the overlay dropdown, and the chosen default and last-used set survive a browser restart and appear on a second signed-in device.
- **SC-007**: No collection UI (picker or settings) appears when the user is logged out or in private mode, and no collection data is fetched in those states.
- **SC-008**: After a successful add, the toolbar icon reflects "in your collection," and this state is conveyed by glyph/text (not color alone).
- **SC-009**: Re-running an add for a quote already in a collection produces no duplicate membership and no user-facing error.

## API Contract (frozen dependency)

This feature depends on backend (`django-api`) support, **now implemented** (ADR-0006 backend resolution, bead `qw-si1t`). The contract below matches that implementation and is the single authoritative reference for the extension; it is included here, contrary to the usual "no implementation detail" guidance, at explicit stakeholder direction.

- **Add existing quote to a collection** — reuse the existing **slug-keyed** endpoint `POST /v1/collections/{slug}/quotes/` with body `{ quote_id }` (no new endpoint). Idempotent: `201` on add, `200` if already a member; never duplicates membership; membership only (no sighting, no source URL). The extension uses the collection **slug** (from `GET /v1/collections/`), never the UUID `id`, and issues one request per target collection (best-effort per-collection feedback — FR-012/013). Errors: collection not owned → `404`; missing/invalid quote → `400` (`QUOTE_NOT_FOUND`).
- **Membership in duplicate-check response** — the existing duplicate-check response gains, per matched quote, `member_collections: [{ slug, name }]` alongside the existing `in_user_collections` boolean. It is **always present** (an empty array `[]` when the quote is in none of the user's collections); `in_user_collections` is true iff the array is non-empty. The overlay reads it unconditionally to label "already in" collections and exclude them from the editable list in one round trip.
- **Reused, already-existing endpoints** — `GET /v1/collections/` (list) and `POST /v1/quotes/` (new-capture submit) already exist. `POST /v1/quotes/` accepts a collection **slug** in its optional `collection_id`, so a new capture is filed by passing the chosen slug there for the first selected collection and adding any others via the slug endpoint above.

## Dependencies

- **Backend (`django-api`)**: Implemented (ADR-0006 backend resolution, bead `qw-si1t`) — the existing slug-keyed `POST /v1/collections/{slug}/quotes/` plus `member_collections` on the duplicate-check response. No new endpoint.
- **Existing extension surfaces** reused/extended: the capture overlay, the overlay dropdown/account menu, the options page settings, the duplicate/already-captured display, the synced settings store, and the canonical toolbar icon-state table.

## Assumptions

- **Membership, not management.** The overlay is an add-only surface for collections; removing a quote from a collection is done in the Quotewise web app and is out of scope.
- **Existing quotes get membership only.** Adding an already-captured quote records no sighting and attaches no source URL; "add to collection" means exactly that.
- **One setting, two surfaces.** The auto-add/default value is single-sourced in synced storage; exposing it in both the overlay dropdown and the options page is a presentation choice, not a second setting, so the surfaces cannot diverge.
- **Collection creation is external.** Collections are created in the Quotewise web app (or a future spec); this feature neither creates collections nor defines their visibility/default rules.
- **Cache window.** A few minutes is an acceptable freshness window for the cached collection list; a collection created on another surface mid-session may not appear until the cache window expires — or until the user clicks the picker's manual Refresh (FR-028), which re-fetches on demand.
- **Auth model unchanged.** The feature uses the extension's existing OAuth Bearer-token auth; no new permissions are required.
- **Pragmatic fallback for partial-failure UX (defined).** Non-negotiable invariants (MUST): the capture survives a filing failure, and any failed collection is surfaced honestly (never reported as added). Target (SHOULD): the overlay stays open with per-collection inline retry. Defined fallback if inline retry proves hard (e.g. idempotency edge cases): the overlay shows a brief warning naming the unsaved collection(s), then auto-hides, and the user re-files from the web app. FR-013, FR-015, and SC-005 are written against these invariants — the choice between target and fallback is implementation latitude, not a spec contradiction.
- **Stale last-used / deleted collections.** If a remembered last-used collection (or an already-member collection from the duplicate match) no longer exists, the picker silently drops it from the pre-selection and list rather than erroring; the remembered set is reconciled against the freshly loaded collection list.

## Out of Scope

- Inline creation of a new collection from the picker (deferred to a follow-up spec; v1 lists existing collections only). Creating collections remains a web-app action.
- Removing a quote from a collection from within the overlay (web-app only).
- Recording sightings or source URLs when adding an existing quote (membership only).
- Introducing any new toolbar icon states (the existing canonical table is reused).
- The `django-api` server-side implementation (now done — bead `qw-si1t` / ADR-0006); this spec covers the extension surface only.
- Bulk/transactional multi-collection add semantics (the chosen model is best-effort, per-collection).

## Constitution Notes

- **Article II (Privacy & Data Minimization)**: The collection list is fetched ONLY on explicit picker open — never as a passive pre-action call — so pre-action egress stays limited to `{tweet_id, handle, source_url}` (II.1, FR-022/FR-023). FR-024 wipes the cached list and the synced last-used set on logout/private/clear-data (II.2). Disclosure (II.3) of the new collection fetch, the `storage.local` cache, and the synced last-used set is reviewed against the store listing + privacy policy as a task (see tasks T025).
- **Article I (Capture Integrity)**: The picker governs destination only; FR-006 forbids any quote-text editing and FR-005 preserves "no silent submission."
- **Article VII (User Experience)**: FR-026/FR-027 carry the WCAG 2.1 AA and honest-copy requirements into all new UI.
- **Article V (Resilience)**: FR-014's idempotent add and the idempotent membership endpoint keep retries and mid-flight worker termination safe.
