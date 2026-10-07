import { afterEach, expect, test } from 'vitest';
import { cimbar } from '../../src/codecs/cimbar/index.js';
import { qr, type QrOptions } from '../../src/codecs/qr/index.js';
import type { QrcastCodec } from '../../src/internal/codec.js';
import { createReceiver, type Receiver } from '../../src/receiver/index.js';
import { createSender, type Sender } from '../../src/sender/index.js';
import { firstDifference, randomBytes, rejection } from '../helpers.js';

const abortWorkerUrl = new URL('./fixtures/qr-abort-worker.js', import.meta.url);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

interface Loopback {
  sender: Sender;
  receiver: Receiver;
  canvas: HTMLCanvasElement;
  locks: string[];
  progress: number[];
}

/** A sender whose canvas is filmed by the receiver's video element. */
function loopback(sendCodec: QrcastCodec = qr(), receiveCodecs: QrcastCodec[] = [qr()]): Loopback {
  const canvas = document.createElement('canvas');
  canvas.style.width = '520px';
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  document.body.append(canvas, video);
  const sender = createSender({ codec: sendCodec, canvas });
  const receiver = createReceiver({ codecs: receiveCodecs, video });
  video.srcObject = canvas.captureStream();
  video.play().catch(() => {});
  const locks: string[] = [];
  const progress: number[] = [];
  receiver.on('lock', ({ codec }) => locks.push(codec));
  receiver.on('progress', (event) => progress.push(event.progress));
  cleanups.push(() => {
    receiver.destroy();
    sender.destroy();
    canvas.remove();
    video.remove();
  });
  return { sender, receiver, canvas, locks, progress };
}

/** A receiver that films a canvas the test draws on. */
function filmedCanvas(codecs: QrcastCodec[]) {
  const canvas = document.createElement('canvas');
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = canvas.captureStream();
  video.play().catch(() => {});
  const receiver = createReceiver({ codecs, video });
  const locks: string[] = [];
  receiver.on('lock', ({ codec }) => locks.push(codec));
  cleanups.push(() => {
    receiver.destroy();
    video.remove();
  });
  return { canvas, receiver, locks };
}

test.each([
  ['black and white', { layers: 1 as const }],
  ['color', { layers: 3 as const }],
])('a 20 KB %s loopback transfer arrives byte for byte', async (_label, options: QrOptions) => {
  const { sender, receiver, locks, progress } = loopback(qr(options));
  const body = randomBytes(20_000, 21);
  const result = receiver.start();
  await sender.start(body);
  expect(firstDifference((await result).bytes, body)).toBe(-1);
  expect(locks).toEqual(['qr']);
  expect(progress.length).toBeGreaterThan(0);
  expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true);
});

test('a missing wasm rejects with codec-init-failed for qr', async () => {
  const { receiver } = loopback(qr(), [qr({ wasmUrl: '/does-not-exist.wasm' })]);
  expect(await rejection(receiver.start())).toMatchObject({ code: 'codec-init-failed', details: { codec: 'qr' } });
});

test('a decoder abort rejects with codec-aborted and the last progress', async () => {
  const { canvas, receiver } = filmedCanvas([qr({ workerFactory: () => new Worker(abortWorkerUrl) })]);
  const draw = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 10, 10), 30);
  cleanups.push(() => clearInterval(draw));
  const error = await rejection(receiver.start());
  expect(error).toMatchObject({
    code: 'codec-aborted',
    details: { codec: 'qr', role: 'receiver', progress: 0.25 },
  });
  expect(receiver.state).toBe('idle');
});

test('every worker the factory created has ended once the transfer completes', async () => {
  const created: Worker[] = [];
  const terminated = new Set<Worker>();
  const factory = (url: URL) => {
    const worker = new Worker(url);
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      terminated.add(worker);
      terminate();
    };
    created.push(worker);
    return worker;
  };
  const { sender, receiver } = loopback(qr(), [qr({ workerFactory: factory })]);
  const body = randomBytes(5_000, 22);
  const result = receiver.start();
  await sender.start(body);
  await result;
  expect(created.length).toBeGreaterThan(0);
  expect(created.every((worker) => terminated.has(worker))).toBe(true);
});

