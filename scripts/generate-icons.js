#!/usr/bin/env node
/**
 * Generate PNG tray icons from SVG sources.
 * Run: node scripts/generate-icons.js
 * Requires: sharp (npm install -D sharp)
 *
 * Generates both @1x (16x16) and @2x (32x32) for Retina displays.
 * macOS Electron picks up @2x automatically when named: tray-icon@2x.png
 */

const fs = require('fs');
const path = require('path');

async function generate() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('sharp not installed. Run: npm install -D sharp');
    process.exit(1);
  }

  const assetsDir = path.join(__dirname, '..', 'assets');
  const icons = ['tray-icon', 'tray-icon-active', 'tray-icon-muted'];

  for (const name of icons) {
    const svgPath = path.join(assetsDir, `${name}.svg`);
    const svg = fs.readFileSync(svgPath);

    // @1x (16x16)
    await sharp(svg).resize(16, 16).png().toFile(path.join(assetsDir, `${name}.png`));
    console.log(`  Created ${name}.png (16x16)`);

    // @2x (32x32) for Retina
    await sharp(svg).resize(32, 32).png().toFile(path.join(assetsDir, `${name}@2x.png`));
    console.log(`  Created ${name}@2x.png (32x32)`);
  }

  console.log('\nDone! All tray icons generated.');
}

generate().catch(console.error);
