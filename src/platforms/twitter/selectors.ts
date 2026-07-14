export const TWITTER_DOM_SELECTORS = {
  articleCandidates: [
    'article[data-testid="tweet"]',
    'article[role="article"]',
    'div[data-testid="tweet"]',
    '[data-testid="primaryColumn"] article',
  ],
  tweetText: '[data-testid="tweetText"]',
  articleBody: '[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]',
  articleMarkers: '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]',
  authorLink: '[data-testid="User-Name"] a[href*="/"]',
  statusTimeLink: 'a[href*="/status/"] time',
  statusLink: 'a[href*="/status/"]',
} as const;
