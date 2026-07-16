type TwitterSelectors = {
  articleCandidates: readonly string[];
  authorLink: string;
  statusLink: string;
  tweetText: string;
  articleMarkers: string;
  articleBody: string;
};

export function inspectTwitterDom(
  { selectors, kind }: { selectors: TwitterSelectors; kind: 'status' | 'article' }
): { renderer: 'signed-in' | 'public'; missing: string[] } {
  const articles = [...document.querySelectorAll(selectors.articleCandidates.join(', '))];
  if (articles.length === 0) {
    const publicArticle = document.querySelector(
      'article[data-tweet-id][itemtype="https://schema.org/SocialMediaPosting"]'
    );
    return {
      renderer: publicArticle ? 'public' : 'signed-in',
      missing: publicArticle ? [] : ['article discovery'],
    };
  }

  const matches = (selector: string) => articles.some(article => article.querySelector(selector));
  return {
    renderer: 'signed-in',
    missing: [
      !matches(selectors.authorLink) && 'author link',
      !matches(selectors.statusLink) && 'status link',
      kind === 'status' && !matches(selectors.tweetText) && 'tweet text',
      kind === 'article' && !matches(selectors.articleMarkers) && 'article marker',
      kind === 'article' && !matches(selectors.articleBody) && 'article body',
    ].filter((value): value is string => Boolean(value)),
  };
}
