// Copies the files the codecs load at run time next to their emitted
// JavaScript, where their `new URL('./…', import.meta.url)` references point.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codecAssets } from './assets.mjs';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
for (const [codec, files] of Object.entries(codecAssets)) {
  const target = `${packageDir}dist/codecs/${codec}/`;
  mkdirSync(target, { recursive: true });
  for (const [from, to] of files) copyFileSync(`${packageDir}${from}`, `${target}${to}`);
}

// npm packs a package's own README and LICENSE only from the package directory,
// so copy them from the repository root (the copies are not tracked).
for (const file of ['README.md', 'LICENSE']) copyFileSync(`${packageDir}../../${file}`, `${packageDir}${file}`);
