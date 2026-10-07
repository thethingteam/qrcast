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
