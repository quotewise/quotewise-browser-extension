#!/usr/bin/env node
/**
 * Build the Firefox WebExtension package from the SAME source as Chrome.
 *
 * Firefox needs NO separate repo — it consumes a plain WebExtension zip like Chrome (unlike Safari,
 * which needs an Apple/Xcode wrapper app). Approach: build the one shared dist/, then apply
 * target-specific manifest tweaks.
 *
 *   1. bun run build          → dist/ (production, from manifest.prod.json)
 *   2. copy dist/ → dist-firefox/
 *   3. patch manifest for Gecko:
 *        - browser_specific_settings.gecko.id / strict_min_version  (id REQUIRED for MV3 + AMO,
 *          and it determines the OAuth redirect URI — see ADR-0008)
 *        - background.scripts alongside service_worker  (Firefox has NO MV3 service worker; it runs
 *          background.scripts as an event page — the same path the Safari build uses, so the
 *          background code already works there)
 *   4. web-ext lint + build   → web-ext-artifacts/*.zip  (upload to addons.mozilla.org)
 *
 * Usage: bun run build:firefox
 * To submit (listed/AMO store): export WEB_EXT_API_KEY=<JWT issuer> and WEB_EXT_API_SECRET=<JWT
 *   secret> (web-ext reads both from the env), then `bun run sign:firefox`. MPL-2.0 is supplied via
 *   amo-metadata.json — AMO requires a license slug on listed versions.
 */
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// AMO add-on ID. Family convention: <platform>@extensions.quotewise.io — email-format (AMO rejects
// bare reverse-DNS like io.quotewise.firefox) with an 'extensions.' subdomain that marks it a machine
// identifier, not a mailbox (keeps clear of the reserved @quotewise.io email-role namespace). This
// determines the Firefox OAuth redirect URI the backend must whitelist; changing it re-triggers the
// ADR-0008 capture + re-registration. Change it here if you register a different ID on AMO.
const GECKO_ID = 'firefox@extensions.quotewise.io';
// Firefox floor. data_collection_permissions (below) needs FF 140+ (desktop); 140 is also the current
// ESR and comfortably clears the FF 120/121 line where MV3 background.scripts event-page behavior
// settled. NOTE: leaves web-ext's Firefox-for-Android min-version warning (that key needs Android
// 142) — we don't target/verify FF Android; add gecko_android.strict_min_version='142.0' if we do.
const STRICT_MIN_VERSION = '140.0';
// Firefox's mandatory data-consent declaration (AMO now requires it for new extensions). These are
// the SAME two data types disclosed for Chrome in docs/server-launch-adrs/ADR-0005 and
// docs/chrome-web-store-privacy-practices.md — kept identical so both stores tell users the same thing:
//   authenticationInfo → OAuth access/refresh tokens (keep the user signed in; sent as Bearer)
//   websiteContent     → captured quote text, author handle/name, source URL, engagement, collections
// NOT declared (the extension does none of these): PII, user/website activity, location, web history.
const DATA_COLLECTION_PERMISSIONS = { required: ['authenticationInfo', 'websiteContent'] };

const DIST = join(ROOT, 'dist');
const FF_DIR = join(ROOT, 'dist-firefox');
const ARTIFACTS = join(ROOT, 'web-ext-artifacts');

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

console.log('▶ building shared bundle (production)');
run('bun run build');

console.log(`▶ copying dist → ${FF_DIR}`);
rmSync(FF_DIR, { recursive: true, force: true });
cpSync(DIST, FF_DIR, { recursive: true });

console.log('▶ applying Firefox (Gecko) manifest adjustments');
const manifestPath = join(FF_DIR, 'manifest.json');
const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
m.browser_specific_settings = {
  ...m.browser_specific_settings,
  gecko: {
    id: GECKO_ID,
    strict_min_version: STRICT_MIN_VERSION,
    data_collection_permissions: DATA_COLLECTION_PERMISSIONS,
  },
};
m.background = { ...m.background, scripts: ['background/service-worker.js'] };
writeFileSync(manifestPath, JSON.stringify(m, null, 2));
console.log(`  gecko.id=${GECKO_ID}  strict_min_version=${STRICT_MIN_VERSION}  background.scripts set`);
console.log(`  data_collection_permissions.required=[${DATA_COLLECTION_PERMISSIONS.required.join(', ')}]`);

console.log('▶ web-ext lint + build');
run(`npx web-ext lint --source-dir="${FF_DIR}"`);
run(`npx web-ext build --source-dir="${FF_DIR}" --artifacts-dir="${ARTIFACTS}" --overwrite-dest`);

console.log('✔ Firefox package ready in web-ext-artifacts/ — upload to addons.mozilla.org');
