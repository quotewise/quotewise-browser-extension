/**
 * Content script on the OAuth extension-callback page (bead em9).
 *
 * The in-Safari sign-in tab redirects here with ?code&state. We cannot rely on a background
 * chrome.tabs.onUpdated listener seeing that navigation: the tray popup closes when the auth tab
 * opens, which lets the background (event page / MV3 service worker) be torn down during the
 * user-driven sign-in — taking any in-memory listener with it. This script runs IN the page, so it
 * survives, reads the one-time code + CSRF state from the page's OWN url, and messages the
 * background. That message wakes whatever background instance exists, which completes sign-in via
 * the container app (OAUTH_CALLBACK handler). The code/state are already in this page's URL — this
 * exposes them nowhere new, and they never leave the extension.
 */
import { MessageType } from '../types/chrome';

const params = new URLSearchParams(location.search);
const code = params.get('code') ?? undefined;
const state = params.get('state') ?? undefined;
const error = params.get('error') ?? undefined;

// Only speak up for an actual OAuth callback (code present, or an explicit error). A bare visit to
// the page with no params is not our concern.
if (code || error) {
  // One send, no retry: MV3 starts the background and queues this until its top-level onMessage
  // listener is registered, so delivery is reliable. A retry would risk double-completion (the flow
  // state is single-use) if the background died mid-exchange, so we deliberately don't.
  void Promise.resolve(
    chrome.runtime.sendMessage({ type: MessageType.OAUTH_CALLBACK, data: { code, state, error } })
  ).catch(() => undefined);
}
