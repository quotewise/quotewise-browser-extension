# Feature Specification: Centralized Auth State Management

**Created**: 2026-01-15
**Status**: Implemented (v1.4.2)

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
3. **If** state was transitional (CHECKING), system **MUST** re-validate tokens

### Edge Cases

- **If** OAuth flow cancelled, **then** system **MUST** return to unauthenticated state
- **If** token refresh fails, **then** system **MUST** transition to SESSION_EXPIRED
- **If** service worker unavailable, **then** components **MUST** show UNKNOWN state gracefully

## Requirements

### Functional Requirements

- **FR-001**: AuthStateManager **MUST** be initialized eagerly at service worker startup
- **FR-002**: **When** state changes, system **MUST** broadcast AUTH_STATE_CHANGED to all contexts
- **FR-003**: Components **MUST** subscribe via AUTH_STATE_GET on mount
- **FR-004**: **While** authenticated, badge **MUST** show no indicator
- **FR-005**: **While** unauthenticated, badge **MUST** show "!" warning
- **FR-006**: OAuth endpoints **MUST** use `webBaseUrl` (main domain), not `apiBaseUrl`

### State Machine

States: UNKNOWN, CHECKING, AUTHENTICATED, UNAUTHENTICATED, SESSION_EXPIRED, AUTHENTICATING, INSUFFICIENT_PRIVILEGES

### Key Entities

- **AuthStateData**: Current state, username, scopes, expiry, error
- **AuthStateManager**: Service worker singleton, owns state, broadcasts changes
- **AuthSubscriber**: Helper for popup/overlay to subscribe to state

## Implementation (Completed)

### New Files
| File | Purpose |
|------|---------|
| `src/auth/auth-state-machine.ts` | State enum, transitions, helpers |
| `src/auth/auth-state-manager.ts` | Centralized state in service worker |
| `src/auth/auth-subscriber.ts` | Component subscription helper |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/chrome.ts` | Added AUTH_STATE_GET, AUTH_STATE_CHANGED, AUTH_STATE_SUBSCRIBE |
| `src/background/service-worker.ts` | Eager AuthStateManager init, OAuth event wiring |
| `src/background/auth-monitor.ts` | Deprecated, delegates to AuthStateManager |
| `src/popup/popup.ts` | Listens for AUTH_STATE_CHANGED |
| `src/content/ui/overlay-bar.ts` | Auth check before capture, reactive updates |

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
