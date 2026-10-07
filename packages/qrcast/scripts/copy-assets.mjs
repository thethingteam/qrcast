// Copies the files the codecs load at run time next to their emitted
// JavaScript, where their `new URL('./…', import.meta.url)` references point.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const codecs = {
  cimbar: [
    ['vendor/cimbar/cimbar_js.2026-08-21T2336.js', 'cimbar_js.2026-08-21T2336.js'],
    ['vendor/cimbar/cimbar_js.2026-08-21T2336.wasm', 'cimbar_js.2026-08-21T2336.wasm'],
    ['vendor/cimbar/LICENSE', 'LICENSE'],
    ['src/codecs/cimbar/cimbar-worker.js', 'cimbar-worker.js'],
  ],
  qr: [
    ['vendor/zxing-wasm/zxing_reader.js', 'zxing_reader.js'],
    ['vendor/zxing-wasm/zxing_reader.wasm', 'zxing_reader.wasm'],
    ['vendor/zxing-wasm/LICENSE', 'LICENSE'],
    ['vendor/zxing-wasm/LICENSE.zxing-cpp', 'LICENSE.zxing-cpp'],
    ['src/codecs/qr/qr-worker.js', 'qr-worker.js'],
  ],
};

for (const [codec, files] of Object.entries(codecs)) {
  const target = `${packageDir}dist/codecs/${codec}/`;
  mkdirSync(target, { recursive: true });
  for (const [from, to] of files) copyFileSync(`${packageDir}${from}`, `${target}${to}`);
}
