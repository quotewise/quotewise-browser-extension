import type { CapturedPostData } from '../types';
import { isPlatformEnabled } from './capture';
import type { PlatformAdapter } from './types';
import { BlueskyAdapter } from './bluesky/adapter';
import { SubstackNotesAdapter } from './substack-notes/adapter';
import { ThreadsAdapter } from './threads/adapter';
import { TwitterAdapter } from './twitter/adapter';

export function createPlatformAdapters(): PlatformAdapter<CapturedPostData>[] {
  const adapters: PlatformAdapter<CapturedPostData>[] = [
    new TwitterAdapter(),
    new ThreadsAdapter(),
    new BlueskyAdapter(),
    new SubstackNotesAdapter(),
  ];

  return adapters.filter(adapter => isPlatformEnabled(adapter.id));
}

