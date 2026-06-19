# Contract: Submit Progress + Logout/Clear-Data Wipe

## A. Submit progress surface — FR-020..023, SC-003

`src/content/ui/components/progress-indicator.ts` (rendered inside the tray, driven by `action-button.ts`/
`overlay-bar.ts` submit flow).

```
idle ──submit──> checking ──> submitting ──> confirming ──> success
                    │             │              │
                    └─────────────┴──────────────┴──> error   (honest message + Retry)
```

| Phase        | Visible text   | Trigger |
|--------------|----------------|---------|
| `checking`   | "Checking quote" | duplicate/preflight for the explicit submit in flight |
| `submitting` | "Saving to Quotewise" | create-quote request in flight |
| `confirming` | "Confirming" | awaiting create confirmation (+ optional collection add) |
| `success`    | success result | only after create confirmed |
| `error`      | honest error + Retry | any phase failure |

### Rules
- **Single progress locus (FR-020)**: the button carries only the action state (`Submit Quote` → `Submitting...` →
  `Done!`/`Retry`). Detailed phase copy lives in the progress indicator so the user does not have to track two
  changing text surfaces at once.
- **Indicator shape (FR-020/022)**: pending phases render the phase text, an optional secondary wait line, and a
  subtle indeterminate linear bar. The text is not placed inside the bar segment; the bar is decorative and
  `aria-hidden`.
- **Placement (FR-020)**: the progress indicator renders in the action column above the submit button so progress and
  action state form one vertical focus area.
- **Submit visibility (FR-021)**: explicit submit progress may render immediately, and the tray keeps each visible
  pending phase on screen briefly (about 350 ms while the tray is visible) so the cycle is perceptible instead of a
  flicker. The component still supports a debounce for non-submit or background progress where a flash would be
  distracting.
- **Secondary wait copy (FR-020/021)**: if a submit waits long enough, a secondary line may rotate through
  non-assertive hints such as `Quotewise may be comparing against known quotes`. These lines are entertainment/
  reassurance copy, not an API progress contract, and MUST use tentative language (`may be`) rather than claiming a
  specific backend step completed.
- **Reduced motion (FR-022)**: progress still renders text, but the linear bar animation is disabled/static under
  `prefers-reduced-motion`.
- **Honesty (FR-022/023, VII.3)**: `success` is reachable **only** from `confirming` after confirmation. An error at
  any phase shows an honest message + a retry affordance and **MUST NOT** show success/"Done".
- Reuse `src/utils/debounce.ts` for debounced non-submit progress; reuse `action-button.ts` for the terminal
  Submit/Retry/Login states (extend, don't duplicate).

### Test contract (test-first)
- Explicit submit path: the button remains stable as `Submitting...` while the progress area renders
  `Checking quote` → `Saving to Quotewise` → `Confirming`, then clears on completion; the indicator is above the
  button in the action column.
- Long wait path: secondary `Quotewise may be ...` copy appears only after a delay, rotates while pending, and clears
  on success/error/reset.
- Debounced path: phases reached before the configured debounce produce no progress DOM; only final result renders.
- Reduced motion: linear bar animation is disabled/static; text present.
- Error at `checking`/`submitting`/`confirming` → error+retry, never success.

## B. Logout — FR-030/031/032/034, Article II.2/III.3

`OAUTH_LOGOUT` handler (extends existing flow) MUST, atomically:
1. Clear `oauth_*` tokens (`token-storage.clearTokens()`) and cancel the `token-refresh` alarm
   (`auth-flow.logout()`).
2. Clear `USER_IDENTIFYING_CACHE_KEYS` from `chrome.storage.local` (currentTweet, preloadedOriginator,
   preloadedDuplicateCheck, lastAuthCheck, originator_search_history, + per-user).
3. Set `settings.defaultCollectionId → null` (account-bound); **preserve** `privateMode`, `autoAddToCollection`,
   `firstRunNoticeShown`.
4. Transition auth state → UNAUTHENTICATED and re-resolve the toolbar to the logged-out state (existing
   `AuthStateManager.onLogout()`).
5. After logout, make **no** automatic background calls until re-auth (FR-032).

**In-flight guard (edge case, V.1)**: a preflight/originator response arriving *after* logout MUST NOT repopulate
caches — the logged-out state wins (gate post-logout cache writes on current auth state / a logout epoch).

**Secret hygiene (FR-034)**: no token/cookie/secret value in any log, error, or diagnostic from this flow.

## C. Clear my data — FR-033

`CLEAR_USER_DATA` handler MUST clear the same `USER_IDENTIFYING_CACHE_KEYS` + null `defaultCollectionId`, preserve
the three device prefs, and **NOT** change login state (tokens/alarm untouched).

### Test contract (test-first)
- Logout: removes token keys + canonical cache set, nulls `defaultCollectionId`, preserves device prefs, cancels
  refresh alarm, leaves no secret in captured logs; post-logout preflight response does not write caches.
- Clear-data: removes canonical cache set + nulls `defaultCollectionId`, preserves device prefs AND tokens/login.
- Both share `USER_IDENTIFYING_CACHE_KEYS` (one source of truth).
