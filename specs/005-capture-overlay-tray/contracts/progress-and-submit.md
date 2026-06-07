# Contract: Staged Submit Progress + Logout/Clear-Data Wipe

## A. Staged progress phase machine — FR-020..023, SC-003

`src/content/ui/components/progress-indicator.ts` (rendered inside the tray, driven by `action-button.ts`/
`overlay-bar.ts` submit flow).

```
idle ──submit──> checking ──> submitting ──> confirming ──> success
                    │             │              │
                    └─────────────┴──────────────┴──> error   (honest message + Retry)
```

| Phase        | Visible text   | Trigger |
|--------------|----------------|---------|
| `checking`   | "Checking…"    | duplicate/preflight for the explicit submit in flight |
| `submitting` | "Submitting…"  | create-quote request in flight |
| `confirming` | "Confirming…"  | awaiting create confirmation (+ optional collection add) |
| `success`    | success result | only after create confirmed |
| `error`      | honest error + Retry | any phase failure |

### Rules
- **Debounce (FR-021)**: staged text renders only after **~400 ms** in a non-terminal phase. A submit that resolves
  within the window shows **no** staged text — just the final success/error (SC-003 fast path).
- **Reduced motion (FR-022)**: any spinner is suppressed under `prefers-reduced-motion`; phase text alone conveys
  progress.
- **Honesty (FR-022/023, VII.3)**: `success` is reachable **only** from `confirming` after confirmation. An error at
  any phase shows an honest message + a retry affordance and **MUST NOT** show success/"Done".
- Reuse `src/utils/debounce.ts` for the window; reuse `action-button.ts` for the terminal Submit/Retry/Login states
  (extend, don't duplicate).

### Test contract (test-first)
- Fast path: phases reached before 400 ms produce no progress DOM; only final result renders.
- Slow path: each phase renders its text in order and clears on completion.
- Reduced motion: no spinner element/animation; text present.
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
