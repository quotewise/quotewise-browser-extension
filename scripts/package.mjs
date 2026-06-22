#!/usr/bin/env node
/**
 * Package the built extension into a versioned zip for Chrome Web Store upload.
 *
 * Usage: npm run package   (runs `npm run build` first, then zips dist/)
 *
 * The zip contains only what Chrome needs — everything webpack emits to dist/
 * (manifest, service worker, content/options bundles, icons, options.html) —
 * and explicitly excludes source maps and any stray TypeScript declaration
 * files so the upload stays minimal and the review surface small.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');

if (!existsSync(distDir)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

// Version comes from the production manifest (the artifact that ships).
const { version } = JSON.parse(readFileSync(resolve(root, 'manifest.prod.json'), 'utf8'));
const zipName = `quotewise-extension-v${version}.zip`;
const zipPath = resolve(root, zipName);

// Overwrite any prior artifact for the same version.
if (existsSync(zipPath)) {
  rmSync(zipPath);
}

try {
  execFileSync(
    'zip',
    ['-r', '-X', zipPath, '.', '-x', '*.map', '*.d.ts', '*.d.ts.map', '*.md'],
    { cwd: distDir, stdio: 'inherit' },
  );
} catch {
  console.error('Failed to create the zip. Is the `zip` CLI installed and on PATH?');
  process.exit(1);
}

console.log(`\nPackaged ${zipName}`);
