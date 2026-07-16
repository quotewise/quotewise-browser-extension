# Adding a platform

Capture support for a new social platform is four edits: an adapter, one
`PLATFORM_DEFINITIONS` entry, the manifest host matches, and a test. The type
unions, URL matching, and source-id extraction all derive from the definition, so
there is nothing else to hand-sync.

Throughout, replace `example` / `EX` / `example.com` with your platform.

## 1. Add a `PLATFORM_DEFINITIONS` entry

In [`src/platforms/capture.ts`](../src/platforms/capture.ts), add one entry to
`PLATFORM_DEFINITIONS`:

```ts
example: {
  code: 'EX',                       // backend platform code
  displayName: 'Example',
  enabled: true,
  hostSuffixes: ['example.com'],    // host + subdomains this platform serves from
  sourceId: (path: string) => path.match(/\/post\/([^/?#]+)/)?.[1] ?? null,
},
```

`sourceId` extracts the stable post id from a URL pathname (the value the backend
dedupes on). That is the whole platform table. `CapturePlatform`,
`CapturePlatformCode`, `platformFromUrl`, and `sourceIdFromUrl` all update
automatically from this entry.

## 2. Implement the adapter

Create `src/platforms/example/adapter.ts` implementing
[`PlatformAdapter`](../src/platforms/types.ts):

```ts
export class ExampleAdapter implements PlatformAdapter<CapturedPostData> {
  id: CapturePlatform = 'example';               // must match the definition key
  matches(location: Location): boolean { /* is this a capturable page? */ }
  async bootstrap(): Promise<void> { /* start observing the DOM */ }
  async teardown(): Promise<void> { /* stop observing */ }
  async getLatestData(): Promise<CapturedPostData | null> { /* extract the post */ }
}
```

Extraction should populate `CapturedPostData` with the post text, the author
(`handle` without a leading `@`), the source URL, and any engagement counts.
Use the Twitter adapter (`src/platforms/twitter/`) as the reference; the DOM
helpers in `src/content/` are shared.

Then register it in
[`src/platforms/registry.ts`](../src/platforms/registry.ts):

```ts
const adapters: PlatformAdapter<CapturedPostData>[] = [
  // …existing adapters
  new ExampleAdapter(),
];
```

The registry filters on `isPlatformEnabled(adapter.id)`, so an entry with
`enabled: false` ships the adapter dark.

## 3. Add the manifest host matches

**This is the easy one to miss — get it wrong and the extension silently fails to
load on the platform.** Add the hosts to **both** `manifest.dev.json` and
`manifest.prod.json` (the Firefox build derives from `manifest.prod.json`), in
two places each:

- `host_permissions`
- `content_scripts[0].matches`

```json
"https://example.com/*",
"https://*.example.com/*"
```

Keep these in sync with the `hostSuffixes` in your definition.

## 4. Add a fixture test

Add a per-platform DOM-fixture test next to
[`tests/platforms/multi-platform-adapters.test.ts`](../tests/platforms/multi-platform-adapters.test.ts)
(the newer adapters currently share that one thin file — a per-platform fixture
test is the expectation for a new platform). Capture a representative post's DOM
as a fixture and assert your adapter extracts the text, author, source URL, and
`sourceId` correctly. Also confirm URL routing:

```ts
expect(platformFromUrl('https://example.com/user/post/123')).toBe('example');
expect(sourceIdFromUrl('https://example.com/user/post/123')).toBe('123');
```

## Verify

```bash
bun run type-check && bun run lint && bun run test && bun run build
```

Then load `dist/` unpacked (see the [README](../README.md)) and confirm capture
works on a real post.
