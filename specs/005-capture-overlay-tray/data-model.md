# Phase 1 Data Model: Capture Overlay Tray (005)

Entities the feature introduces or extends. Types are TypeScript-shaped to match the existing codebase
(`src/types/chrome.ts`, `src/types/api.ts`). Nothing here is a backend schema change — these are extension-side
state shapes plus one *consumed* (not authored) API field for US9.

---

## 1. `Settings` — device + account preferences (`chrome.storage.sync`, key `settings`)

```typescript
// src/types/chrome.ts (new)
export interface Settings {
  /** Article II.1 user-controlled preload switch. OFF = preload enabled (default). */
  privateMode: boolean;            // default: false  (device-level, survives logout/clear-data)
  /** US7 auto-add captures to the chosen collection. */
  autoAddToCollection: boolean;    // default: false  (device-level, survives logout/clear-data)
  /** Account-bound: the user's chosen default collection. CLEARED on logout/clear-data. */
  defaultCollectionId: string | null; // default: null
  /** FR-043: one-time first-run notice shown flag. Device-level, survives logout/clear-data. */
  firstRunNoticeShown: boolean;    // default: false
}

export const DEFAULT_SETTINGS: Settings = {
  privateMode: false,
  autoAddToCollection: false,
  defaultCollectionId: null,
  firstRunNoticeShown: false,
};
```

**Persistence**: single object under `chrome.storage.sync["settings"]` (R1). Roams across the user's signed-in
Chrome devices (Clarification 2026-06-07). Reads merge over `DEFAULT_SETTINGS` so missing/forward-compat fields
default safely (Article V.2).

**Field lifecycle** (FR-031/033, Clarification 2026-06-07):

| Field                  | Scope          | Survives logout? | Survives "Clear my data"? |
|------------------------|----------------|------------------|---------------------------|
| `privateMode`          | device/profile | ✅ yes           | ✅ yes                    |
| `autoAddToCollection`  | device/profile | ✅ yes           | ✅ yes                    |
| `firstRunNoticeShown`  | device/profile | ✅ yes           | ✅ yes                    |
| `defaultCollectionId`  | account-bound  | ❌ cleared       | ❌ cleared                |

**Validation**: booleans coerced via `Boolean(...)`; `defaultCollectionId` validated against the fetched collection
list on the options page (stale id → treated as unset, picker shows no selection — never errors).

**Quota** (Context7): 1 item, well under 8 192 B; one write per change, far under 120/min·1 800/hr.

---

## 2. `UserIdentifyingCache` — the wipe set (`chrome.storage.local`)

Not a new type — the **canonical key set** that logout and "Clear my data" both clear (R5). Centralized in
`storage-cleanup.ts` so both flows and their tests share one source of truth.

```typescript
// src/background/storage-cleanup.ts (new export)
export const USER_IDENTIFYING_CACHE_KEYS = [
  'currentTweet',
  'preloadedOriginator',
  'preloadedDuplicateCheck',
  'lastAuthCheck',
  'originator_search_history',
  // + any future per-user cache key
] as const;
```

- **Logout** clears: `USER_IDENTIFYING_CACHE_KEYS` (local) + `oauth_*` tokens + cancels `token-refresh` alarm +
  `settings.defaultCollectionId` → null. Preserves the three device prefs.
- **Clear my data** clears: `USER_IDENTIFYING_CACHE_KEYS` (local) + `settings.defaultCollectionId` → null. Login
  state untouched. Preserves the three device prefs.
- **NOT cleared** by either: `authState` bookkeeping (managed by `AuthStateManager`; logout transitions it
  separately), `settings.{privateMode,autoAddToCollection,firstRunNoticeShown}`.

**Invariant (Article III.3)**: clearing these keys MUST NOT emit any token/cookie/secret value into logs/errors.

---

## 3. `CaptureProgressPhase` — staged submit state (in-memory, derived)

```typescript
// src/content/ui/components/progress-indicator.ts (new)
export type CaptureProgressPhase =
  | 'idle'
  | 'checking'     // "Checking…"   (duplicate/preflight resolving for the explicit submit)
  | 'submitting'   // "Submitting…" (create-quote in flight)
  | 'confirming'   // "Confirming…" (awaiting create confirmation / collection add)
  | 'success'      // terminal, only after confirmed
  | 'error';       // terminal, honest error + retry; NEVER shows after success
```

- **Not persisted** (transient UI state; SW restart mid-submit is handled by idempotent handlers, V.1).
- **Debounce**: staged text renders only after ~400 ms in a non-terminal phase (FR-021). Phases reached *before* the
  window elapses produce no flash.
- **Transitions**: `idle → checking → submitting → confirming → success`; any phase → `error` on failure. `success`
  is reachable only from `confirming` after the create call resolves (VII.3 honesty).
- **Reduced motion**: any spinner is suppressed under `prefers-reduced-motion`; the phase text alone conveys
  progress (FR-022).

---

## 4. `WordDiffToken` — word-level diff model (in-memory, derived)

```typescript
// src/utils/word-diff.ts (new)
export interface WordDiffToken {
  value: string;                          // the word (+ its trailing whitespace)
  type: 'equal' | 'added' | 'removed';    // added = in captured not on-record; removed = on-record not captured
}

export function diffWords(onRecord: string, captured: string): WordDiffToken[];
```

- **Inputs**: `captured` = the text the user is about to submit; `onRecord` = `DuplicateCheckResult.matches[].text`
  (already returned by the API).
