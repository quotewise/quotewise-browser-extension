# Contract: Icon State Resolver & Applicator

**Feature**: `004-extension-icon-states`

The extension exposes no public/network API here. The "interface contract" is the **internal seam**
between the pure decision logic and the side-effecting Chrome calls — the seam everything else in the
worker depends on, and the one that makes the surface deterministic and testable (FR-070, SC-005).

---

## C1. `resolveIconPresentation` — pure decision function

**Module**: `src/background/icon-state-resolver.ts`

```ts
import type { AuthState } from '../auth/auth-state-machine';
import type { DuplicateCheckResult } from '../types/api';

export interface TabContext {
  tabId: number;
  isTweetPage: boolean;
  isCheckInFlight: boolean;
}

export interface IconPresentation {
  iconVariant: 'color' | 'grey';
  badgeText: string;        // '' clears the badge
  badgeColor: string;       // hex; ignored when badgeText === ''
  title: string;            // self-contained accessible label
  scope: 'global' | 'tab';
}

/** Total, pure, deterministic. No chrome.* calls, no I/O, no throw. */
export function resolveIconPresentation(
  auth: AuthState,
  dup: DuplicateCheckResult | null,
  tab: TabContext,
): IconPresentation;
```

**Guarantees** (verified by `tests/background/icon-state-resolver.test.ts`):
- **Total**: defined for every `(AuthState × DuplicateCheckResult|null × TabContext)`; unknown
  `recommendation` ⇒ New, malformed/errored result ⇒ no quote badge (V.2, FR-041).
- **Deterministic & pure**: same inputs ⇒ identical output; no reads of `chrome.*`, clock, or module
  state. Re-entrant under SW termination (V.1).
- **Single-valued**: returns exactly one `IconPresentation` per call (FR-030).
- **Precedence**: follows data-model §6 exactly. Anchored by the §6.1 tie table.
- **Auth-pending**: `UNKNOWN`/`CHECKING`/`AUTHENTICATING` never produce quote-status badges or
  "ready to capture" copy.
- **No badge text color**: the type has no field for it; the applicator must not call
  `setBadgeTextColor` (FR-003).

## C2. `mapRecommendationToQuoteStatus` — exported helper

**Module**: `src/utils/duplicate-status.ts` (extends the existing file; keeps
`classifyDuplicateSighting` for the tray).

```ts
export type QuoteStatus = 'None' | 'InCollection' | 'Conflict' | 'Exact' | 'Similar' | 'New';

/** FR-040 / Decision D5. Reads recommendation + in_user_collections only. */
export function mapRecommendationToQuoteStatus(
  result: DuplicateCheckResult | null,
): QuoteStatus;
```

**Guarantees**: implements the data-model §5 ladder; `in_user_collections` short-circuits to
`InCollection`; never reads `match_type`/`similarity` for selection; `null`/`search_metadata.error`
⇒ `None`.

## C3. `applyIconPresentation` — the only `chrome.action` caller

**Module**: `src/background/icon-applicator.ts` (or a private section of `service-worker.ts`).

```ts
export interface ApplyIconPresentationOptions {
  /** Auth-transition cleanup only: overwrite a tab-scoped prior state with a global presentation. */
  forceTabScope?: boolean;
}

export async function applyIconPresentation(
  p: IconPresentation,
  tabId: number,
  options?: ApplyIconPresentationOptions,
): Promise<void>;
```

**Application contract** (Context7 Chrome `action` ref):
0. Compute `effectiveScope = options?.forceTabScope ? 'tab' : p.scope`.
1. `setIcon` — `iconVariant === 'grey'` ⇒ `{ path: greyPaths }`; `'color'` ⇒ `{ path: colorPaths }`.
   - `paths = { 16, 32, 48, 128 }` under `icons/…` (bundle-relative).
   - `effectiveScope === 'tab'` ⇒ pass `{ tabId }`; `'global'` ⇒ no `tabId` (sets the default for all tabs).
2. `setBadgeText({ [tabId?], text: p.badgeText })` — `''` clears.
3. If `p.badgeText !== ''`: `setBadgeBackgroundColor({ [tabId?], color: p.badgeColor })`.
4. **Never** call `setBadgeTextColor` (FR-003 — Chrome 110+ auto-contrasts).
5. `setTitle({ [tabId?], title: p.title })` — always paired with every visual change (FR-050).
6. `tabId` is included **iff** `effectiveScope === 'tab'`.
7. `forceTabScope` is only for auth-transition cleanup: it lets a global auth presentation overwrite
   a prior tab-scoped quote/loading presentation without changing the resolver's output.

**Idempotence**: calling `applyIconPresentation` repeatedly with equal `p` yields the same toolbar
state — safe to re-run on every worker wake (V.1).

## C4. Clearing / auth-transition contract (FR-002, SC-003, SC-007)

Chrome tab-scoped action settings beat global settings. Therefore a prior tab-scoped quote/loading
presentation (`★`, `✓`, `=`, `~`, `⚠`, or `●`, plus its tab-scoped color icon) can survive a later
global auth presentation unless the tab itself is overwritten.

On any auth transition that resolves to `LoggedOut`, `AuthPending`, `Ready`, or `Error`, the worker
MUST:
1. Apply the resolved presentation globally (default for tabs without a tab-scoped override).
2. Enumerate affected tweet tabs (all open `twitter.com`/`x.com` status tabs plus any tab ids that
   received a tab-scoped presentation during this worker lifetime) and call:
   ```ts
   await applyIconPresentation(p, tabId, { forceTabScope: true });
   ```
   This clears the prior tab badge for no-badge states and re-applies the target icon/title with
   `{ tabId }`; for `Error`, it replaces any quote badge with `!`.

On navigation to a non-tweet page, tab close, or tab switch away from a tweet (`tabs.onActivated`),
the worker MUST:
```ts
chrome.action.setBadgeText({ tabId, text: '' });   // drop the stale per-tab quote badge
// then re-resolve ambient/auth state for this tab and apply with forceTabScope when the
// resolved presentation is global, so stale tab-scoped icon/title settings are overwritten too
```
No tab may retain another tab's quote-status badge.

Required test: start from a tab-scoped `New` (`★`) presentation, transition auth to
`UNAUTHENTICATED` and to `SESSION_EXPIRED`, and assert the affected tab receives a tab-scoped
overwrite with no `★` remaining (grey/no badge for logged-out; `!` for error).

---

## Consolidation contract (FR-070 — what this seam replaces)

Introducing C1–C3 **removes** these competing writers (SC-005, "no two code paths set conflicting
badge/icon values"):

| Removed | File | Replaced by |
|---|---|---|
| `getBadgeConfig`, `updateBadgeState`, `updateBadgeFromAuthStatus` | `src/background/auth-monitor.ts` | C1 + C3 |
| `getStateBadgeText`, `getStateBadgeColor` (presentation only) | `src/auth/auth-state-machine.ts` | C1 + canonical table |
| `updateExtensionIconForTweetPage`, `updateCollectionBadgeForTweet`, `updateCollectionBadge`, `getCollectionBadgeConfig` | `src/background/service-worker.ts` | C1 + C3 |

The auth **FSM** (`VALID_TRANSITIONS`, `isValidTransition`, state enum, `getStateMessage`) stays —
only the *presentation* helpers are retired.
