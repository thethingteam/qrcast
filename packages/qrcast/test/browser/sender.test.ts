import { afterEach, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cimbar } from '../../src/codecs/cimbar/index.js';
import { prepareTransfer } from '../../src/codec.js';
import type { QrcastError } from '../../src/errors.js';
import { createSender, type Sender } from '../../src/sender/index.js';
import { randomBytes, rejection } from '../helpers.js';

const abortWorkerUrl = new URL('./fixtures/abort-worker.js', import.meta.url);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function senderFor(codec = cimbar()): { sender: Sender; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('style', 'width: 200px; height: 200px');
  document.body.append(canvas);
  const sender = createSender({ codec, canvas });
  cleanups.push(() => {
    sender.destroy();
    canvas.remove();
  });
  return { sender, canvas };
}

function isBlank(canvas: HTMLCanvasElement): boolean {
  const copy = new OffscreenCanvas(canvas.width, canvas.height);
  const context = copy.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  const data = context.getImageData(0, 0, copy.width, copy.height).data;
  return data.every((value) => value === data[0]);
}

test('the first frame sizes the canvas and leaves its style alone', async () => {
  const { sender, canvas } = senderFor();
  await sender.start(randomBytes(20_000, 1));
  expect(sender.state).toBe('playing');
  expect(canvas.width).toBe(1040);
  expect(canvas.height).toBe(1040);
  expect(canvas.getAttribute('style')).toBe('width: 200px; height: 200px');
  expect(isBlank(canvas)).toBe(false);
});

test('plays about 15 frames per second by default', async () => {
  const { sender } = senderFor();
  const counts: number[] = [];
  sender.on('frame', ({ frame }) => counts.push(frame));
  await sender.start(randomBytes(200_000, 2));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  expect(counts.length).toBeGreaterThanOrEqual(26);
  expect(counts.length).toBeLessThanOrEqual(32);
  expect(counts).toEqual(counts.map((_, i) => i + 1));
});

test('two 15 MiB starts back to back both resolve', async () => {
  const { sender } = senderFor();
  const size = 15 * 1024 * 1024;
  await sender.start(randomBytes(size, 3));
  await sender.start(randomBytes(size, 4));
  expect(sender.state).toBe('playing');
}, 180_000);

test('Backspace and Tab still work in a text field while playing', async () => {
  const { sender } = senderFor();
  const input = document.createElement('input');
  const next = document.createElement('button');
  document.body.append(input, next);
  cleanups.push(() => {
    input.remove();
    next.remove();
  });
  await sender.start(randomBytes(20_000, 5));
  await userEvent.click(input);
  await userEvent.keyboard('abc{Backspace}');
  expect(input.value).toBe('ab');
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(next);
});

test('an encoder abort emits codec-aborted with the envelope size', async () => {
  const codec = cimbar({ workerFactory: () => new Worker(abortWorkerUrl) });
  const { sender } = senderFor(codec);
  const errors: QrcastError[] = [];
  const failed = new Promise<void>((resolve) =>
    sender.on('error', ({ error }) => {
      errors.push(error);
      resolve();
    }),
  );
  const body = randomBytes(999_000, 6);
  const envelope = await prepareTransfer(body, {}, codec);
  await sender.start(body);
  await failed;
  expect(errors[0]).toMatchObject({
    code: 'codec-aborted',
    details: { codec: 'cimbar', role: 'sender', size: envelope.length },
  });
  expect(sender.state).toBe('idle');
});

test('a wasm that cannot be fetched fails with codec-init-failed', async () => {
  const { sender } = senderFor(cimbar({ wasmUrl: '/missing.wasm' }));
  const error = await rejection(sender.start(randomBytes(1000, 7)));
  expect(error).toMatchObject({ code: 'codec-init-failed', details: { codec: 'cimbar' } });
  expect(sender.state).toBe('idle');
});

test('a glue script that cannot be loaded fails with codec-init-failed', async () => {
  const { sender } = senderFor(cimbar({ glueUrl: '/missing.js' }));
  const error = await rejection(sender.start(randomBytes(1000, 8)));
  expect(error).toMatchObject({ code: 'codec-init-failed', details: { codec: 'cimbar' } });
});
