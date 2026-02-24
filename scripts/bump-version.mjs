#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/bump-version.mjs <version|patch|minor|major>');
  process.exit(1);
}

// Resolve the new version
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

let newVersion;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  newVersion = arg;
} else if (['patch', 'minor', 'major'].includes(arg)) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (arg === 'patch') newVersion = `${major}.${minor}.${patch + 1}`;
  else if (arg === 'minor') newVersion = `${major}.${minor + 1}.0`;
  else newVersion = `${major + 1}.0.0`;
} else {
  console.error(`Invalid version argument: ${arg}`);
  console.error('Expected a semver (e.g. 0.2.0) or patch/minor/major');
  process.exit(1);
}

// 1. Update package.json
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json: ${current} → ${newVersion}`);

// 2. Update src/extension/manifest.json
const manifestPath = resolve(root, 'src/extension/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = newVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json: ${current} → ${newVersion}`);

// 3. Sync package-lock.json
execSync('npm install --package-lock-only', { cwd: root, stdio: 'inherit' });
console.log('package-lock.json synced');

console.log(`\n✓ Bumped to ${newVersion}`);
