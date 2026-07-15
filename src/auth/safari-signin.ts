/**
 * In-Safari sign-in (bead em9; quotewise-apple contracts/extension-signin-flow.md).
 *
 * Safari Web Extensions have no chrome.identity.launchWebAuthFlow, so the extension can't run OAuth
 * in a popup. Instead it opens the authorize URL in a normal Safari TAB against a web redirect
 * (quotewise.io/oauth/extension-callback), watches that tab for the callback, then hands the
 * one-time code + PKCE verifier to the container app, which exchanges it into the shared Keychain.
 * The refresh token never enters extension JS. Runs in the background context only.
 */
import { generatePKCEParams, storeFlowState, retrieveAndClearFlowState, validateState } from './pkce';
import { getOAuthConfig, debugLog } from '../config/environment';
import { completeSignInNative } from './native-bridge';

/** Must match OAuthConfig.extensionRedirectURI on the app side and the registered redirect URI. */
const EXTENSION_REDIRECT_URI = 'https://quotewise.io/oauth/extension-callback';
// The container app (broker) exchanges the code with the APPLE OAuth client, so the Safari authorize
// MUST use that same client — NOT the Chrome extension's client — and the extension-callback redirect
// must be registered on it. Keep in sync with QuotewiseKit OAuthConfig.production.clientID.
const APPLE_OAUTH_CLIENT_ID = '10b38fb6-7219-486f-946a-e92c522b4e72';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const GRANTED_SCOPES = ['quotes:read', 'quotes:write', 'collections:read', 'collections:write'];

/**
 * Run the tab-based sign-in. Resolves with the granted scopes on success; throws on
 * cancel/timeout/verification failure. The session lands in the app's shared Keychain, not here.
 */
export async function safariSignIn(): Promise<string[]> {
  const config = getOAuthConfig();
  const pkce = await generatePKCEParams();
  await storeFlowState(pkce.codeVerifier, pkce.state);

  const params = new URLSearchParams({
    client_id: APPLE_OAUTH_CLIENT_ID,
    redirect_uri: EXTENSION_REDIRECT_URI,
    response_type: 'code',
    code_challenge: pkce.codeChallenge,
    code_challenge_method: 'S256',
    scope: config.scopes.join(' '),
    state: pkce.state,
  });
  const authUrl = `${config.authorizeUrl}?${params.toString()}`;

  const tab = await chrome.tabs.create({ url: authUrl });
  if (tab.id === undefined) throw new Error('Could not open the sign-in tab.');

  const { code, state } = await waitForCallback(tab.id);

  // Validate state (CSRF) against what we issued, then let the app exchange the code.
  const flow = await retrieveAndClearFlowState();
  if (!flow || !validateState(state, flow.state)) {
    throw new Error('Sign-in could not be verified. Please try again.');
  }
  const signedIn = await completeSignInNative(code, flow.codeVerifier);
  if (!signedIn) throw new Error('Sign-in did not complete. Please try again.');

  debugLog('Safari in-tab sign-in complete');
  return GRANTED_SCOPES;
}

/** Resolve when the opened tab hits the callback URL; reject on error/close/timeout. */
function waitForCallback(tabId: number): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    // tab.url / changeInfo.url is populated here via the host permission for *.quotewise.io.
    const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId !== tabId) return;
      const url = changeInfo.url ?? tab.url;
      if (!url || !url.startsWith(EXTENSION_REDIRECT_URI)) return;
      const parsed = new URL(url);
      const error = parsed.searchParams.get('error');
      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state');
      chrome.tabs.remove(tabId).catch(() => { /* tab may already be gone */ });
      if (error || !code || !state) {
        finish(() => reject(new Error(error || 'Sign-in was cancelled.')));
      } else {
        finish(() => resolve({ code, state }));
      }
    };
    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) finish(() => reject(new Error('Sign-in was cancelled.')));
    };
    const timer = setTimeout(() => finish(() => reject(new Error('Sign-in timed out.'))), SIGN_IN_TIMEOUT_MS);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}
