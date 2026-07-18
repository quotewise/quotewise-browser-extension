/**
 * In-Safari sign-in (bead em9; quotewise-apple contracts/extension-signin-flow.md).
 *
 * Safari Web Extensions have no chrome.identity.launchWebAuthFlow, so the extension can't run OAuth
 * in a popup. Instead it opens the authorize URL in a normal Safari TAB against a web redirect
 * (quotewise.io/oauth/extension-callback), and the container app exchanges the one-time code + PKCE
 * verifier into the shared Keychain. The refresh token never enters extension JS.
 *
 * Split into two steps ON PURPOSE. The background (an event page / MV3 service worker) can be torn
 * down while the user is signing in — the tray popup closes the moment the auth tab opens, which
 * removes the message port keeping the background alive. So we CANNOT watch the tab with an
 * in-memory chrome.tabs.onUpdated listener and await its result: that listener and its promise die
 * with the background, the callback fires into the void, and the user sees the callback page's
 * "you're all set" without ever being signed in. Instead:
 *   - startSafariSignIn(): store PKCE flow state (in chrome.storage.session, which survives the
 *     background unloading) and open the tab. Returns immediately.
 *   - completeSafariSignIn(): run later from the OAUTH_CALLBACK handler, on whatever background
 *     instance is alive, using only the persisted flow state. This is what makes sign-in survive.
 * Runs in the background context only.
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
const GRANTED_SCOPES = ['quotes:read', 'quotes:write', 'collections:read', 'collections:write'];

/** Callback parameters read off the extension-callback page by the content script. */
export interface SafariCallbackParams {
  code?: string;
  state?: string;
  error?: string;
}

/**
 * Begin the tab-based sign-in: persist PKCE flow state and open the authorize tab. Completion is
 * driven asynchronously by completeSafariSignIn() (via OAUTH_CALLBACK), not awaited here.
 */
export async function startSafariSignIn(): Promise<void> {
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
}

/**
 * Complete the tab-based sign-in from the callback params. Validates the CSRF state against the
 * persisted flow, then hands the one-time code + PKCE verifier to the container app, which exchanges
 * it into the shared Keychain. Resolves with the granted scopes; throws on cancel/verification
 * failure/exchange failure. The session lands in the app's Keychain, not here.
 */
export async function completeSafariSignIn(params: SafariCallbackParams): Promise<string[]> {
  const { code, state, error } = params;
  if (error) throw new Error(error);
  if (!code || !state) throw new Error('Sign-in was cancelled.');

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
