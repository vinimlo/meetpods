import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'src/extension');
const out = resolve(root, 'dist/extension');

// Bundle each entry point as a self-contained IIFE
await esbuild.build({
  entryPoints: [
    resolve(src, 'background.ts'),
    resolve(src, 'content.ts'),
    resolve(src, 'popup.ts'),
  ],
  bundle: true,
  format: 'iife',
  outdir: out,
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
});

// Copy static assets
mkdirSync(resolve(out, 'icons'), { recursive: true });
cpSync(resolve(src, 'manifest.json'), resolve(out, 'manifest.json'));
cpSync(resolve(src, 'popup.html'), resolve(out, 'popup.html'));
cpSync(resolve(src, 'icons'), resolve(out, 'icons'), { recursive: true });

console.log('Static assets copied to dist/extension/');
