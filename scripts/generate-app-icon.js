#!/usr/bin/env node
/**
 * Generate app icon PNG (1024x1024) from SVG source.
 * electron-builder converts PNG → .icns automatically.
 * Run: node scripts/generate-app-icon.js
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
  const svgPath = path.join(assetsDir, 'app-icon.svg');

  if (!fs.existsSync(svgPath)) {
    console.error(`Missing: ${svgPath}`);
    console.error('Create assets/app-icon.svg first (1024x1024 viewBox recommended).');
    process.exit(1);
  }

  const svg = fs.readFileSync(svgPath);

  // 1024x1024 PNG — electron-builder converts this to .icns
  await sharp(svg)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'icon.png'));
  console.log('Created icon.png (1024x1024)');

  console.log('\nDone! electron-builder will convert icon.png → icon.icns at build time.');
}

generate().catch(console.error);
