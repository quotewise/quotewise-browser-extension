# PBI 12: OAuth 2.0 Authentication

## Summary

Replace Django session cookie authentication with OAuth 2.0 Authorization Code + PKCE flow using Chrome's `launchWebAuthFlow()` API. Provides seamless "no-nag" UX with long-lived refresh tokens and automatic background refresh.

## Actor

Users (all extension users)

## User Story

As a user, I want to authenticate using OAuth 2.0 with seamless token refresh, so that I stay logged in without frequent re-authentication.

## Background

### Current State
- Django session cookies (`sessionid`) + CSRF tokens
- Session lifetime: 3 weeks
- Requires `is_staff` flag for quote submission
- Session expiry requires manual web re-login
- Origin/Referer header spoofing to work around CSRF

### Why Change?
- **Better UX**: 90-day sliding window means active users never re-auth
- **Modern auth**: OAuth 2.0 is the standard for third-party applications
- **Token security**: Rotation on every refresh, theft detection
- **Remove hacks**: No more CSRF workarounds or header spoofing

## Conditions of Satisfaction

1. OAuth 2.0 Authorization Code + PKCE via `chrome.identity.launchWebAuthFlow()`
2. Access tokens stored in `chrome.storage.session` (cleared on browser close)
3. Refresh tokens stored in `chrome.storage.local` (persists across restarts)
4. Token lifetimes: 1-hour access, 90-day sliding refresh, 1-year absolute max
5. Proactive token refresh scheduled 5 minutes before expiry
6. Bearer token auth replaces session cookies in all API calls
7. Graceful degradation when offline (use cached auth state)
8. Remove all CSRF/session cookie code after migration

## Dependencies

- **Backend OAuth infrastructure**: Token rotation, sliding window, TokenFamily model
- **OAuth client registration**: Seeded via `quotewise/migrations/0090_seed_chrome_extension_oauth_client.py`
  - Client ID: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
  - Dev extension ID: `boggjfjnnbkndnpbmengeeggijnkhhmn`

## Technical Approach

### Authentication Flow

```
1. User clicks "Login" in popup
2. Extension generates PKCE code_verifier + code_challenge (S256)
3. launchWebAuthFlow() opens api.quotewise.io/oauth/authorize
   - client_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890
   - redirect_uri=https://boggjfjnnbkndnpbmengeeggijnkhhmn.chromiumapp.org/callback
   - response_type=code
   - code_challenge=<sha256>
   - code_challenge_method=S256
   - scope=quotes:read quotes:write collections:read collections:write
4. User authenticates on quotewise.io
5. User approves consent
6. Redirect back with auth code
7. Extension exchanges code for tokens
8. Store tokens in chrome.storage
9. Schedule refresh via chrome.alarms
```

### Token Storage

| Token | Storage | Lifetime |
|-------|---------|----------|
| Access token | `chrome.storage.session` | 1 hour |
| Refresh token | `chrome.storage.local` | 90 days sliding |

### Security Model

1. **PKCE required**: Extension is public client (no client_secret)
2. **Token rotation**: New refresh token each refresh, old invalidated
3. **Theft detection**: Reuse of old rotated token revokes entire family
4. **1-year max**: Even active users must re-auth annually

## Out of Scope

- Anonymous API functionality (deferred - see plan)
- Replacing `is_staff` with OAuth scopes (Phase 3)
- Mobile app authentication (different flow)

## References

- RFC 6749: OAuth 2.0 Authorization Framework
- RFC 7636: PKCE
- Chrome identity API: https://developer.chrome.com/docs/extensions/reference/identity/
- Backend migration: `quotewise-develop/quotewise/migrations/0090_seed_chrome_extension_oauth_client.py`
