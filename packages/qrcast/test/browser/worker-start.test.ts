// Workers start one at a time: WebKit lets only the first of several workers
// created together use the page's service worker (issue #7).
import { afterEach, expect, test } from 'vitest';
import { cimbar } from '../../src/codecs/cimbar/index.js';
import { qr } from '../../src/codecs/qr/index.js';
import { createReceiver } from '../../src/receiver/index.js';
import { createSender } from '../../src/sender/index.js';
import { firstDifference, randomBytes, rejection } from '../helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

interface Created {
  url: string;
  /** Whether every worker created before this one had answered by then. */
  earlierAnswered: boolean;
  answered: boolean;
  terminated: boolean;
}

/** A factory that creates real workers and records their lifecycle in `log`. */
function recordingFactory(log: Created[]) {
  return (url: URL) => {
    const worker = new Worker(url);
    const entry: Created = {
      url: url.pathname,
      earlierAnswered: log.every(({ answered }) => answered),
      answered: false,
      terminated: false,
    };
    log.push(entry);
    const answer = () => {
      entry.answered = true;
    };
    worker.addEventListener('message', answer, { once: true });
    worker.addEventListener('error', answer, { once: true });
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      entry.terminated = true;
      terminate();
    };
    return worker;
  };
}

/** A stand-in that forwards only the members qrcast documents for `workerFactory`. */
function wrapperFactory(url: URL): Worker {
  const worker = new Worker(url);
  const wrapper = {
    get onmessage() {
      return worker.onmessage;
    },
    set onmessage(handler) {
      worker.onmessage = handler;
    },
    get onerror() {
      return worker.onerror;
    },
    set onerror(handler) {
      worker.onerror = handler;
    },
    get onmessageerror() {
      return worker.onmessageerror;
    },
    set onmessageerror(handler) {
      worker.onmessageerror = handler;
    },
    postMessage: (message: unknown, transfer: Transferable[]) => worker.postMessage(message, transfer),
    terminate: () => worker.terminate(),
  };
  return wrapper as unknown as Worker;
}

function receiverFor(codecs: Parameters<typeof createReceiver>[0]['codecs']) {
  const receiver = createReceiver({ codecs, video: document.createElement('video') });
  cleanups.push(() => receiver.destroy());
  return receiver;
}

test('a [cimbar(), qr()] receiver creates each worker after the earlier ones answered', async () => {
  const log: Created[] = [];
  const factory = recordingFactory(log);
  const receiver = receiverFor([cimbar({ workerFactory: factory }), qr({ workerFactory: factory })]);
  const started = performance.now();
  await receiver.preload();
  console.log(`preload of ${log.length} workers took ${Math.round(performance.now() - started)} ms`);
  // Up to three extract workers and one assembler for cimbar, one for QR.
  expect(log.length).toBeGreaterThanOrEqual(3);
  expect(log.filter(({ url }) => url.includes('qr-worker'))).toHaveLength(1);
  expect(log.every(({ earlierAnswered }) => earlierAnswered)).toBe(true);
  expect(log.every(({ answered }) => answered)).toBe(true);
});

test('when the first cimbar worker fails, no other worker is created', async () => {
  const log: Created[] = [];
  const receiver = receiverFor([
    cimbar({ wasmUrl: '/does-not-exist.wasm', workerFactory: recordingFactory(log) }),
  ]);
  expect(await rejection(receiver.preload())).toMatchObject({
    code: 'codec-init-failed',
    details: { codec: 'cimbar' },
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(log).toHaveLength(1);
  expect(log[0]!.terminated).toBe(true);
});

test('stopping a receiver while its workers start creates no more and ends the created ones', async () => {
  const log: Created[] = [];
  const record = recordingFactory(log);
  // Stops as soon as the first worker exists, before it can answer.
  const factory = (url: URL) => {
    const worker = record(url);
    if (log.length === 1) queueMicrotask(() => receiver.stop());
    return worker;
  };
  const receiver = receiverFor([cimbar({ workerFactory: factory }), qr({ workerFactory: factory })]);
  expect(await rejection(receiver.preload())).toMatchObject({ code: 'cancelled' });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(log).toHaveLength(1);
  expect(log[0]!.terminated).toBe(true);
});

test('a workerFactory may return a wrapper with only the documented members', async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '520px';
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  document.body.append(canvas, video);
  const sender = createSender({ codec: cimbar({ workerFactory: wrapperFactory }), canvas });
  const receiver = createReceiver({ codecs: [cimbar({ workerFactory: wrapperFactory })], video });
  cleanups.push(() => {
    receiver.destroy();
    sender.destroy();
    canvas.remove();
    video.remove();
  });
  video.srcObject = canvas.captureStream();
  void video.play();
  const body = randomBytes(30_000, 41);
  const result = receiver.start();
  await sender.start(body);
  expect(firstDifference((await result).bytes, body)).toBe(-1);
});
