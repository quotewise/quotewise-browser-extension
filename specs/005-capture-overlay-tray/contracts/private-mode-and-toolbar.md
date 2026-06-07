# Contract: Private Mode Gating + Paused Toolbar State (spec-004 amendment)

## A. Private-mode network gate (service worker) — FR-040/041/044, SC-005

When `settings.privateMode === true`, the SW MUST make **zero** pre-action network calls
(preflight / duplicate / originator) for:
- passive tweet browsing (no overlay), AND
- overlay **open** (Clarification 2026-06-07 — overlay opens silent).

Gate the existing automatic entry points (from the code map):

| Entry point                                   | Behavior when `privateMode === true` |
|-----------------------------------------------|--------------------------------------|
| `tabs.onUpdated` / `webNavigation.onHistoryStateUpdated` → `requestTweetDataExtraction` | no auto-preflight scheduling |
| `runAutomaticPreflightForExtractedTweet` / `checkQuoteCollectionStatus` | early-return, no network |
| `scheduleAutomaticOriginatorProbe` | not scheduled |

The **only** network path under Private mode is the explicit `CHECK_NOW` message (overlay "Check now" control) and
explicit capture/submit. After `CHECK_NOW`, Private mode stays ON and the toolbar stays **Paused**. Quote text and
any write occur **only** on explicit submit (Article II.1, FR-041).

- The SW reads `privateMode` per-decision (or caches it, refreshed via `onSettingsChanged`) so the toggle takes
  effect immediately (no reload). Turning ON mid-session stops subsequent checks at once; turning OFF resumes on the
  next tweet (spec edge cases).
- **Egress bound** (Article II.1): any pre-action request that *is* allowed (Private mode OFF, or `CHECK_NOW`)
  carries only `{tweet_id, handle, source_url}` — never quote text.

## B. Paused icon state (`config/icon-states.ts`) — FR-090

```typescript
Paused: {
  iconVariant: 'grey',                       // reuse GREY_ICON_PATHS owl
  badgeText: '‖',                            // pause glyph — decodable by glyph, not color
  badgeColor: '<neutral grey>',
  title: 'Quotewise — paused (private mode)',
  scope: 'global',
}
```

Decodable by artwork + glyph (not color alone); the `setTitle` carries meaning for AT (badge text is an image).

## C. Resolver amendment (`background/icon-state-resolver.ts`) — FR-091

Add a `privateMode: boolean` resolver input (recommended: 4th parameter; acceptable alt: `TabContext` field) and one
branch in the documented slot:

```typescript
if (auth === AuthState.SESSION_EXPIRED) return ICON_STATES.ErrorSessionExpired;
if (auth === AuthState.INSUFFICIENT_PRIVILEGES) return ICON_STATES.ErrorInsufficientPrivileges;
if (auth === AuthState.UNAUTHENTICATED) return ICON_STATES.LoggedOut;
if (privateMode) return ICON_STATES.Paused;          // ← NEW (FR-091 precedence slot)
// …Loading → AuthPending → Unsupported → SupportedIdle → quote-status badges → Ready
```

**Precedence (authoritative)**: `Error → Logged-out → Paused → Loading → Auth-pending → Unsupported →
Supported-idle → quote-status badges`. All `applyResolvedIconForTab` call sites pass the current `privateMode`.

> This is a fold-in to spec-004's **single authoritative resolver** — no parallel resolution logic is introduced.
> Spec-004's state table/precedence docs must be updated to include Paused.

## Invariants

- **INV-1**: `privateMode === true` ⇒ icon resolves to Paused for any logged-in/pending state (Loading/Auth-pending/
  idle/quote-status all yield to Paused), but **never** for logged-out (LoggedOut returns first).
- **INV-2**: With Private mode ON, the network panel shows **zero** Quotewise background requests across any number
  of tweets and overlay opens until `CHECK_NOW`/capture (SC-005).
- **INV-3**: Toggling Private mode re-resolves the toolbar promptly (FR-042/092) via `onChanged`.

## Test contract (test-first)

- Resolver truth-table: add rows proving Paused wins over Loading/AuthPending/Unsupported/SupportedIdle/quote-status
  when `privateMode`, and LoggedOut/Error still win over Paused.
- Gate tests: each automatic entry point makes no network call when `privateMode === true`; `CHECK_NOW` does; toggle
  ON stops in-flight scheduling; toggle OFF resumes next tweet.
- Icon-states: `Paused` config has grey variant, `‖` badge, correct title, global scope.
