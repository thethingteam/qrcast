import { afterEach, expect, test } from 'vitest';
import { qr } from '../../src/codecs/qr/index.js';
import { createSender } from '../../src/sender/index.js';
import { randomBytes } from '../helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function senderFor(options?: Parameters<typeof qr>[0]) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const sender = createSender({ codec: qr(options), canvas });
  cleanups.push(() => {
    sender.destroy();
    canvas.remove();
  });
  return { sender, canvas };
}

test('draws a square first frame of at most 1024 pixels that keeps its size', async () => {
  const { sender, canvas } = senderFor();
  await sender.start(randomBytes(20_000, 1));
  expect(sender.state).toBe('playing');
  const { width, height } = canvas;
  expect(width).toBe(height);
  expect(width).toBeLessThanOrEqual(1024);
  expect(width).toBeGreaterThan(200);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  expect(canvas.width).toBe(width);
  expect(canvas.height).toBe(height);
});

test('the frame size is stable in color too', async () => {
  const { sender, canvas } = senderFor({ layers: 3 });
  await sender.start(randomBytes(20_000, 2));
  const { width } = canvas;
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(canvas.width).toBe(width);
});

test('emits frame events at about 15 fps', async () => {
  const { sender } = senderFor();
  const frames: number[] = [];
  sender.on('frame', ({ frame }) => frames.push(frame));
  await sender.start(randomBytes(200_000, 3));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  expect(frames.length).toBeGreaterThanOrEqual(24);
  expect(frames.length).toBeLessThanOrEqual(32);
});

test('sends without WebAssembly and requests no asset', async () => {
  const { sender, canvas } = senderFor();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'WebAssembly')!;
  const before = performance.getEntriesByType('resource').length;
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
  try {
    await sender.start(randomBytes(5_000, 4));
    expect(sender.state).toBe('playing');
    expect(canvas.width).toBeGreaterThan(0);
  } finally {
    Object.defineProperty(globalThis, 'WebAssembly', original);
  }
  const requested = performance
    .getEntriesByType('resource')
    .slice(before)
    .map((entry) => entry.name)
    .filter((name) => /zxing|qr-worker|\.wasm/.test(name));
  expect(requested).toEqual([]);
});