- **Algorithm**: LCS over whitespace-tokenized words (R7). Deterministic, hand-rolled, TDD'd (Article VI.1).
- **Rendering** (`similar-diff.ts`): `added`/`removed` shown by marker + typography (e.g. underline + "＋" /
  strikethrough + "−"), never color alone (FR-072, WCAG 1.4.1); honors `prefers-contrast`. **No** similarity
  percentage rendered (FR-071).
- **Degradation**: if `matches[].text` is absent/empty, the diff is skipped and the tray falls back to the existing
  read-only "similar version" badge (FR-073).

---

## 5. `SimilarMatchView` — near-match presentation model (in-memory, derived)

Composes the existing duplicate result with the diff and the (future) date-gate.

```typescript
// src/content/ui/components/similar-diff.ts (new)
export interface SimilarMatchView {
  isNearMatch: boolean;              // recommendation in the 'new_version' family
  diff: WordDiffToken[] | null;      // null when on-record text unavailable → read-only fallback
  existingQuoteUrl: string | null;   // from matches[].url ?? built from short_code
  addSighting: {
    eligible: boolean;               // true ONLY when published date present AND tweet strictly older
    available: boolean;              // false until API exposes matched-record published date (US9 blocked)
    hint: string | null;            // "This tweet is older than our records" when eligible
    label: 'Add as earlier sighting of this similar quote';  // honest sighting label (FR-083)
  };
}
```

- **`isNearMatch`** derives from `DuplicateCheckResult.recommendation` (the `new_version*` family) via the existing
  `duplicate-status.ts` mapping — exact/no-match never render the diff (FR-073).
- **`addSighting.available`** is `false` until the matched-record published date ships (R9); record-creation time is
  **never** a fallback (FR-082).
- **`addSighting.eligible`** requires published-date present AND `TwitterData.date` strictly earlier (FR-080/081).

---

## 6. `IconStateConfig` — add `Paused` (spec-004 amendment)

Extends the existing `ICON_STATES` map in `config/icon-states.ts` (shape unchanged; one new entry).

```typescript
// src/config/icon-states.ts (new entry)
Paused: {
  iconVariant: 'grey',                 // reuse existing GREY_ICON_PATHS owl
  badgeText: '‖',                      // pause glyph (decodable by glyph, not color)
  badgeColor: '<neutral grey>',        // align with other grey/neutral badges
  title: 'Quotewise — paused (private mode)',
  scope: 'global',                     // Private mode is global, not per-tab
}
```

**Resolver input** (`icon-state-resolver.ts`): add `privateMode: boolean` (recommended: a 4th parameter on
`resolveIconPresentation(auth, dup, tab, privateMode)`; acceptable alt: a field on `TabContext`). One new branch
after the `UNAUTHENTICATED → LoggedOut` return and before `Loading`:

```typescript
if (auth === AuthState.UNAUTHENTICATED) return ICON_STATES.LoggedOut;
if (privateMode) return ICON_STATES.Paused;   // FR-091 precedence slot
// …Loading, AuthPending, Unsupported, SupportedIdle, quote-status…
```

**Precedence (FR-091)**: `Error → Logged-out → Paused → Loading → Auth-pending → Unsupported → Supported-idle →
quote-status badges`. A logged-out user never reaches Paused (LoggedOut returns first) — correct semantics.

---

## 7. `Collection` (reference — consumed, not authored)

Already defined in `src/types/api.ts` (`Collection { id, name, slug, description, is_default, quote_count,
created_at, updated_at }`) and fetched via `listCollections()` → `{ collections, default_collection_id }`. Used by:
- The options-page default-collection **picker** (preselect server-side default; honest empty/error state) (FR-060).
- Auto-add on submit (US7): the chosen `settings.defaultCollectionId` is threaded into the create-quote call.

No new type; the picker holds the fetched list transiently and persists only the chosen id into `settings`.

---

## 8. `QuoteSubmissionRequest` — thread collection id (US7)

`src/types/api.ts` extends the existing request with an **optional** collection identifier (consumed by the backend
create-with-collection behavior noted in spec Dependencies "already available"):

```typescript
// src/types/api.ts (extend QuoteSubmissionRequest)
collection_id?: string;   // present only when autoAddToCollection && defaultCollectionId set (US7/FR-061)
```

- Omitted when auto-add is OFF (FR-062).
- **Resilience (FR-063)**: if the collection step fails, the quote create still succeeds and the user is honestly
  informed the collection step did not complete (no silent loss) — surfaced via the progress/error path.

---

## 9. `matches[].quote_date` — consumed API field (US9, future)

`src/types/api.ts` adds an **optional** field on the match shape, read-only from the extension's view:

```typescript
// src/types/api.ts (extend DuplicateCheckResult.matches[] — optional, may be absent)
quote_date?: string;   // matched record's PUBLISHED date (NOT record-creation time). Absent until django-api ships.
```

- When **absent** (today): `SimilarMatchView.addSighting.available = false` → action hidden (FR-082, R9).
- When **present**: gate eligibility on `quote_date` vs. `TwitterData.date` (FR-080/081).
- The extension treats absence as "feature unavailable," never as an error (Article V.2).

---

## Storage area summary

| Area                    | Keys (this feature)                                              | Lifetime / notes |
|-------------------------|-----------------------------------------------------------------|------------------|
| `chrome.storage.sync`   | `settings` (one object — §1)                                     | Roams across devices; survives restarts |
| `chrome.storage.local`  | existing cache keys (§2) + `oauth_*` + `authState`              | Cleared per logout/clear-data rules (§2) |
| in-memory (derived)     | `CaptureProgressPhase`, `WordDiffToken[]`, `SimilarMatchView`    | Disposable; rebuildable after SW restart (V.1) |
