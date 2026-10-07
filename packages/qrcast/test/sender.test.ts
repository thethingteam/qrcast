import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { QrcastError } from '../src/errors.js';
import { resetEnvironmentCache } from '../src/internal/environment.js';
import { createSender, type Sender } from '../src/sender/index.js';
import {
  deferred,
  fakeAnimationFrames,
  fakeCanvas,
  fakeCodec,
  FakeBitmap,
  flush,
  type FakeCodecOptions,
} from './fakes.js';
import { rejection } from './helpers.js';

let frames: ReturnType<typeof fakeAnimationFrames>;

beforeEach(() => {
  frames = fakeAnimationFrames();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetEnvironmentCache();
});

function setup(options: FakeCodecOptions = {}) {
  const fake = fakeCodec(options);
  const { canvas, shown } = fakeCanvas();
  const sender = createSender({ codec: fake.codec, canvas });
  const states: string[] = [];
  const frameCounts: number[] = [];
  const errors: QrcastError[] = [];
  sender.on('state', ({ state }) => states.push(state));
  sender.on('frame', ({ frame }) => frameCounts.push(frame));
  sender.on('error', ({ error }) => errors.push(error));
  return { ...fake, canvas, shown, sender, states, frameCounts, errors };
}

/** Plays `ms` milliseconds of 60 Hz animation frames, starting at `from`. */
async function play(ms: number, from = 0): Promise<number> {
  let time = from;
  for (; time <= from + ms; time += 1000 / 60) {
    frames.run(time);
    await flush();
  }
  return time;
}

const body = new Uint8Array(100).fill(7);

describe('creating a sender', () => {
  test('loads nothing and starts idle', () => {
    const { senders, sender } = setup();
    expect(sender.state).toBe('idle');
    expect(senders).toHaveLength(0);
  });

  test.each([
    ['no options', undefined],
    ['no canvas', { codec: fakeCodec().codec }],
    ['a plain descriptor', { codec: { name: 'x', maxPayloadSize: 1, compress: false }, canvas: fakeCanvas().canvas }],
  ])('throws invalid-input (option) for %s', (_label, options) => {
    expect(() => createSender(options as never)).toThrow(
      expect.objectContaining({ code: 'invalid-input', details: { reason: 'option' } }),
    );
  });

  test('throws when the canvas already has another context', () => {
    const { canvas } = fakeCanvas();
    vi.mocked(canvas.getContext).mockReturnValue(null);
    expect(() => createSender({ codec: fakeCodec().codec, canvas })).toThrow(
      expect.objectContaining({ code: 'invalid-input', details: { reason: 'option' } }),
    );
  });
});

describe('size check', () => {
  test('an oversized payload loads nothing and leaves the state', async () => {
    const { senders, sender, shown, states } = setup({ maxPayloadSize: 50 });
    const error = await rejection(sender.start(body));
    expect(error).toMatchObject({ code: 'payload-too-large', details: { limit: 50, codec: 'fake' } });
    expect(senders).toHaveLength(0);
    expect(sender.state).toBe('idle');
    expect(states).toEqual([]);
    expect(shown).toEqual([]);
  });

  test('an invalid hint fails before loading', async () => {
    const { senders, sender } = setup();
    const error = await rejection(sender.start(body, { name: 5 as never }));
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'meta-field' } });
    expect(senders).toHaveLength(0);
  });

  test('a failed check while playing keeps the current transfer', async () => {
    const { senders, sender } = setup({ maxPayloadSize: 200 });
    await sender.start(body);
    await rejection(sender.start(new Uint8Array(500)));
    expect(sender.state).toBe('playing');
    expect(senders).toHaveLength(1);
    expect(senders[0]!.disposed).toBe(false);
  });
});

describe('starting', () => {
  test('resolves with the first frame drawn and the canvas sized', async () => {
    const { senders, sender, canvas, shown, states, frameCounts } = setup();
    await sender.start(body, { type: 'text/plain' });
    expect(sender.state).toBe('playing');
    expect(states).toEqual(['loading', 'playing']);
    expect(frameCounts).toEqual([1]);
    expect(shown).toHaveLength(1);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(240);
    expect(canvas.style).toEqual({ width: '50vmin' });
    // The driver got the envelope, not the raw body.
    expect(senders[0]!.envelope!.subarray(0, 6)).toEqual(new TextEncoder().encode('QRCAST'));
  });

  test('a codec that fails to start rejects and returns to idle', async () => {
    const failure = new QrcastError('codec-init-failed', { codec: 'fake' }, 'no wasm');
    const { sender, states } = setup({
      setupSender: (driver) => {
        driver.start = () => Promise.reject(failure);
      },
    });
    expect(await rejection(sender.start(body))).toBe(failure);
    expect(sender.state).toBe('idle');
    expect(states).toEqual(['loading', 'idle']);
  });

  test('a missing browser feature rejects before loading', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const { senders, sender } = setup({ sendFeatures: ['worker', 'webgl'] });
    vi.stubGlobal('Worker', class {});
    const error = await rejection(sender.start(body));
    expect(error).toMatchObject({ code: 'unsupported-environment', details: { feature: 'webgl' } });
    expect(senders).toHaveLength(0);
    expect(sender.state).toBe('idle');
  });
});

