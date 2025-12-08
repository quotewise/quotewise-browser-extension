#!/usr/bin/env node
/**
 * Keep package.json and manifest.json versions in sync.
 * Usage: node scripts/bump-version.js <version|major|minor|patch>
 *
 * Examples:
 *   node scripts/bump-version.js 1.2.3    # Set explicit version
 *   node scripts/bump-version.js patch    # Bump 1.2.0 -> 1.2.1
 *   node scripts/bump-version.js minor    # Bump 1.2.0 -> 1.3.0
 *   node scripts/bump-version.js major    # Bump 1.2.0 -> 2.0.0
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const manifestPath = path.join(root, 'manifest.json');
const pkgPath = path.join(root, 'package.json');

const versionArg = process.argv[2];
if (!versionArg) {
  console.error('Usage: node scripts/bump-version.js <version|major|minor|patch>');
  process.exit(1);
}

/**
 * Parse semver string into parts
 */
function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

/**
 * Bump version based on type
 */
function bumpVersion(currentVersion, bumpType) {
  const parts = parseSemver(currentVersion);
  if (!parts) {
    console.error(`Invalid current version: ${currentVersion}`);
    process.exit(1);
  }

  switch (bumpType) {
    case 'major':
      return `${parts.major + 1}.0.0`;
    case 'minor':
      return `${parts.major}.${parts.minor + 1}.0`;
    case 'patch':
      return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
    default:
      console.error(`Unknown bump type: ${bumpType}`);
      process.exit(1);
  }
}

/**
 * Determine new version from argument
 */
function getNewVersion(arg) {
  const bumpTypes = ['major', 'minor', 'patch'];

  if (bumpTypes.includes(arg)) {
    // Read current version from package.json
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const currentVersion = pkg.version;
    return bumpVersion(currentVersion, arg);
  }

  // Validate explicit version format
  if (!parseSemver(arg)) {
    console.error(`Invalid version format: ${arg}`);
    console.error('Expected format: X.Y.Z (e.g., 1.2.3) or bump type (major|minor|patch)');
    process.exit(1);
  }

  return arg;
}

function updateJson(filePath, updater) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = updater(json);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n');
}

const newVersion = getNewVersion(versionArg);

updateJson(pkgPath, (pkg) => ({ ...pkg, version: newVersion }));

updateJson(manifestPath, (manifest) => ({
  ...manifest,
  version: newVersion
}));

console.log(`Version bumped to ${newVersion} in package.json and manifest.json`);
