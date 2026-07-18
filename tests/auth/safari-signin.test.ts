/**
 * completeSafariSignIn — the survivable completion step of in-Safari sign-in (bead em9).
 *
 * This is the step that runs on a possibly-reborn background from the OAUTH_CALLBACK handler, so its
 * guarantees matter: it must validate the CSRF state against the persisted flow BEFORE handing the
 * one-time code to the container app, and it must never exchange when verification fails. The full
 * Safari-event-page survival can only be verified on-device; this pins the logic that decides
 * whether an exchange happens at all.
 */
import { completeSafariSignIn } from '../../src/auth/safari-signin';

const NATIVE_APP_ID = 'io.quotewise.apple';
const FLOW_STATE_KEY = 'oauth_flow_state';

function mockNative(response: unknown): jest.Mock {
  const fn = jest.fn((_appId: string, _msg: unknown, cb: (r: unknown) => void) => cb(response));
  (chrome.runtime as unknown as { sendNativeMessage: unknown }).sendNativeMessage = fn;
  return fn;
}

describe('completeSafariSignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.runtime as unknown as { lastError: unknown }).lastError = null;
    (chrome.storage.session.get as jest.Mock).mockResolvedValue({
      [FLOW_STATE_KEY]: { codeVerifier: 'verifier-xyz', state: 'state-abc', startedAt: Date.now() },
    });
    (chrome.storage.session.remove as jest.Mock).mockResolvedValue(undefined);
  });

  it('validates state, hands the code + PKCE verifier to the app, and returns granted scopes', async () => {
    const native = mockNative({ ok: true, status: 'signed_in' });

    const scopes = await completeSafariSignIn({ code: 'one-time-code', state: 'state-abc' });

    expect(scopes).toContain('quotes:write');
    // The one-time code + verifier go to the app broker — never exchanged inside extension JS.
    expect(native).toHaveBeenCalledWith(
      NATIVE_APP_ID,
      expect.objectContaining({ type: 'COMPLETE_SIGN_IN', code: 'one-time-code', codeVerifier: 'verifier-xyz' }),
      expect.any(Function)
    );
    // Flow state is single-use — cleared regardless of outcome.
    expect(chrome.storage.session.remove).toHaveBeenCalledWith(FLOW_STATE_KEY);
  });

  it('rejects a mismatched CSRF state WITHOUT touching the native bridge', async () => {
    const native = mockNative({ ok: true, status: 'signed_in' });

    await expect(
      completeSafariSignIn({ code: 'one-time-code', state: 'attacker-state' })
    ).rejects.toThrow(/could not be verified/i);
    expect(native).not.toHaveBeenCalled();
  });

  it('rejects when the persisted flow is gone (background lost it / expired), no exchange', async () => {
    (chrome.storage.session.get as jest.Mock).mockResolvedValue({});
    const native = mockNative({ ok: true, status: 'signed_in' });

    await expect(
      completeSafariSignIn({ code: 'one-time-code', state: 'state-abc' })
    ).rejects.toThrow(/could not be verified/i);
    expect(native).not.toHaveBeenCalled();
  });

  it('propagates a provider error (e.g. access_denied) without exchanging', async () => {
    const native = mockNative({ ok: true, status: 'signed_in' });

    await expect(
      completeSafariSignIn({ error: 'access_denied', state: 'state-abc' })
    ).rejects.toThrow(/access_denied/);
    expect(native).not.toHaveBeenCalled();
  });

  it('surfaces a failed app exchange as a sign-in failure', async () => {
    mockNative({ ok: false });

    await expect(
      completeSafariSignIn({ code: 'one-time-code', state: 'state-abc' })
    ).rejects.toThrow(/did not complete/i);
  });
});
