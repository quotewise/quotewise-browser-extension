import { getOAuthConfig } from '../../src/config/environment';

// getOAuthConfig().redirectUri must follow the running browser, not hardcode chromiumapp.org, so the
// same build authenticates in both Chrome and Firefox (see ADR-0008).
describe('getOAuthConfig redirect URI (cross-browser)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const identity = (global as any).chrome.identity;

  afterEach(() => {
    delete identity.getRedirectURL;
  });

  it('uses chrome.identity.getRedirectURL when available (Chrome + Firefox)', () => {
    identity.getRedirectURL = jest.fn((path: string) => `https://abc123.extensions.allizom.org/${path}`);
    expect(getOAuthConfig().redirectUri).toBe('https://abc123.extensions.allizom.org/callback');
    expect(identity.getRedirectURL).toHaveBeenCalledWith('callback');
  });

  it('falls back to the chromiumapp.org form when getRedirectURL is unavailable', () => {
    expect(getOAuthConfig().redirectUri).toBe('https://test-extension-id.chromiumapp.org/callback');
  });
});
