// Copies the files the cimbar codec loads at run time next to its emitted
// JavaScript, where its `new URL('./…', import.meta.url)` references point.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const target = `${packageDir}dist/codecs/cimbar/`;

const files = [
  ['vendor/cimbar/cimbar_js.2026-08-21T2336.js', 'cimbar_js.2026-08-21T2336.js'],
  ['vendor/cimbar/cimbar_js.2026-08-21T2336.wasm', 'cimbar_js.2026-08-21T2336.wasm'],
  ['vendor/cimbar/LICENSE', 'LICENSE'],
  ['src/codecs/cimbar/cimbar-worker.js', 'cimbar-worker.js'],
];

mkdirSync(target, { recursive: true });
for (const [from, to] of files) copyFileSync(`${packageDir}${from}`, `${target}${to}`);
