#!/usr/bin/env node
/**
 * Generate DMG background PNG from SVG source.
 * Run: node scripts/generate-dmg-background.js
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
  const svgPath = path.join(assetsDir, 'dmg-background.svg');

  if (!fs.existsSync(svgPath)) {
    console.error(`Missing: ${svgPath}`);
    process.exit(1);
  }

  const svg = fs.readFileSync(svgPath);

  // Standard DMG background: 480x300 @2x for Retina = 960x600
  await sharp(svg)
    .resize(960, 600)
    .png()
    .toFile(path.join(assetsDir, 'dmg-background@2x.png'));
  console.log('Created dmg-background@2x.png (960x600, Retina)');

  // @1x fallback
  await sharp(svg)
    .resize(480, 300)
    .png()
    .toFile(path.join(assetsDir, 'dmg-background.png'));
  console.log('Created dmg-background.png (480x300)');

  console.log('\nDone! DMG background images generated.');
}

generate().catch(console.error);
