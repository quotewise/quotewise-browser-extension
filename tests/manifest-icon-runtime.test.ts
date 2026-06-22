import fs from 'fs';
import path from 'path';

function readManifest(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), name), 'utf8'));
}

describe('manifest icon/runtime wiring', () => {
  for (const manifestName of ['manifest.json', 'manifest.dev.json', 'manifest.prod.json']) {
    test(`${manifestName} fails closed to the grey logged-out action icon`, () => {
      const manifest = readManifest(manifestName);

      expect(manifest.action.default_icon).toEqual({
        16: 'icons/icon16-grey.png',
        32: 'icons/icon32-grey.png',
        48: 'icons/icon48-grey.png',
        128: 'icons/icon128-grey.png',
      });
    });

    test(`${manifestName} injects content script on supported platform hosts`, () => {
      const manifest = readManifest(manifestName);
      const matches = manifest.content_scripts[0].matches;

      expect(matches).toEqual(expect.arrayContaining([
        'https://twitter.com/*',
        'https://x.com/*',
        'https://threads.com/*',
        'https://*.threads.com/*',
        'https://threads.net/*',
        'https://*.threads.net/*',
        'https://bsky.app/*',
        'https://substack.com/*',
        'https://*.substack.com/*',
      ]));
    });

    test(`${manifestName} does not expose the content bundle via web_accessible_resources`, () => {
      // The content script is delivered via declared content_scripts and
      // chrome.scripting.executeScript({files}); neither needs web-accessible
      // resources. There is no chrome.runtime.getURL usage and no dynamic
      // import() (webpack splitChunks:false), so exposing content/* to host
      // pages only widens attack surface and CWS review scope.
      const manifest = readManifest(manifestName);
      expect(manifest.web_accessible_resources).toBeUndefined();
    });
  }
});
