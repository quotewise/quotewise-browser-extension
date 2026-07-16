import { inspectTwitterDom } from '../../scripts/drift-check-dom';
import { TWITTER_DOM_SELECTORS } from '../../src/platforms/twitter/selectors';

describe('X DOM drift check', () => {
  it('does not report signed-in selector drift for X’s logged-out semantic renderer', () => {
    document.body.innerHTML = `
      <article
        data-tweet-id="20"
        itemscope
        itemtype="https://schema.org/SocialMediaPosting"
      >
        <meta itemprop="identifier" content="20">
        <meta itemprop="articleBody" content="just setting up my twttr">
      </article>
    `;

    expect(inspectTwitterDom({
      selectors: TWITTER_DOM_SELECTORS,
      kind: 'status',
    })).toEqual({ renderer: 'public', missing: [] });
  });
});
