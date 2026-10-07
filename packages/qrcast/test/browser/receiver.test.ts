import { afterEach, expect, test } from 'vitest';
import { cimbar, type CimbarOptions } from '../../src/codecs/cimbar/index.js';
import { createReceiver, type Receiver, type ReceiverEvents } from '../../src/receiver/index.js';
import { createSender, type Sender } from '../../src/sender/index.js';
import { firstDifference, randomBytes, rejection } from '../helpers.js';

const abortWorkerUrl = new URL('./fixtures/abort-worker.js', import.meta.url);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A sender whose canvas is filmed by the receiver's video element. */
async function loopback(send: CimbarOptions = {}, receive: CimbarOptions = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.width = '520px';
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  document.body.append(canvas, video);
  const sender: Sender = createSender({ codec: cimbar(send), canvas });
  const receiver: Receiver = createReceiver({ codecs: [cimbar(receive)], video });
  video.srcObject = canvas.captureStream();
  void video.play();
  const locks: string[] = [];
  const progress: number[] = [];
  receiver.on('lock', ({ codec }) => locks.push(codec));
  receiver.on('progress', (event: ReceiverEvents['progress']) => progress.push(event.progress));
  cleanups.push(() => {
    receiver.destroy();
    sender.destroy();
    canvas.remove();
    video.remove();
  });
  return { sender, receiver, locks, progress };
}

test('a 200 KB loopback transfer arrives byte for byte', async () => {
  const { sender, receiver, locks, progress } = await loopback();
  const body = randomBytes(200_000, 11);
  const states: string[] = [];
  receiver.on('state', ({ state }) => states.push(state));
  const result = receiver.start();
  await sender.start(body, { type: 'application/octet-stream', name: 'random.bin' });
  const received = await result;
  expect(received.kind).toBe('qrcast');
  expect(firstDifference(received.bytes, body)).toBe(-1);
  if (received.kind === 'qrcast') {
    expect(received.meta).toEqual({ size: 200_000, type: 'application/octet-stream', name: 'random.bin' });
  }
  expect(locks).toEqual(['cimbar']);
  expect(progress.length).toBeGreaterThan(0);
  expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true);
  expect(states).toEqual(['loading', 'detecting', 'receiving', 'idle']);
});

test('an automatic receiver detects a 4C sender', async () => {
  const { sender, receiver } = await loopback({ mode: '4C' });
  const body = randomBytes(50_000, 12);
  const result = receiver.start();
  await sender.start(body);
  expect(firstDifference((await result).bytes, body)).toBe(-1);
});

test('a receiver fixed to mode B never locks onto a 4C sender', async () => {
  const { sender, receiver, locks } = await loopback({ mode: '4C' }, { mode: 'B' });
  const result = receiver.start();
  result.catch(() => {});
  await sender.start(randomBytes(50_000, 13));
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  expect(locks).toEqual([]);
  expect(receiver.state).toBe('detecting');
  receiver.stop();
  expect(await rejection(result)).toMatchObject({ code: 'cancelled' });
});

test('two transfers in a row both arrive', async () => {
  const { sender, receiver } = await loopback();
  const first = randomBytes(30_000, 14);
  let result = receiver.start();
  await sender.start(first);
  expect(firstDifference((await result).bytes, first)).toBe(-1);
  const second = randomBytes(40_000, 15);
  await sender.start(second);
  result = receiver.start();
  expect(firstDifference((await result).bytes, second)).toBe(-1);
});

test('a decoder abort rejects with codec-aborted and the last progress', async () => {
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  canvas.getContext('2d')!.fillRect(0, 0, 10, 10);
  video.muted = true;
  video.srcObject = canvas.captureStream();
  void video.play();
  const receiver = createReceiver({
    codecs: [cimbar({ workerFactory: () => new Worker(abortWorkerUrl) })],
    video,
  });
  cleanups.push(() => receiver.destroy());
  const draw = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 10, 10), 30);
  cleanups.push(() => clearInterval(draw));
  const error = await rejection(receiver.start());
  expect(error).toMatchObject({
    code: 'codec-aborted',
    details: { codec: 'cimbar', role: 'receiver', progress: 0.4 },
  });
  expect(receiver.state).toBe('idle');
});

test('preload, then start begins detecting without loading again', async () => {
  const { sender, receiver } = await loopback();
  await receiver.preload();
  const states: string[] = [];
  receiver.on('state', ({ state }) => states.push(state));
  const body = randomBytes(10_000, 16);
  const result = receiver.start();
  await sender.start(body);
  expect(firstDifference((await result).bytes, body)).toBe(-1);
  expect(states[0]).toBe('detecting');
});
