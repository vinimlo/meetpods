#!/usr/bin/env node
/**
 * Generate Chrome Extension PNG icons from SVG source.
 * Run: node scripts/generate-extension-icons.js
 */

const fs = require('fs');
const path = require('path');

async function generate() {
  const sharp = require('sharp');
  const iconsDir = path.join(__dirname, '..', 'src', 'extension', 'icons');
  const svgPath = path.join(iconsDir, 'icon.svg');
  const svg = fs.readFileSync(svgPath);

  const sizes = [16, 48, 128];

  for (const size of sizes) {
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon${size}.png`));
    console.log(`  Created icon${size}.png`);
  }

  console.log('\nDone!');
}

generate().catch(console.error);
