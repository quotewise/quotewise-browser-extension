#!/usr/bin/env node
/**
 * Keep package, manifest, and lockfile versions in sync.
 * Usage: node scripts/bump-version.js <version|major|minor|patch|check>
 *
 * Examples:
 *   node scripts/bump-version.js 1.2.3    # Set explicit version
 *   node scripts/bump-version.js patch    # Bump 1.2.0 -> 1.2.1
 *   node scripts/bump-version.js minor    # Bump 1.2.0 -> 1.3.0
 *   node scripts/bump-version.js major    # Bump 1.2.0 -> 2.0.0
 *   node scripts/bump-version.js check    # Verify all project versions match
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const pkgPath = path.join(root, 'package.json');
const projectVersionFiles = [
  'package.json',
  'manifest.json',
  'manifest.dev.json',
  'manifest.prod.json',
  'package-lock.json'
];

const versionArg = process.argv[2];
if (!versionArg) {
  console.error('Usage: node scripts/bump-version.js <version|major|minor|patch|check>');
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, json) {
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
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
    const pkg = readJson(pkgPath);
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

function updateJsonFile(relativePath, updater) {
  const filePath = path.join(root, relativePath);
  const json = readJson(filePath);
  const updated = updater(json);
  writeJson(filePath, updated);
}

function updateManifest(relativePath, newVersion) {
  updateJsonFile(relativePath, (manifest) => ({
    ...manifest,
    version: newVersion
  }));
}

function updatePackageJson(newVersion) {
  updateJsonFile('package.json', (pkg) => ({
    ...pkg,
    version: newVersion
  }));
}

function updatePackageLock(newVersion) {
  updateJsonFile('package-lock.json', (lockfile) => {
    const updated = {
      ...lockfile,
      version: newVersion
    };

    if (updated.packages?.['']) {
      updated.packages[''] = {
        ...updated.packages[''],
        version: newVersion
      };
    }

    return updated;
  });
}

function getProjectVersions() {
  const versions = [];

  for (const relativePath of projectVersionFiles) {
    const json = readJson(path.join(root, relativePath));

    if (relativePath === 'package-lock.json') {
      versions.push([relativePath, json.version]);
      versions.push([`${relativePath} packages[""]`, json.packages?.['']?.version]);
    } else {
      versions.push([relativePath, json.version]);
    }
  }

  return versions;
}

function checkVersions() {
  const versions = getProjectVersions();
  const missing = versions.filter(([, version]) => !version);
  const unique = new Set(versions.map(([, version]) => version).filter(Boolean));

  if (missing.length === 0 && unique.size === 1) {
    console.log(`Project versions are in sync at ${[...unique][0]}`);
    return;
  }

  console.error('Project version drift detected:');
  for (const [label, version] of versions) {
    console.error(`- ${label}: ${version || '<missing>'}`);
  }
  process.exit(1);
}

if (versionArg === 'check') {
  checkVersions();
  process.exit(0);
}

const newVersion = getNewVersion(versionArg);

updatePackageJson(newVersion);
updateManifest('manifest.json', newVersion);
updateManifest('manifest.dev.json', newVersion);
updateManifest('manifest.prod.json', newVersion);
updatePackageLock(newVersion);

console.log(`Version bumped to ${newVersion} in ${projectVersionFiles.join(', ')}`);
