import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, test } from 'vitest';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
// A variable specifier keeps type checking independent of a stale dist/.
const packageName: string = 'qrcast';

beforeAll(() => {
  // Build so the test checks what consumers get through the exports map.
  execFileSync('pnpm', ['run', 'build'], { cwd: packageDir, stdio: 'pipe' });
}, 60_000);

test('the package root exports only QrcastError at runtime', async () => {
  const root: Record<string, unknown> = await import(/* @vite-ignore */ packageName);
  expect(Object.keys(root).sort()).toEqual(['QrcastError']);
});

test('the built QrcastError works', async () => {
  const { QrcastError } = await import(/* @vite-ignore */ packageName);
  const error = new QrcastError('invalid-input', { reason: 'body' }, 'x');
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('QrcastError');
});
