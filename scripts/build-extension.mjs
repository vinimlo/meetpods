import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'src/extension');
const out = resolve(root, 'dist/extension');

// Bundle each entry point as a self-contained IIFE
await esbuild.build({
  entryPoints: [resolve(src, 'background.ts'), resolve(src, 'content.ts'), resolve(src, 'popup.ts')],
  bundle: true,
  format: 'iife',
  outdir: out,
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
});

// Copy static assets (inject version from package.json into manifest)
mkdirSync(resolve(out, 'icons'), { recursive: true });

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(src, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

cpSync(resolve(src, 'popup.html'), resolve(out, 'popup.html'));
cpSync(resolve(src, 'icons'), resolve(out, 'icons'), { recursive: true });

console.log(`Static assets copied to dist/extension/ (version ${pkg.version})`);
