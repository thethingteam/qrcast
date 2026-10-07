import { unwrapEnvelope, type ReceivedPayload } from '../envelope/envelope.js';
import { QrcastError } from '../errors.js';
import {
  CODEC_INTERNALS,
  isQrcastCodec,
  type QrcastCodec,
  type ReceiverDriver,
  type ReceiverHooks,
} from '../internal/codec.js';
import { Emitter } from '../internal/emitter.js';
import { missingFeature } from '../internal/environment.js';
import type { ReceiverState } from '../states.js';

export type { ReceivedPayload } from '../envelope/envelope.js';
export type { PayloadMeta } from '../envelope/meta.js';
export type { QrcastCodec } from '../internal/codec.js';
export type { ReceiverState } from '../states.js';

/** HTMLMediaElement.HAVE_CURRENT_DATA, without touching browser globals at import. */
const HAVE_CURRENT_DATA = 2;

export interface ReceiverOptions {
  /** The codecs to detect, such as `[cimbar()]`. */
  codecs: readonly QrcastCodec[];
  /**
   * The video element showing the camera. The app opens the camera and
   * plays it; the receiver only reads its frames.
   */
  video: HTMLVideoElement;
  /**
   * Also accept files sent without a qrcast envelope, such as those of the
   * official cimbar web sender. Default `false`.
   */
  acceptRaw?: boolean | undefined;
}

/** A file sent without a qrcast envelope, accepted with `acceptRaw`. */
export interface RawPayload {
  kind: 'raw';
  /** The file name the codec carried, or `''` when there is none. */
  name: string;
  bytes: Uint8Array;
}

export type ReceiveResult = ReceivedPayload | RawPayload;

export interface ReceiverEvents {
  state: { state: ReceiverState };
  /** The codec of the transfer was detected. */
  lock: { codec: string };
  /** Fraction of the file received so far, from 0 to 1. */
  progress: { codec: string; progress: number };
}

export interface Receiver {
  readonly state: ReceiverState;
  /** Reads frames until a file is complete, and resolves with it. */
  start(): Promise<ReceiveResult>;
  /** Loads the decoders, so that the next `start` begins detecting at once. */
  preload(): Promise<void>;
  /** Stops reading frames and releases the decoders. */
  stop(): void;
  /** Stops and releases everything. The receiver cannot be started again. */
  destroy(): void;
  /** Adds a listener; the returned function removes it. */
  on<K extends keyof ReceiverEvents>(event: K, listener: (payload: ReceiverEvents[K]) => void): () => void;
}

function invalidOption(message: string): QrcastError {
  return new QrcastError('invalid-input', { reason: 'option' }, message);
}

function cancelled(reason: 'stopped' | 'destroyed'): QrcastError {
  return new QrcastError(
    'cancelled',
    { reason },
    reason === 'stopped' ? 'The transfer was stopped.' : 'The receiver was destroyed.',
  );
}

/** One codec's decoder for one transfer. */
interface Decoder {
  codec: QrcastCodec;
  driver: ReceiverDriver | null;
  /** The transfer the decoder serves, once a `start` takes it. */
  session: Session | null;
  released: boolean;
}

/** A set of decoders being loaded, by `preload` or `start`. */
interface Loading {
  decoders: Decoder[];
  promise: Promise<void>;
  cancelled: boolean;
}

/** One call to `start`. */
interface Session {
  resolve: (result: ReceiveResult) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  decoders: Decoder[];
  locked: Decoder | null;
  turn: number;
  /** Cancels the pending video frame callback. */
  cancelCapture: (() => void) | null;
}

function release(decoders: readonly Decoder[]): void {
  for (const decoder of decoders) {
    decoder.released = true;
    decoder.driver?.dispose();
  }
}

class QrcastReceiver implements Receiver {
  readonly #codecs: readonly QrcastCodec[];
  readonly #video: HTMLVideoElement;
  readonly #acceptRaw: boolean;
  readonly #events = new Emitter<ReceiverEvents>();
  #state: ReceiverState = 'idle';
  #session: Session | null = null;
  /** Decoders loaded (or loading) by `preload` for the next `start`. */
  #preloaded: Loading | null = null;

  constructor(codecs: readonly QrcastCodec[], video: HTMLVideoElement, acceptRaw: boolean) {
    this.#codecs = codecs;
    this.#video = video;
    this.#acceptRaw = acceptRaw;
  }

