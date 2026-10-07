import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { wrapEnvelope } from '../src/envelope/envelope.js';
import { QrcastError } from '../src/errors.js';
import { resetEnvironmentCache } from '../src/internal/environment.js';
import { createReceiver, type ReceiveResult, type Receiver, type ReceiverEvents } from '../src/receiver/index.js';
import { deferred, FakeFrame, fakeCodec, fakeVideo, flush, type FakeCodecOptions } from './fakes.js';
import { rejection } from './helpers.js';

beforeEach(() => {
  vi.stubGlobal('VideoFrame', FakeFrame);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetEnvironmentCache();
});

function setup(options: { acceptRaw?: boolean; codecs?: FakeCodecOptions[] } = {}) {
  const fakes = (options.codecs ?? [{}]).map((codecOptions, i) =>
    fakeCodec({ name: `codec${i}`, ...codecOptions }),
  );
  const camera = fakeVideo();
  const receiver = createReceiver({
    codecs: fakes.map(({ codec }) => codec),
    video: camera.video,
    acceptRaw: options.acceptRaw,
  });
  const states: string[] = [];
  const locks: string[] = [];
  const progress: ReceiverEvents['progress'][] = [];
  receiver.on('state', ({ state }) => states.push(state));
  receiver.on('lock', ({ codec }) => locks.push(codec));
  receiver.on('progress', (event) => progress.push(event));
  return { fakes, camera, receiver, states, locks, progress };
}

/** Starts and waits until the receiver is detecting. */
async function started(receiver: Receiver): Promise<{ result: Promise<ReceiveResult> }> {
  const result = receiver.start();
  result.catch(() => {});
  await flush();
  expect(receiver.state).toBe('detecting');
  // Wrapped, so that awaiting this function does not wait for the transfer.
  return { result };
}

const envelope = (body: Uint8Array, hints = {}) => wrapEnvelope(body, hints);

describe('creating a receiver', () => {
  test('loads nothing and starts idle', () => {
    const { fakes, receiver } = setup();
    expect(receiver.state).toBe('idle');
    expect(fakes[0]!.receivers).toHaveLength(0);
  });

  test.each([
    ['no options', undefined],
    ['an empty codec list', { codecs: [], video: fakeVideo().video }],
    ['two codecs with the same name', { codecs: [fakeCodec().codec, fakeCodec().codec], video: fakeVideo().video }],
    ['a plain descriptor', { codecs: [{ name: 'x', maxPayloadSize: 1, compress: false }], video: fakeVideo().video }],
    ['no video', { codecs: [fakeCodec().codec] }],
    ['a non-boolean acceptRaw', { codecs: [fakeCodec().codec], video: fakeVideo().video, acceptRaw: 'yes' }],
  ])('throws invalid-input (option) for %s', (_label, options) => {
    expect(() => createReceiver(options as never)).toThrow(
      expect.objectContaining({ code: 'invalid-input', details: { reason: 'option' } }),
    );
  });
});

