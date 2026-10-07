// Fake codecs, canvases, frames and animation frames for the Node tests of
// the sender and receiver cores.
import { vi } from 'vitest';
import type { QrcastError } from '../src/errors.js';
import {
  CODEC_INTERNALS,
  type QrcastCodec,
  type ReceiverDriver,
  type ReceiverHooks,
  type SenderDriver,
  type SenderHooks,
} from '../src/internal/codec.js';
import type { EnvironmentFeature } from '../src/errors.js';

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class FakeBitmap {
  closed = false;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly id: number,
  ) {}
  close(): void {
    this.closed = true;
  }
}

export class FakeSenderDriver implements SenderDriver {
  fps = 15;
  envelope: Uint8Array | null = null;
  disposed = false;
  frames = 0;
  /** When set, `start` waits for it. */
  gate: Deferred<void> | null = null;

  constructor(readonly hooks: SenderHooks) {}

  async start(envelope: Uint8Array): Promise<void> {
    this.envelope = envelope;
    if (this.gate) await this.gate.promise;
  }

  nextFrame(): Promise<ImageBitmap> {
    this.frames++;
    return Promise.resolve(new FakeBitmap(320, 240, this.frames) as unknown as ImageBitmap);
  }

  dispose(): void {
    this.disposed = true;
  }

  fail(error: QrcastError): void {
    this.hooks.onFailure(error);
  }
}

export class FakeReceiverDriver implements ReceiverDriver {
  loaded = false;
  disposed = false;
  pushed: FakeFrame[] = [];
  accepting = true;
  /** When set, `load` waits for it. */
  gate: Deferred<void> | null = null;

  constructor(readonly hooks: ReceiverHooks) {}

  async load(): Promise<void> {
    if (this.gate) await this.gate.promise;
    this.loaded = true;
  }

  canAccept(): boolean {
    return this.accepting;
  }

  push(frame: VideoFrame): void {
    this.pushed.push(frame as unknown as FakeFrame);
    frame.close();
  }

  dispose(): void {
    this.disposed = true;
  }
}

export interface FakeCodecOptions {
  name?: string;
  maxPayloadSize?: number;
  sendFeatures?: EnvironmentFeature[];
  receiveFeatures?: EnvironmentFeature[];
  /** Runs on each new driver before it is returned. */
  setupSender?: (driver: FakeSenderDriver) => void;
  setupReceiver?: (driver: FakeReceiverDriver) => void;
  /** Makes creating a receiver driver fail (as a failed module import would). */
  failCreate?: unknown;
}

export function fakeCodec(options: FakeCodecOptions = {}) {
  const senders: FakeSenderDriver[] = [];
  const receivers: FakeReceiverDriver[] = [];
  const codec: QrcastCodec = {
    name: options.name ?? 'fake',
    maxPayloadSize: options.maxPayloadSize ?? 100_000,
    compress: false,
    [CODEC_INTERNALS]: {
      sendFeatures: options.sendFeatures ?? [],
      receiveFeatures: options.receiveFeatures ?? [],
      async createSender(hooks) {
        const driver = new FakeSenderDriver(hooks);
        options.setupSender?.(driver);
        senders.push(driver);
        return driver;
      },
      async createReceiver(hooks) {
        if (options.failCreate !== undefined) throw options.failCreate;
        const driver = new FakeReceiverDriver(hooks);
        options.setupReceiver?.(driver);
        receivers.push(driver);
        return driver;
      },
    },
  };
  return { codec, senders, receivers };
}

export function fakeCanvas() {
  const shown: (FakeBitmap | null)[] = [];
  const context = {
    transferFromImageBitmap(bitmap: FakeBitmap | null) {
      shown.push(bitmap);
    },
  };
  const canvas = {
    width: 300,
    height: 150,
    style: Object.freeze({ width: '50vmin' }),
    getContext: vi.fn((type: string) => (type === 'bitmaprenderer' ? context : null)),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, shown };
}

/** A manual requestAnimationFrame. Call `run(time)` to fire the callbacks. */
export function fakeAnimationFrames() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id);
  });
  return {
    get pending() {
      return callbacks.size;
    },
    run(time: number) {
      const current = [...callbacks.values()];
      callbacks.clear();
      for (const callback of current) callback(time);
    },
  };
}

export class FakeFrame {
  closed = false;
  constructor(readonly source: unknown) {}
  close(): void {
    this.closed = true;
  }
}

/**
 * A video element the receiver may only read. It is frozen, so any write
 * throws. `fire()` calls the pending requestVideoFrameCallback callbacks.
 */
export function fakeVideo(readyState = 4) {
  let callbacks: VideoFrameRequestCallback[] = [];
  const state = { readyState };
  const video = Object.freeze({
    get readyState() {
      return state.readyState;
    },
    requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelVideoFrameCallback() {
      callbacks = [];
    },
  });
  return {
    video: video as unknown as HTMLVideoElement,
    state,
    get pending() {
      return callbacks.length;
    },
    fire(time = 0) {
      const current = callbacks;
      callbacks = [];
      for (const callback of current) callback(time, {} as VideoFrameCallbackMetadata);
    },
  };
}
