# Feature Specification: Centralized Auth State Management

**Created**: 2026-01-15
**Status**: Implemented (v1.4.3)
**Last Updated**: 2026-01-19 - Badge UX audit (contextual urgency)

## Overview

Centralized authentication state management for Chrome extension MV3. Single source of truth in service worker with reactive updates to popup and overlay components.

## User Scenarios & Testing

### User Story 1 - Unauthenticated User Capture (P1)

User clicks extension on a tweet page without being logged in.

**Acceptance Requirements**:
1. **When** user expands capture form, the system **MUST** check auth status before API calls
2. **If** not authenticated, **then** the system **MUST** display login prompt in overlay
3. **When** user clicks login, the system **MUST** initiate OAuth flow with PKCE
4. **When** OAuth completes, the overlay **MUST** auto-update to show capture form

### User Story 2 - Cross-Context Auth Sync (P1)

User logs in via popup while overlay is open.

**Acceptance Requirements**:
1. **When** auth state changes, the system **MUST** broadcast to all contexts
2. **While** overlay shows login required, **if** user authenticates elsewhere, overlay **MUST** auto-update
3. **While** user is authenticated, **if** logout occurs, all contexts **MUST** show login required

### User Story 3 - Service Worker Recovery (P2)

Service worker terminates and restarts (MV3 behavior).

**Acceptance Requirements**:
1. The system **MUST** persist auth state to `chrome.storage.session`
2. **When** service worker restarts, it **MUST** restore state from storage
3. **If** state was transitional (CHECKING, AUTHENTICATING, UNKNOWN), system **MUST** re-validate tokens
4. **If** state was AUTHENTICATED, system **MUST** re-validate tokens (catches expired sessions)

### User Story 4 - Contextual Badge Feedback (P2)

User sees appropriate visual feedback based on auth state and context.

**Acceptance Requirements**:
1. **While** unauthenticated on any page, badge **MUST** be grey (inactive, not alarming)
2. **While** unauthenticated on tweet page, title **MUST** say "Log in to capture this quote"
3. **While** session expired, badge **MUST** be red "!" on ALL tabs (actual error requiring action)
4. **While** authenticated on tweet page, badge **MUST** show collection status (★/✓/+/○)
5. Auth error badges **MUST** take priority over tweet-collection badges

**UX Philosophy**: "Not logged in" is an expected state, not an error. Only use red for actual errors (session expiry, network failures). Grey indicates inactive/available. Colors indicate active engagement.

### Edge Cases

- **If** OAuth flow cancelled, **then** system **MUST** return to unauthenticated state
- **If** token refresh fails, **then** system **MUST** transition to SESSION_EXPIRED
- **If** service worker unavailable, **then** components **MUST** show UNKNOWN state gracefully
- **If** unauthenticated and navigating to tweet page, badge **MUST NOT** show processing "○" (grey only)
- **If** stored state says AUTHENTICATED but tokens are invalid/expired, system **MUST** detect this and transition to correct state (prevents stale session showing collection badges)

## Requirements

### Functional Requirements

- **FR-001**: AuthStateManager **MUST** be initialized eagerly at service worker startup
- **FR-002**: **When** state changes, system **MUST** broadcast AUTH_STATE_CHANGED to all contexts
- **FR-003**: Components **MUST** subscribe via AUTH_STATE_GET on mount
- **FR-004**: **While** authenticated, global badge **MUST** show green (no text); tweet pages show collection badges (★/✓/+/○)
- **FR-005**: **While** unauthenticated, badge **MUST** be grey with no text (not an error, just inactive)
- **FR-006**: **While** session expired, badge **MUST** show red "!" on ALL tabs (actual error requiring action)
- **FR-007**: OAuth endpoints **MUST** use `webBaseUrl` (main domain), not `apiBaseUrl`
- **FR-008**: Auth error states (SESSION_EXPIRED, INSUFFICIENT_PRIVILEGES) **MUST** take priority over tweet-collection badges
- **FR-009**: UNAUTHENTICATED **MUST NOT** be treated as an error state in `isErrorState()` helper
- **FR-010**: Badge updates triggered by tab navigation **MUST** wait for AuthStateManager initialization before checking auth state
- **FR-011**: **When** restoring AUTHENTICATED state from storage, system **MUST** re-validate tokens (stale session detection)

### State Machine

States: UNKNOWN, CHECKING, AUTHENTICATED, UNAUTHENTICATED, SESSION_EXPIRED, AUTHENTICATING, INSUFFICIENT_PRIVILEGES