describe('receiving', () => {
  test('a qrcast transfer: states, lock, progress and the result', async () => {
    const { fakes, camera, receiver, states, locks, progress } = setup();
    const { result } = await started(receiver);
    const driver = fakes[0]!.receivers[0]!;
    camera.fire(10);
    expect(driver.pushed).toHaveLength(1);
    expect(driver.pushed[0]!.closed).toBe(true);
    driver.hooks.onData();
    driver.hooks.onProgress(0.5);
    driver.hooks.onFile(await envelope(new Uint8Array([1, 2, 3]), { type: 'text/plain', name: 'a.txt' }), 'qrcast.bin');
    expect(await result).toEqual({
      kind: 'qrcast',
      meta: { size: 3, type: 'text/plain', name: 'a.txt' },
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(states).toEqual(['loading', 'detecting', 'receiving', 'idle']);
    expect(locks).toEqual(['codec0']);
    expect(progress).toEqual([{ codec: 'codec0', progress: 0.5 }]);
    expect(driver.disposed).toBe(true);
    expect(receiver.state).toBe('idle');
  });

  test('keeps waiting while the video has no frame', async () => {
    const { fakes, camera, receiver } = setup();
    camera.state.readyState = 0;
    await started(receiver);
    camera.fire();
    camera.fire();
    expect(fakes[0]!.receivers[0]!.pushed).toHaveLength(0);
    expect(receiver.state).toBe('detecting');
    expect(camera.pending).toBe(1);
  });

  test('skips frames the decoder cannot take', async () => {
    const { fakes, camera, receiver } = setup();
    await started(receiver);
    const driver = fakes[0]!.receivers[0]!;
    driver.accepting = false;
    camera.fire();
    expect(driver.pushed).toHaveLength(0);
  });

  test('a second start while receiving is refused', async () => {
    const { receiver } = setup();
    const { result: first } = await started(receiver);
    expect(await rejection(receiver.start())).toMatchObject({
      code: 'invalid-state',
      details: { state: 'detecting' },
    });
    expect(receiver.state).toBe('detecting');
    receiver.stop();
    await rejection(first);
  });

  test('a codec that fails to load rejects start', async () => {
    const failure = new QrcastError('codec-init-failed', { codec: 'codec0' }, 'no wasm');
    const { receiver } = setup({
      codecs: [{ setupReceiver: (driver) => (driver.load = () => Promise.reject(failure)) }],
    });
    expect(await rejection(receiver.start())).toBe(failure);
    expect(receiver.state).toBe('idle');
  });

  test('a codec module that fails to import becomes codec-init-failed', async () => {
    const { receiver } = setup({ codecs: [{ failCreate: new TypeError('Failed to fetch') }] });
    expect(await rejection(receiver.start())).toMatchObject({
      code: 'codec-init-failed',
      details: { codec: 'codec0' },
    });
  });

  test('a missing browser feature rejects before loading', async () => {
    vi.stubGlobal('VideoFrame', undefined);
    const { fakes, receiver } = setup({ codecs: [{ receiveFeatures: ['video-frame'] }] });
    expect(await rejection(receiver.start())).toMatchObject({
      code: 'unsupported-environment',
      details: { feature: 'video-frame' },
    });
    expect(await rejection(receiver.preload())).toMatchObject({ code: 'unsupported-environment' });
    expect(fakes[0]!.receivers).toHaveLength(0);
  });

  test('never writes to the video element', async () => {
    const { fakes, camera, receiver } = setup();
    // The fake video is frozen: any write would throw inside the receiver.
    const { result } = await started(receiver);
    camera.fire();
    const driver = fakes[0]!.receivers[0]!;
    driver.hooks.onData();
    driver.hooks.onFile(await envelope(new Uint8Array(1)), '');
    await result;
    expect(Object.isFrozen(camera.video)).toBe(true);
  });
});

describe('codec detection', () => {
  test('frames alternate between codecs until one decodes, then go only to it', async () => {
    const { fakes, camera, receiver, locks } = setup({ codecs: [{}, {}] });
    await started(receiver);
    const [a, b] = [fakes[0]!.receivers[0]!, fakes[1]!.receivers[0]!];
    for (let i = 0; i < 4; i++) camera.fire(i);
    expect([a.pushed.length, b.pushed.length]).toEqual([2, 2]);
    b.hooks.onData();
    expect(locks).toEqual(['codec1']);
    expect(receiver.state).toBe('receiving');
    expect(a.disposed).toBe(true);
    for (let i = 0; i < 4; i++) camera.fire(i);
    expect([a.pushed.length, b.pushed.length]).toEqual([2, 6]);
    a.hooks.onData();
    expect(locks).toEqual(['codec1']);
    receiver.stop();
  });

  test('progress from a codec that is not locked is ignored', async () => {
    const { fakes, receiver, progress } = setup({ codecs: [{}, {}] });
    await started(receiver);
    fakes[0]!.receivers[0]!.hooks.onProgress(0.2);
    fakes[1]!.receivers[0]!.hooks.onData();
    fakes[0]!.receivers[0]!.hooks.onProgress(0.3);
    fakes[1]!.receivers[0]!.hooks.onProgress(0.4);
    expect(progress).toEqual([{ codec: 'codec1', progress: 0.4 }]);
    receiver.stop();
  });
});

describe('results', () => {
  async function receive(options: { acceptRaw?: boolean }, bytes: Uint8Array, name: string) {
    const { fakes, receiver } = setup(options);
    const { result } = await started(receiver);
    const driver = fakes[0]!.receivers[0]!;
    driver.hooks.onData();
    driver.hooks.onFile(bytes, name);
    return { result, receiver };
  }

  test('a raw file without acceptRaw fails with unsupported-format (magic)', async () => {
    const { result, receiver } = await receive({}, new TextEncoder().encode('hello'), 'photo.jpg');
    expect(await rejection(result)).toMatchObject({
      code: 'unsupported-format',
      details: { reason: 'magic' },
    });
    expect(receiver.state).toBe('idle');
  });

  test('a raw file with acceptRaw resolves with its name', async () => {
    const bytes = new TextEncoder().encode('hello');
    const { result } = await receive({ acceptRaw: true }, bytes, 'photo.jpg');
    expect(await result).toEqual({ kind: 'raw', name: 'photo.jpg', bytes });
  });

  test('a raw file without a name has the name ""', async () => {
    const { result } = await receive({ acceptRaw: true }, new Uint8Array([9]), '');
    expect(await result).toMatchObject({ kind: 'raw', name: '' });
  });

  test('an envelope error is passed on even with acceptRaw', async () => {
    const bad = await envelope(new Uint8Array(4));
    bad[6] = 0x02;
    const { result } = await receive({ acceptRaw: true }, bad, 'qrcast.bin');
    expect(await rejection(result)).toMatchObject({
      code: 'unsupported-format',
      details: { reason: 'version' },
    });
  });
});

describe('one transfer per start', () => {
  test('the next start uses fresh decoders', async () => {
    const { fakes, receiver } = setup();
    let { result } = await started(receiver);
    let driver = fakes[0]!.receivers[0]!;
    driver.hooks.onData();
    driver.hooks.onFile(await envelope(new Uint8Array([1])), '');
    await result;
    ({ result } = await started(receiver));
    expect(fakes[0]!.receivers).toHaveLength(2);
    driver = fakes[0]!.receivers[1]!;
    driver.hooks.onData();
    driver.hooks.onFile(await envelope(new Uint8Array([2])), '');
    expect(await result).toMatchObject({ bytes: new Uint8Array([2]) });
  });
});

describe('preloading', () => {
  test('start after preload uses the loaded decoders', async () => {
    const { fakes, receiver, states } = setup();
    await receiver.preload();
    expect(fakes[0]!.receivers).toHaveLength(1);
    expect(fakes[0]!.receivers[0]!.loaded).toBe(true);
    expect(receiver.state).toBe('idle');
    await started(receiver);
    expect(fakes[0]!.receivers).toHaveLength(1);
    expect(states).toEqual(['detecting']);
    receiver.stop();
  });

  test('preloading twice loads once', async () => {
    const { fakes, receiver } = setup();
    await Promise.all([receiver.preload(), receiver.preload()]);
    expect(fakes[0]!.receivers).toHaveLength(1);
  });

  test('a preload failure rejects with the codec error', async () => {
    const failure = new QrcastError('codec-init-failed', { codec: 'codec0' }, 'no wasm');
    const { receiver } = setup({
      codecs: [{ setupReceiver: (driver) => (driver.load = () => Promise.reject(failure)) }],
    });
    expect(await rejection(receiver.preload())).toBe(failure);
  });

  test('stop during a preload cancels it and releases the decoders', async () => {
    const gate = deferred();
    const { fakes, receiver } = setup({ codecs: [{ setupReceiver: (driver) => (driver.gate = gate) }] });
    const preload = receiver.preload();
    await flush();
    receiver.stop();
    gate.resolve();
    expect(await rejection(preload)).toMatchObject({ code: 'cancelled', details: { reason: 'stopped' } });
    expect(fakes[0]!.receivers[0]!.disposed).toBe(true);
  });

  test('a preloaded decoder that fails is replaced at the next start', async () => {
    const { fakes, receiver } = setup();
    await receiver.preload();
    fakes[0]!.receivers[0]!.hooks.onFailure(
      new QrcastError('codec-aborted', { codec: 'codec0', role: 'receiver', progress: null }, 'oom'),
    );
    expect(fakes[0]!.receivers[0]!.disposed).toBe(true);
    await started(receiver);
    expect(fakes[0]!.receivers).toHaveLength(2);
    receiver.stop();
  });
});

describe('stopping and destroying', () => {
  test('stop while receiving rejects start and returns to idle', async () => {
    const { fakes, camera, receiver } = setup();
    const { result } = await started(receiver);
    receiver.stop();
    expect(await rejection(result)).toMatchObject({ code: 'cancelled', details: { reason: 'stopped' } });
    expect(receiver.state).toBe('idle');
    expect(fakes[0]!.receivers[0]!.disposed).toBe(true);
    expect(camera.pending).toBe(0);
  });

  test('stop while loading rejects start', async () => {
    const gate = deferred();
    const { fakes, receiver } = setup({ codecs: [{ setupReceiver: (driver) => (driver.gate = gate) }] });
    const result = receiver.start();
    await flush();
    expect(receiver.state).toBe('loading');
    receiver.stop();
    gate.resolve();
    expect(await rejection(result)).toMatchObject({ code: 'cancelled', details: { reason: 'stopped' } });
    await flush();
    expect(receiver.state).toBe('idle');
    expect(fakes[0]!.receivers[0]!.disposed).toBe(true);
  });

  test('destroy rejects start with destroyed, then refuses start and preload', async () => {
    const { receiver, states } = setup();
    const { result } = await started(receiver);
    receiver.destroy();
    expect(await rejection(result)).toMatchObject({ code: 'cancelled', details: { reason: 'destroyed' } });
    expect(await rejection(receiver.start())).toMatchObject({ code: 'invalid-state', details: { state: 'destroyed' } });
    expect(await rejection(receiver.preload())).toMatchObject({ code: 'invalid-state', details: { state: 'destroyed' } });
    receiver.stop();
    receiver.destroy();
    expect(receiver.state).toBe('destroyed');
    expect(states).toEqual(['loading', 'detecting', 'destroyed']);
  });
});

describe('failures', () => {
  test('a decoder abort rejects start and returns to idle', async () => {
    const { fakes, receiver } = setup();
    const { result } = await started(receiver);
    const driver = fakes[0]!.receivers[0]!;
    driver.hooks.onData();
    const failure = new QrcastError('codec-aborted', { codec: 'codec0', role: 'receiver', progress: 0.4 }, 'oom');
    driver.hooks.onFailure(failure);
    expect(await rejection(result)).toBe(failure);
    expect(receiver.state).toBe('idle');
    expect(driver.disposed).toBe(true);
  });
});

test('falls back to requestAnimationFrame without requestVideoFrameCallback', async () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callbacks.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const fake = fakeCodec();
  const video = Object.freeze({ readyState: 4 }) as unknown as HTMLVideoElement;
  const receiver = createReceiver({ codecs: [fake.codec], video });
  await started(receiver);
  callbacks.shift()!(0);
  expect(fake.receivers[0]!.pushed).toHaveLength(1);
  receiver.stop();
});
