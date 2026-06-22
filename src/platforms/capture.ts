import type {
  CapturedPostData,
  CapturePlatform,
  CapturePlatformCode,
} from '../types/chrome';

export interface PlatformDefinition {
  id: CapturePlatform;
  code: CapturePlatformCode;
  displayName: string;
  enabled: boolean;
  hostSuffixes: string[];
}

export const PLATFORM_DEFINITIONS: Record<CapturePlatform, PlatformDefinition> = {
  twitter: {
    id: 'twitter',
    code: 'TX',
    displayName: 'X/Twitter',
    enabled: true,
    hostSuffixes: ['twitter.com', 'x.com'],
  },
  threads: {
    id: 'threads',
    code: 'TH',
    displayName: 'Threads',
    enabled: true,
    hostSuffixes: ['threads.com', 'threads.net'],
  },
  bluesky: {
    id: 'bluesky',
    code: 'BS',
    displayName: 'Bluesky',
    enabled: true,
    hostSuffixes: ['bsky.app'],
  },
  substack_notes: {
    id: 'substack_notes',
    code: 'SS',
    displayName: 'Substack Notes',
    enabled: true,
    hostSuffixes: ['substack.com'],
  },
};

export interface CaptureIdentity {
  platform: CapturePlatform;
  sourceId: string;
}

export function isCapturePlatform(value: unknown): value is CapturePlatform {
  return (
    value === 'twitter' ||
    value === 'threads' ||
    value === 'bluesky' ||
    value === 'substack_notes'
  );
}

export function platformCodeFor(platform: CapturePlatform): CapturePlatformCode {
  return PLATFORM_DEFINITIONS[platform].code;
}

export function isPlatformEnabled(platform: CapturePlatform): boolean {
  return PLATFORM_DEFINITIONS[platform].enabled;
}

function hostnameMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function platformFromUrl(url?: string): CapturePlatform | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    for (const definition of Object.values(PLATFORM_DEFINITIONS)) {
      if (definition.hostSuffixes.some(suffix => hostnameMatches(host, suffix))) {
        return definition.id;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function sourceIdFromUrl(url?: string): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const platform = platformFromUrl(url);
    const path = parsed.pathname;

    switch (platform) {
      case 'twitter':
        return path.match(/\/status\/(\d+)/)?.[1] ?? null;
      case 'threads':
        return path.match(/\/(?:post|t)\/([^/?#]+)/)?.[1] ?? null;
      case 'bluesky':
        return path.match(/\/profile\/[^/]+\/post\/([^/?#]+)/)?.[1] ?? null;
      case 'substack_notes':
        return path.match(/\/(?:note|p)\/([^/?#]+)/)?.[1] ??
          path.match(/\/notes?\/([^/?#]+)/)?.[1] ??
          null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function capturePlatform(data: CapturedPostData): CapturePlatform {
  if (isCapturePlatform(data.platform)) {
    return data.platform;
  }

  return platformFromUrl(captureSourceUrl(data)) ?? 'twitter';
}

export function capturePlatformCode(data: CapturedPostData): CapturePlatformCode {
  if (data.platformCode) {
    return data.platformCode;
  }

  return platformCodeFor(capturePlatform(data));
}

export function captureSourceUrl(data: CapturedPostData): string {
  return data.sourceUrl || data.url || '';
}

export function captureSourceId(data: CapturedPostData): string | null {
  if (typeof data.sourceId === 'string' && data.sourceId) {
    return data.sourceId;
  }

  const platformData = capturePlatformData(data);
  const explicit = platformData.source_id ?? platformData.post_id ?? platformData.note_id;
  if (typeof explicit === 'string' && explicit) {
    return explicit;
  }

  if (typeof platformData.tweet_id === 'string' && platformData.tweet_id) {
    return platformData.tweet_id;
  }

  return sourceIdFromUrl(captureSourceUrl(data));
}

export function captureAuthorHandle(data: CapturedPostData): string | undefined {
  const handle = data.author?.handle || data.author?.username;
  return typeof handle === 'string' && handle.trim()
    ? handle.trim().replace(/^@/, '')
    : undefined;
}

export function capturePostedAt(data: CapturedPostData): string | null {
  return data.postedAt ?? data.date ?? null;
}

export function captureLikesCount(data: CapturedPostData): number | undefined {
  if (typeof data.likesCount === 'number') {
    return data.likesCount;
  }

  return typeof data.likes === 'number' ? data.likes : undefined;
}

export function captureRequiresSelection(data: CapturedPostData): boolean {
  return !!(data.requiresSelection || data.isArticle);
}

export function capturePlatformData(data?: CapturedPostData | null): Record<string, string | number | boolean | null | undefined> {
  if (!data) return {};
  return data.platformData || data.platform_data || {};
}

export function captureIdentityFromUrl(url?: string): CaptureIdentity | null {
  const platform = platformFromUrl(url);
  const sourceId = sourceIdFromUrl(url);
  return platform && sourceId ? { platform, sourceId } : null;
}

export function captureIdentityFromData(data: unknown): CaptureIdentity | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const value = data as CapturedPostData;
  const platform = capturePlatform(value);
  const sourceId = captureSourceId(value);
  return sourceId ? { platform, sourceId } : null;
}

export function isSameCaptureUrl(expectedUrl?: string, currentUrl?: string): boolean {
  const expected = captureIdentityFromUrl(expectedUrl);
  const current = captureIdentityFromUrl(currentUrl);

  return !!expected &&
    !!current &&
    expected.platform === current.platform &&
    expected.sourceId === current.sourceId;
}

export function isSupportedPlatformUrl(url?: string): boolean {
  return platformFromUrl(url) !== null;
}

export function isSupportedPermalinkUrl(url?: string): boolean {
  return captureIdentityFromUrl(url) !== null;
}
