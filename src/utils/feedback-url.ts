export type FeedbackPlatform = 'twitter';

export interface FeedbackUrlOptions {
  version?: string;
  platform?: FeedbackPlatform;
}

const FEEDBACK_BASE_URL = 'https://quotewise.io/feedback/';
const FEEDBACK_SOURCE = 'chrome-ext';

export function buildFeedbackUrl(options: FeedbackUrlOptions = {}): string {
  const url = new URL(FEEDBACK_BASE_URL);
  url.searchParams.set('src', FEEDBACK_SOURCE);

  if (options.version) {
    url.searchParams.set('v', options.version);
  }

  if (options.platform) {
    url.searchParams.set('platform', options.platform);
  }

  return url.toString();
}
