#!/usr/bin/env node
/**
 * Generate an animated GIF from the extension popup screenshots.
 * Uses sharp (already in devDependencies).
 *
 * Usage: node scripts/generate-demo-gif.js
 * Output: screenshots/demo.gif
 */

const sharp = require('sharp');
const path = require('path');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');
const OUTPUT = path.join(SCREENSHOTS_DIR, 'demo.gif');

// Frame order and timing (ms per frame)
const frames = [
  { file: '01-popup-disconnected.png', delay: 1800 },
  { file: '02-popup-connected-muted.png', delay: 2200 },
  { file: '03-popup-connected-unmuted.png', delay: 2200 },
];

async function main() {
  // Read all frames and resize to consistent width
  const images = [];
  for (const frame of frames) {
    const buf = await sharp(path.join(SCREENSHOTS_DIR, frame.file))
      .resize(440, null, { withoutEnlargement: true })
      .png()
      .toBuffer();
    images.push({ buf, delay: frame.delay });
  }

  const firstMeta = await sharp(images[0].buf).metadata();
  const { width, height } = firstMeta;

  // Convert each frame to raw RGBA at consistent dimensions
  const rawFrames = [];
  for (const img of images) {
    const raw = await sharp(img.buf)
      .resize(width, height, { fit: 'contain', background: { r: 15, g: 18, b: 31, alpha: 255 } })
      .ensureAlpha()
      .raw()
      .toBuffer();
    rawFrames.push(raw);
  }

  // Stack frames vertically into one tall raw buffer
  const totalRaw = Buffer.concat(rawFrames);
  const delays = images.map((img) => img.delay);

  // Key: pageHeight tells sharp each frame's height so it creates animation pages
  await sharp(totalRaw, {
    raw: {
      width,
      height: height * images.length,
      channels: 4,
      pageHeight: height,
    },
  })
    .gif({
      delay: delays,
      loop: 0,
    })
    .toFile(OUTPUT);

  const stats = require('fs').statSync(OUTPUT);

  // Verify it's actually animated
  const meta = await sharp(OUTPUT).metadata();
  console.log(
    `✓ ${OUTPUT} (${(stats.size / 1024).toFixed(0)} KB, ${meta.pages} frames, ${width}×${height})`
  );
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