describe('pacing', () => {
  test('about 30 frames in two seconds at 15 fps, counted without gaps', async () => {
    const { sender, frameCounts } = setup();
    await sender.start(body);
    await play(2000);
    expect(frameCounts.length).toBeGreaterThanOrEqual(29);
    expect(frameCounts.length).toBeLessThanOrEqual(31);
    expect(frameCounts).toEqual(frameCounts.map((_, i) => i + 1));
  });

  test('holds 15 fps on a 60 Hz display (every fourth animation frame)', async () => {
    const { sender, frameCounts } = setup();
    await sender.start(body);
    await play(1000);
    // 61 animation frames; the first one only sets the schedule.
    expect(frameCounts.length).toBe(16);
  });

  test('waits for a frame that is not rendered yet', async () => {
    let release: (() => void) | null = null;
    const { sender, frameCounts, senders } = setup();
    await sender.start(body);
    const driver = senders[0]!;
    driver.nextFrame = () =>
      new Promise((resolve) => {
        release = () => resolve(new FakeBitmap(320, 240, 99) as unknown as ImageBitmap);
      });
    await play(500);
    // Frame 2 was requested before the override; frame 3 is stuck.
    expect(frameCounts).toEqual([1, 2]);
    release!();
    await play(100, 600);
    expect(frameCounts).toEqual([1, 2, 3]);
  });
});

describe('restarting', () => {
  test('start while playing replaces the transfer', async () => {
    const { senders, sender, frameCounts } = setup();
    await sender.start(body);
    await play(300);
    const before = frameCounts.length;
    await sender.start(new Uint8Array(50));
    expect(senders).toHaveLength(2);
    expect(senders[0]!.disposed).toBe(true);
    expect(frameCounts[before]).toBe(1);
    await play(300, 1000);
    expect(frameCounts.slice(before)).toEqual(frameCounts.slice(before).map((_, i) => i + 1));
    expect(senders[0]!.frames).toBeLessThanOrEqual(before + 1);
  });

  test('start while loading cancels the pending start', async () => {
    const gate = deferred();
    let first = true;
    const { sender } = setup({
      setupSender: (driver) => {
        if (first) driver.gate = gate;
        first = false;
      },
    });
    const pending = sender.start(body);
    await flush();
    expect(sender.state).toBe('loading');
    const second = sender.start(body);
    expect(await rejection(pending)).toMatchObject({ code: 'cancelled', details: { reason: 'stopped' } });
    await second;
    expect(sender.state).toBe('playing');
  });
});

describe('stopping and destroying', () => {
  test('stop while playing clears the canvas and stops frames', async () => {
    const { senders, sender, shown, frameCounts, states } = setup();
    await sender.start(body);
    await play(300);
    sender.stop();
    const count = frameCounts.length;
    expect(sender.state).toBe('idle');
    expect(shown.at(-1)).toBeNull();
    expect(senders[0]!.disposed).toBe(true);
    await play(500, 1000);
    expect(frameCounts).toHaveLength(count);
    expect(frames.pending).toBe(0);
    expect(states).toEqual(['loading', 'playing', 'idle']);
  });

  test('stop while loading rejects the pending start', async () => {
    const { sender } = setup({ setupSender: (driver) => (driver.gate = deferred()) });
    const pending = sender.start(body);
    await flush();
    sender.stop();
    expect(await rejection(pending)).toMatchObject({ code: 'cancelled', details: { reason: 'stopped' } });
    expect(sender.state).toBe('idle');
  });

  test('stop during the size check rejects the pending start', async () => {
    const { sender, senders } = setup();
    const pending = sender.start(body);
    sender.stop();
    expect(await rejection(pending)).toMatchObject({ code: 'cancelled', details: { reason: 'stopped' } });
    await flush();
    expect(senders).toHaveLength(0);
  });

  test('destroy rejects a pending start and refuses later starts', async () => {
    const { sender, states } = setup({ setupSender: (driver) => (driver.gate = deferred()) });
    const pending = sender.start(body);
    await flush();
    sender.destroy();
    expect(await rejection(pending)).toMatchObject({ code: 'cancelled', details: { reason: 'destroyed' } });
    expect(await rejection(sender.start(body))).toMatchObject({
      code: 'invalid-state',
      details: { state: 'destroyed' },
    });
    sender.stop();
    sender.destroy();
    expect(sender.state).toBe('destroyed');
    expect(states).toEqual(['loading', 'destroyed']);
  });
});

describe('events', () => {
  test('the function returned by on removes the listener', async () => {
    const { sender } = setup();
    const counts: number[] = [];
    const off = sender.on('frame', ({ frame }) => counts.push(frame));
    await sender.start(body);
    off();
    await play(500);
    expect(counts).toEqual([1]);
  });

  test('a listener that stops the sender on the first frame', async () => {
    const { sender } = setup();
    sender.on('frame', () => sender.stop());
    await sender.start(body);
    expect(sender.state).toBe('idle');
    expect(frames.pending).toBe(0);
  });
});

describe('failures while playing', () => {
  test('an abort emits error, clears the canvas and returns to idle', async () => {
    const { senders, sender, errors, shown, frameCounts } = setup();
    await sender.start(body);
    await play(300);
    const failure = new QrcastError('codec-aborted', { codec: 'fake', role: 'sender', size: 1 }, 'oom');
    senders[0]!.fail(failure);
    expect(errors).toEqual([failure]);
    expect(sender.state).toBe('idle');
    expect(shown.at(-1)).toBeNull();
    const count = frameCounts.length;
    await play(300, 1000);
    expect(frameCounts).toHaveLength(count);
  });

  test('an abort while loading rejects the start instead', async () => {
    const failure = new QrcastError('codec-aborted', { codec: 'fake', role: 'sender', size: 1 }, 'oom');
    const { sender, errors } = setup({
      setupSender: (driver) => {
        driver.start = () => {
          driver.fail(failure);
          return new Promise(() => {});
        };
      },
    });
    expect(await rejection(sender.start(body))).toBe(failure);
    expect(errors).toEqual([]);
    expect(sender.state).toBe('idle');
  });
});

test('Sender is the type createSender returns', () => {
  const { sender } = setup();
  const typed: Sender = sender;
  expect(typed).toBe(sender);
});
