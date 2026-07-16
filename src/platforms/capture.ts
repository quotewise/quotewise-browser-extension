import type { CapturedPostData } from '../types/chrome';

/**
 * A supported capture platform. Adding a platform is a single edit here plus an
 * adapter and manifest `matches` — see docs/adding-a-platform.md. Everything else
 * (the `CapturePlatform`/`CapturePlatformCode` unions, the URL→platform match, the
 * source-id extraction) derives from this table.
 */
export interface PlatformDefinition {
  /** Backend platform code (e.g. 'TX'). */
  code: string;
  /** Human-facing platform name. */
  displayName: string;
  /** Whether the platform's adapter is active. */
  enabled: boolean;
  /** Hostnames (and their subdomains) this platform serves from. */
  hostSuffixes: string[];
  /** Extract the platform's stable post id from a URL pathname, or null. */
  sourceId(path: string): string | null;
}

export const PLATFORM_DEFINITIONS = {
  twitter: {
    code: 'TX',
    displayName: 'X/Twitter',
    enabled: true,
    hostSuffixes: ['twitter.com', 'x.com'],
    sourceId: (path: string) => path.match(/\/status\/(\d+)/)?.[1] ?? null,
  },
  threads: {
    code: 'TH',
    displayName: 'Threads',
    enabled: true,
    hostSuffixes: ['threads.com', 'threads.net'],
    sourceId: (path: string) => path.match(/\/(?:post|t)\/([^/?#]+)/)?.[1] ?? null,
  },
  bluesky: {
    code: 'BS',
    displayName: 'Bluesky',
    enabled: true,
    hostSuffixes: ['bsky.app'],
    sourceId: (path: string) => path.match(/\/profile\/[^/]+\/post\/([^/?#]+)/)?.[1] ?? null,
  },
  substack_notes: {
    code: 'SS',
    displayName: 'Substack Notes',
    enabled: true,
    hostSuffixes: ['substack.com'],
    sourceId: (path: string) =>
      path.match(/\/(?:note|p)\/([^/?#]+)/)?.[1] ??
      path.match(/\/notes?\/([^/?#]+)/)?.[1] ??
      null,
  },
} as const satisfies Record<string, PlatformDefinition>;

/** Supported capture platforms, derived from PLATFORM_DEFINITIONS (single source of truth). */
export type CapturePlatform = keyof typeof PLATFORM_DEFINITIONS;
/** Backend platform codes, derived from PLATFORM_DEFINITIONS. */
export type CapturePlatformCode = (typeof PLATFORM_DEFINITIONS)[CapturePlatform]['code'];

export interface CaptureIdentity {
  platform: CapturePlatform;
  sourceId: string;
}

export function isCapturePlatform(value: unknown): value is CapturePlatform {
  // Own-key membership against the single source of truth. (A bare `value in
  // PLATFORM_DEFINITIONS` would also accept prototype keys like 'toString'.)
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLATFORM_DEFINITIONS, value);
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

    for (const [id, definition] of Object.entries(PLATFORM_DEFINITIONS)) {
      if (definition.hostSuffixes.some(suffix => hostnameMatches(host, suffix))) {
        return id as CapturePlatform;
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
    if (!platform) return null;
    return PLATFORM_DEFINITIONS[platform].sourceId(parsed.pathname);
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