### Badge State Mapping

| Auth State | Badge Text | Color | Hex | Title |
|------------|-----------|-------|-----|-------|
| UNAUTHENTICATED | (empty) | Grey | #9AA0A6 | "Click to log in" |
| UNAUTHENTICATED (tweet page) | (empty) | Grey | #9AA0A6 | "Log in to capture this quote" |
| SESSION_EXPIRED | `!` | Red | #F44336 | "Session expired, please log in again" |
| INSUFFICIENT_PRIVILEGES | `?` | Orange | #FF9800 | "Additional permissions required" |
| AUTHENTICATED | (empty) | Green | #4CAF50 | "Ready to capture quotes" |
| CHECKING/AUTHENTICATING/UNKNOWN | `...` | Gray | #9E9E9E | (processing messages) |

### Tweet Collection Badges (Only When Authenticated)

| Collection State | Badge Text | Color | Hex | Title |
|-----------------|-----------|-------|-----|-------|
| processing | `○` | Blue | #2196F3 | "Checking quote status..." |
| new_quote | `★` | Green | #4CAF50 | "New quote: ..." |
| already_collected | `✓` | Green | #4CAF50 | "Already in your collection: ..." |
| exists_not_collected | `+` | Orange | #FF9800 | "In Quotewise (not in your collection): ..." |

### Key Entities

- **AuthStateData**: Current state, username, scopes, expiry, error
- **AuthStateManager**: Service worker singleton, owns state, broadcasts changes
- **AuthSubscriber**: Helper for popup/overlay to subscribe to state

## Implementation (Completed)

### New Files
| File | Purpose |
|------|---------|
| `src/auth/auth-state-machine.ts` | State enum, transitions, badge helpers |
| `src/auth/auth-state-manager.ts` | Centralized state in service worker |
| `src/auth/auth-subscriber.ts` | Component subscription helper |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/chrome.ts` | Added AUTH_STATE_GET, AUTH_STATE_CHANGED, AUTH_STATE_SUBSCRIBE |
| `src/background/service-worker.ts` | Eager AuthStateManager init, OAuth event wiring, auth-aware badge functions |
| `src/background/auth-monitor.ts` | Deprecated, delegates to AuthStateManager |
| `src/popup/popup.ts` | Listens for AUTH_STATE_CHANGED |
| `src/content/ui/overlay-bar.ts` | Auth check before capture, reactive updates |

### v1.4.3 Badge Audit Changes
| File | Changes |
|------|---------|
| `src/auth/auth-state-machine.ts` | UNAUTHENTICATED: grey (#9AA0A6), no text; SESSION_EXPIRED: red "!"; isErrorState() excludes UNAUTHENTICATED |
| `src/auth/auth-state-manager.ts` | updateBadge() propagates SESSION_EXPIRED to all tabs; restoreState() re-validates AUTHENTICATED state (FR-011) |
| `src/background/service-worker.ts` | updateExtensionIconForTweetPage() and updateCollectionBadgeForTweet() check auth state first; tab listeners call ensureServicesInitialized() before badge updates (FR-010) |

## Success Criteria

- **SC-001**: Login prompt appears within 100ms when unauthenticated user expands capture
- **SC-002**: Auth state syncs across contexts within 500ms of change
- **SC-003**: State recovers correctly after service worker restart
- **SC-004**: No API calls made before auth check passes

## OAuth Endpoint Configuration

OAuth endpoints are on the **main domain** (`quotewise.io`), not the API subdomain (`api.quotewise.io`).

| Endpoint | URL | Rationale |
|----------|-----|-----------|
| `/oauth/authorize` | `quotewise.io/oauth/authorize` | User-facing login UI; main domain builds trust |
| `/oauth/token` | `quotewise.io/oauth/token` | Token exchange; same domain as authorize |

**Architecture decision**: Follows GitHub pattern—user sees `quotewise.io` in URL bar during login. Django routes OAuth in `urls.py` (main domain), not `urls_api.py` (API subdomain).

**Configuration** (`src/config/environment.ts`):
```typescript
authorizeUrl: `${envConfig.webBaseUrl}/oauth/authorize`,  // NOT apiBaseUrl
tokenUrl: `${envConfig.webBaseUrl}/oauth/token`,
```

## Assumptions

- OAuth client registered with Quotewise backend
- Backend supports Bearer token authentication
- Chrome extension has `identity` permission

## Out of Scope

- Token encryption at rest (uses chrome.storage built-in security)
- Multi-account support
- Offline queue for submissions