  get state(): ReceiverState {
    return this.#state;
  }

  on<K extends keyof ReceiverEvents>(event: K, listener: (payload: ReceiverEvents[K]) => void): () => void {
    return this.#events.on(event, listener);
  }

  /** Rejects calls that the current state does not allow, and missing features. */
  #refuse(): QrcastError | null {
    if (this.#state === 'destroyed' || this.#session) {
      return new QrcastError(
        'invalid-state',
        { state: this.#state },
        this.#state === 'destroyed' ? 'The receiver was destroyed.' : 'A transfer is already running.',
      );
    }
    for (const codec of this.#codecs) {
      const feature = missingFeature(codec[CODEC_INTERNALS].receiveFeatures);
      if (feature !== null) {
        return new QrcastError(
          'unsupported-environment',
          { feature },
          `This browser cannot receive ${codec.name}: ${feature} is missing.`,
        );
      }
    }
    return null;
  }

  preload(): Promise<void> {
    const refusal = this.#refuse();
    if (refusal) return Promise.reject(refusal);
    this.#preloaded ??= this.#load();
    const loading = this.#preloaded;
    return loading.promise.then(() => {
      if (loading.cancelled) throw cancelled(this.#state === 'destroyed' ? 'destroyed' : 'stopped');
    });
  }

  /** Creates and loads a decoder for every codec. */
  #load(): Loading {
    const decoders: Decoder[] = this.#codecs.map((codec) => ({
      codec,
      driver: null,
      session: null,
      released: false,
    }));
    const loading: Loading = { decoders, cancelled: false, promise: Promise.resolve() };
    loading.promise = (async () => {
      const results = await Promise.allSettled(
        decoders.map(async (decoder) => {
          let driver: ReceiverDriver;
          try {
            driver = await decoder.codec[CODEC_INTERNALS].createReceiver(this.#hooks(decoder));
          } catch (error) {
            throw error instanceof QrcastError
              ? error
              : new QrcastError(
                  'codec-init-failed',
                  { codec: decoder.codec.name },
                  `The ${decoder.codec.name} codec could not be loaded.`,
                  { cause: error },
                );
          }
          decoder.driver = driver;
          if (decoder.released) driver.dispose();
          else await driver.load();
        }),
      );
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) {
        release(decoders);
        if (this.#preloaded === loading) this.#preloaded = null;
        throw failure.reason;
      }
    })();
    // Avoid an unhandled rejection when nobody awaits a preload.
    loading.promise.catch(() => {});
    return loading;
  }

  #hooks(decoder: Decoder): ReceiverHooks {
    return {
      onData: () => this.#onData(decoder),
      onProgress: (progress) => {
        const session = decoder.session;
        if (session && session.locked === decoder && !session.settled) {
          this.#events.emit('progress', { codec: decoder.codec.name, progress });
        }
      },
      onFile: (bytes, name) => this.#onFile(decoder, bytes, name),
      onFailure: (error) => {
        const session = decoder.session;
        if (session) {
          if (!decoder.released) this.#finish(session, error);
        } else if (this.#preloaded?.decoders.includes(decoder)) {
          // A preloaded decoder died before use; the next start loads anew.
          release(this.#preloaded.decoders);
          this.#preloaded = null;
        }
      },
    };
  }

  start(): Promise<ReceiveResult> {
    const refusal = this.#refuse();
    if (refusal) return Promise.reject(refusal);
    return new Promise((resolve, reject) => {
      const session: Session = {
        resolve,
        reject,
        settled: false,
        decoders: [],
        locked: null,
        turn: 0,
        cancelCapture: null,
      };
      this.#session = session;
      void this.#run(session);
    });
  }

  async #run(session: Session): Promise<void> {
    let loading = this.#preloaded;
    this.#preloaded = null;
    if (!loading) {
      this.#setState('loading');
      loading = this.#load();
    }
    session.decoders = loading.decoders;
    try {
      await loading.promise;
    } catch (error) {
      this.#finish(session, error);
      return;
    }
    if (session.settled) {
      release(loading.decoders);
      return;
    }
    for (const decoder of session.decoders) decoder.session = session;
    this.#setState('detecting');
    if (this.#session === session) this.#capture(session);
  }

  #capture(session: Session): void {
    const video = this.#video;
    const onFrame = (now: number) => {
      session.cancelCapture = null;
      if (session.settled) return;
      schedule();
      if (video.readyState < HAVE_CURRENT_DATA) return;
      const decoder = session.locked ?? session.decoders[session.turn++ % session.decoders.length]!;
      const driver = decoder.driver!;
      if (decoder.released || !driver.canAccept()) return;
      let frame: VideoFrame;
      try {
        frame = new VideoFrame(video, { timestamp: Math.round(now * 1000) });
      } catch {
        // No frame to read yet (for example, while the stream starts).
        return;
      }
      driver.push(frame);
    };
    const schedule = () => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        const handle = video.requestVideoFrameCallback(onFrame);
        session.cancelCapture = () => video.cancelVideoFrameCallback(handle);
      } else {
        const handle = requestAnimationFrame(onFrame);
        session.cancelCapture = () => cancelAnimationFrame(handle);
      }
    };
    schedule();
  }

  #onData(decoder: Decoder): void {
    const session = decoder.session;
    if (!session || session.settled || session.locked || decoder.released) return;
    session.locked = decoder;
    release(session.decoders.filter((other) => other !== decoder));
    this.#events.emit('lock', { codec: decoder.codec.name });
    if (!session.settled) this.#setState('receiving');
  }

  #onFile(decoder: Decoder, bytes: Uint8Array, name: string): void {
    const session = decoder.session;
    if (!session || session.settled || session.locked !== decoder) return;
    session.cancelCapture?.();
    session.cancelCapture = null;
    release(session.decoders);
    unwrapEnvelope(bytes).then(
      (payload) => this.#finish(session, undefined, payload),
      (error: unknown) => {
        const raw =
          error instanceof QrcastError &&
          error.code === 'unsupported-format' &&
          error.details.reason === 'magic';
        if (raw && this.#acceptRaw) this.#finish(session, undefined, { kind: 'raw', name, bytes });
        else this.#finish(session, error);
      },
    );
  }

  /** Settles a session: releases its decoders and returns to `idle`. */
  #finish(session: Session, error: unknown, result?: ReceiveResult, next: ReceiverState = 'idle'): void {
    if (session.settled) return;
    session.settled = true;
    session.cancelCapture?.();
    session.cancelCapture = null;
    release(session.decoders);
    if (this.#session === session) {
      this.#session = null;
      this.#setState(next);
    }
    if (error === undefined) session.resolve(result!);
    else session.reject(error);
  }

  #setState(state: ReceiverState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#events.emit('state', { state });
  }

  #cancelAll(reason: 'stopped' | 'destroyed'): void {
    const preloaded = this.#preloaded;
    if (preloaded) {
      preloaded.cancelled = true;
      release(preloaded.decoders);
      this.#preloaded = null;
    }
    const session = this.#session;
    if (session) this.#finish(session, cancelled(reason), undefined, reason === 'stopped' ? 'idle' : 'destroyed');
  }

  stop(): void {
    if (this.#state === 'destroyed') return;
    this.#cancelAll('stopped');
    this.#setState('idle');
  }

  destroy(): void {
    if (this.#state === 'destroyed') return;
    this.#cancelAll('destroyed');
    this.#setState('destroyed');
    this.#events.clear();
  }
}

/**
 * Creates a receiver that reads frames from `video`. Creating it loads
 * nothing; the decoders load on `preload` or `start`.
 *
 * Throws `invalid-input` (reason `option`) for an empty codec list, two
 * codecs with the same name, a codec that is not one of qrcast's codecs, or
 * a missing video element.
 */
export function createReceiver(options: ReceiverOptions): Receiver {
  if (typeof options !== 'object' || options === null) {
    throw invalidOption('createReceiver needs an options object.');
  }
  const { codecs, video, acceptRaw = false } = options;
  if (!Array.isArray(codecs) || codecs.length === 0) {
    throw invalidOption('createReceiver needs at least one codec.');
  }
  const names = new Set<string>();
  for (const codec of codecs) {
    if (!isQrcastCodec(codec)) {
      throw invalidOption('Each codec must be created by a qrcast codec factory, such as cimbar().');
    }
    if (names.has(codec.name)) throw invalidOption(`The codec ${codec.name} is listed twice.`);
    names.add(codec.name);
  }
  if (typeof video !== 'object' || video === null) {
    throw invalidOption('createReceiver needs a video element.');
  }
  if (typeof acceptRaw !== 'boolean') {
    throw invalidOption('acceptRaw must be a boolean.');
  }
  return new QrcastReceiver([...codecs], video, acceptRaw);
}
