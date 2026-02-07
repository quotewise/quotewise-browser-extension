/**
 * Tests that badge updates to collection status after OAuth login
 *
 * Bug: When user logs in while on a tweet page with the overlay open,
 * the badge changes from grey (unauthenticated) to green/empty (authenticated)
 * but never re-runs the collection check to show ★/✓/+.
 *
 * The service worker's OAUTH_LOGIN handler must re-check collection status
 * for the current stored tweet after successful login.
 */

describe('Post-login badge update - structural verification', () => {
  test('OAUTH_LOGIN handler re-checks collection status after successful auth', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require.resolve('../../src/background/service-worker'),
      'utf8'
    );

    // Find the OAUTH_LOGIN case block
    const oauthLoginIndex = source.indexOf('case MessageType.OAUTH_LOGIN:');
    expect(oauthLoginIndex).toBeGreaterThan(-1);

    // Find the next case statement to bound our search
    const nextCaseIndex = source.indexOf('case MessageType.', oauthLoginIndex + 30);
    const oauthBlock = source.substring(oauthLoginIndex, nextCaseIndex);

    // After onAuthSuccess, the handler should retrieve stored tweet data
    expect(oauthBlock).toContain('currentTweet');

    // And re-run the collection status check
    expect(oauthBlock).toContain('checkQuoteCollectionStatus');
  });
});
