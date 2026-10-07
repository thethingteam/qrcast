import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';

const vendorDir = fileURLToPath(new URL('../vendor/cimbar/', import.meta.url));

/** Digests of the same files in libcimbar v0.6.8 `cimbar.wasm.tar.gz`. */
const RELEASE_DIGESTS: Record<string, string> = {
  'cimbar_js.2026-08-21T2336.js': 'c18d4c47ffd9ad4bf6c5e6c9fb1e8a8aabf52eadf5dfa70844b904b1c67d5418',
  'cimbar_js.2026-08-21T2336.wasm': '019a0d79419bdee0b918f409cdcfff919c172b75131dac5a36a44385151ca5af',
};

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function mismatches(dir: string): string[] {
  return Object.entries(RELEASE_DIGESTS)
    .filter(([file, digest]) => sha256(join(dir, file)) !== digest)
    .map(([file]) => file);
}

const scratch = mkdtempSync(join(tmpdir(), 'qrcast-vendor-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test('the vendored glue and wasm match the libcimbar v0.6.8 release', () => {
  expect(mismatches(vendorDir)).toEqual([]);
});

test('the check notices a changed byte', () => {
  for (const file of Object.keys(RELEASE_DIGESTS)) copyFileSync(join(vendorDir, file), join(scratch, file));
  const wasm = join(scratch, 'cimbar_js.2026-08-21T2336.wasm');
  const bytes = readFileSync(wasm);
  bytes[1000] = bytes[1000]! ^ 0xff;
  writeFileSync(wasm, bytes);
  expect(mismatches(scratch)).toEqual(['cimbar_js.2026-08-21T2336.wasm']);
});

const zxingDir = fileURLToPath(new URL('../vendor/zxing-wasm/', import.meta.url));
const zxingPackageDir = fileURLToPath(new URL('../node_modules/zxing-wasm/', import.meta.url));

/** Vendored name -> [path in the zxing-wasm 3.1.4 npm package, sha256]. */
const ZXING_FILES: Record<string, [string, string]> = {
  'zxing_reader.js': ['dist/iife/reader/index.js', 'd33d09ce132a692faffbed0dce656c36cb2573b4b843885a6e036390d1071d95'],
  'zxing_reader.wasm': ['dist/reader/zxing_reader.wasm', 'e8af31edb56d0522f4de74495839385ef019ba8bc90d38e5ecb2f18795d86fb2'],
  LICENSE: ['LICENSE', 'fb506e4ade12d7a9efa67c9d76a9a28c8e15d347ca49a69e48e29b40b34ad2ab'],
};

function zxingMismatches(dir: string): string[] {
  return Object.entries(ZXING_FILES)
    .filter(([file, [source, digest]]) => {
      const bytes = readFileSync(join(dir, file));
      return (
        createHash('sha256').update(bytes).digest('hex') !== digest ||
        !bytes.equals(readFileSync(join(zxingPackageDir, source)))
      );
    })
    .map(([file]) => file);
}

test('the vendored zxing-wasm files match the 3.1.4 npm package and the README digests', () => {
  expect(zxingMismatches(zxingDir)).toEqual([]);
  const readme = readFileSync(join(zxingDir, 'README.md'), 'utf8');
  for (const [, digest] of Object.values(ZXING_FILES)) expect(readme).toContain(digest);
  expect(readme).toContain('c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08');
});

test('the zxing check notices a changed byte', () => {
  const copy = mkdtempSync(join(scratch, 'zxing-'));
  for (const file of Object.keys(ZXING_FILES)) copyFileSync(join(zxingDir, file), join(copy, file));
  const wasm = join(copy, 'zxing_reader.wasm');
  const bytes = readFileSync(wasm);
  bytes[1000] = bytes[1000]! ^ 0xff;
  writeFileSync(wasm, bytes);
  expect(zxingMismatches(copy)).toEqual(['zxing_reader.wasm']);
});
