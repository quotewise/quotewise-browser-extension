#!/usr/bin/env node
/**
 * Keep package.json and manifest.json versions in sync.
 * Usage: node scripts/bump-version.js <version>
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const manifestPath = path.join(root, 'manifest.json');
const pkgPath = path.join(root, 'package.json');

const newVersion = process.argv[2];
if (!newVersion) {
  console.error('Usage: node scripts/bump-version.js <version>');
  process.exit(1);
}

function updateJson(filePath, updater) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = updater(json);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n');
}

updateJson(pkgPath, (pkg) => ({ ...pkg, version: newVersion }));

updateJson(manifestPath, (manifest) => ({
  ...manifest,
  version: newVersion
}));

console.log(`Version set to ${newVersion} in package.json and manifest.json`);