test('a QR code of a URL does not lock a [cimbar(), qr()] receiver', async () => {
  const { canvas, receiver, locks } = filmedCanvas([cimbar(), qr()]);
  // A real QR code of a URL, drawn with the same generator the sender uses.
  const { QrCode, Ecc, QrSegment } = await import('../../src/codecs/qr/qrcodegen.js');
  const symbol = QrCode.encodeSegments([QrSegment.makeAlphanumeric('HTTPS://EXAMPLE.COM/')], Ecc.LOW);
  const scale = 12;
  const side = (symbol.size + 8) * scale;
  canvas.width = canvas.height = side;
  const context = canvas.getContext('2d')!;
  const paint = () => {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, side, side);
    context.fillStyle = '#000';
    for (let y = 0; y < symbol.size; y++)
      for (let x = 0; x < symbol.size; x++)
        if (symbol.getModule(x, y)) context.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
  };
  paint();
  const draw = setInterval(paint, 30);
  cleanups.push(() => clearInterval(draw));
  const result = receiver.start();
  result.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  expect(locks).toEqual([]);
  expect(receiver.state).toBe('detecting');
  receiver.stop();
  expect(await rejection(result)).toMatchObject({ code: 'cancelled' });
});

test('a sender restarting from body A to body B completes with B', async () => {
  const { sender, receiver, progress } = loopback();
  const a = randomBytes(300_000, 23);
  const b = randomBytes(10_000, 24);
  const result = receiver.start();
  await sender.start(a);
  while (progress.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  await sender.start(b);
  expect(firstDifference((await result).bytes, b)).toBe(-1);
}, 120_000);

test('[cimbar(), qr()] locks to qr for a QR sender', async () => {
  const { sender, receiver, locks } = loopback(qr(), [cimbar(), qr()]);
  const body = randomBytes(10_000, 25);
  const result = receiver.start();
  await sender.start(body);
  expect(firstDifference((await result).bytes, body)).toBe(-1);
  expect(locks).toEqual(['qr']);
});

test('[cimbar(), qr()] locks to cimbar for a cimbar sender', async () => {
  const { sender, receiver, locks } = loopback(cimbar(), [cimbar(), qr()]);
  const body = randomBytes(20_000, 26);
  const result = receiver.start();
  await sender.start(body);
  expect(firstDifference((await result).bytes, body)).toBe(-1);
  expect(locks).toEqual(['cimbar']);
});

/**
 * A worker factory that wraps the real worker in a script which reports every
 * URL the worker fetches or imports on a BroadcastChannel. Requests made by a
 * worker are not in the page's resource timing, and the worker ends with the
 * transfer, so it cannot be asked afterwards.
 */
function recordingFactory() {
  const urls: string[] = [];
  const channel = new BroadcastChannel('qr-worker-requests');
  channel.onmessage = (event) => urls.push(String(event.data));
  cleanups.push(() => channel.close());
  const factory = (url: URL) => {
    const source = `
      const channel = new BroadcastChannel('qr-worker-requests');
      const record = (target) => channel.postMessage(String(target));
      const fetchOriginal = self.fetch;
      self.fetch = (input, ...rest) => {
        record(input instanceof Request ? input.url : input);
        return fetchOriginal.call(self, input, ...rest);
      };
      const importOriginal = self.importScripts;
      self.importScripts = (...list) => {
        list.forEach(record);
        return importOriginal.apply(self, list);
      };
      const openOriginal = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, target, ...rest) {
        record(target);
        return openOriginal.call(this, method, target, ...rest);
      };
      importScripts(${JSON.stringify(url.href)});
    `;
    return new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  };
  return { factory, urls };
}

test('a transfer with the default options requests no other origin and no CDN', async () => {
  const recording = recordingFactory();
  const before = performance.getEntriesByType('resource').length;
  const { sender, receiver } = loopback(qr(), [qr({ workerFactory: recording.factory })]);
  const result = receiver.start();
  await sender.start(randomBytes(5_000, 27));
  await result;
  await new Promise((resolve) => setTimeout(resolve, 100));
  const pageRequests = performance
    .getEntriesByType('resource')
    .slice(before)
    .map((entry) => entry.name);
  // The worker did load zxing from the package's files.
  expect(recording.urls.some((name) => name.endsWith('/zxing_reader.js'))).toBe(true);
  expect(recording.urls.some((name) => name.endsWith('/zxing_reader.wasm'))).toBe(true);
  for (const name of [...pageRequests, ...recording.urls]) {
    expect(new URL(name, location.href).origin).toBe(location.origin);
    expect(name).not.toContain('cdn.jsdelivr.net');
  }
});

test('receiving without WebAssembly rejects with unsupported-environment', async () => {
  const { receiver } = loopback();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'WebAssembly')!;
  delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
  try {
    expect(await rejection(receiver.start())).toMatchObject({
      code: 'unsupported-environment',
      details: { feature: 'webassembly' },
    });
  } finally {
    Object.defineProperty(globalThis, 'WebAssembly', original);
  }
});

