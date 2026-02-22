#!/usr/bin/env node
/**
 * Rebuild native addon against Electron's Node ABI.
 * Must run BEFORE electron-builder packages the app.
 */
const { rebuild } = require('@electron/rebuild');
const path = require('path');

const electronVersion = require('electron/package.json').version;

async function main() {
  console.log(`Rebuilding native addon for Electron ${electronVersion}...`);

  await rebuild({
    buildPath: path.join(__dirname, '..'),
    electronVersion,
    arch: process.arch,
    onlyModules: [], // rebuild all native modules
    force: true,
  });

  console.log('Native addon rebuilt successfully for Electron ABI.');
}

main().catch((err) => {
  console.error('Rebuild failed:', err);
  process.exit(1);
});
