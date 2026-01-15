# Tasks for PBI 12: OAuth 2.0 Authentication

This document lists all tasks associated with PBI 12.

**Parent PBI**: [PBI 12: OAuth 2.0 Authentication](./prd.md)

## Task Summary

| Task ID | Name | Status | Description |
| :------ | :--- | :----- | :---------- |
| 12-1 | PKCE Implementation | Completed | Generate code_verifier and code_challenge (S256) |
| 12-2 | launchWebAuthFlow Integration | Completed | Implement chrome.identity.launchWebAuthFlow() |
| 12-3 | Token Storage Module | Completed | chrome.storage.local/.session wrappers |
| 12-4 | Token Refresh Scheduling | Completed | chrome.alarms for proactive refresh 5 min before expiry |
| 12-5 | Bearer Token API Client | Completed | Replace cookie auth with Authorization: Bearer header |
| 12-6 | Auth State Management | Completed | Unified auth state across popup, content, service worker |
| 12-7 | Service Worker Wake-up | Completed | Restore token state when service worker restarts |
| 12-8 | Manifest Permissions | Completed | Add identity and alarms permissions to manifest.json |
| 12-9 | Remove Session Auth | Completed | Delete csrf-utils.ts, cookie handling, header spoofing |
| 12-10 | Offline Graceful Degradation | Completed | Handle network errors without logging user out |
| 12-11 | E2E OAuth Test | Completed | Verify full login → refresh → logout flow |

## OAuth Client Registration

The OAuth client is registered via Django migration in `quotewise-develop`:
- **Migration**: `quotewise/migrations/0090_seed_chrome_extension_oauth_client.py`
- **Client ID**: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- **Dev Extension ID**: `boggjfjnnbkndnpbmengeeggijnkhhmn`

```json
{
  "client_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "client_name": "Quotewise Chrome Extension",
  "redirect_uris": [
    "https://boggjfjnnbkndnpbmengeeggijnkhhmn.chromiumapp.org/callback"
  ],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

Note: Production extension ID will be added after Chrome Web Store publish.

## Files Created

| File | Purpose |
|------|---------|
| `src/auth/pkce.ts` | PKCE code_verifier/challenge generation |
| `src/auth/token-storage.ts` | chrome.storage wrappers for tokens |
| `src/auth/auth-flow.ts` | OAuth flow orchestration with launchWebAuthFlow |
| `src/auth/token-refresh.ts` | Background refresh scheduling via chrome.alarms |
| `src/types/oauth.ts` | OAuth type definitions |

## Files Modified

| File | Changes |
|------|---------|
| `src/api/quotewise-api.ts` | Bearer token headers, automatic 401 refresh retry |
| `src/background/auth-monitor.ts` | Token expiry monitoring |
| `src/background/service-worker.ts` | Alarm listener, wake recovery |
| `src/auth/auth-checker.ts` | Token-based validation |
| `src/auth/login-handler.ts` | OAuth flow instead of tab redirect |
| `manifest.json` | Add identity and alarms permissions |
| `tests/setup.ts` | Chrome API mocks for identity, alarms, storage.session |

## Files Removed

| File | Reason |
|------|--------|
| `src/api/csrf-utils.ts` | No longer needed with Bearer auth |

## Security Model

1. **PKCE required**: Extension is public client (no client_secret)
2. **Token rotation**: New refresh token each refresh, old invalidated
3. **Theft detection**: Reuse of old rotated token revokes entire family
4. **Specific redirect URIs**: Only registered extension IDs can complete OAuth flow
