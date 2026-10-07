import { prepareTransfer } from '../codec.js';
import type { PayloadHints } from '../envelope/meta.js';
import { QrcastError } from '../errors.js';
import { CODEC_INTERNALS, isQrcastCodec, type QrcastCodec, type SenderDriver } from '../internal/codec.js';
import { Emitter } from '../internal/emitter.js';
import { missingFeature } from '../internal/environment.js';
import type { SenderState } from '../states.js';

export type { PayloadHints } from '../envelope/meta.js';
export type { QrcastCodec } from '../internal/codec.js';
export type { SenderState } from '../states.js';

/** Frames shown below this many milliseconds early still count as on time. */
const PACING_TOLERANCE_MS = 2;

export interface SenderOptions {
  /** The codec to send with, such as `cimbar()`. */
  codec: QrcastCodec;
  /**
   * The canvas the frames are drawn into. The app places and sizes it on the
   * page; the sender sets only its `width` and `height` (the frame's pixel
   * size). It must not have another rendering context.
   */
  canvas: HTMLCanvasElement;
}

export interface SenderEvents {
  state: { state: SenderState };
  /** A frame was shown. `frame` counts frames since this transfer started, from 1. */
  frame: { frame: number };
  /** The codec failed while playing. The sender is back to `idle`. */
  error: { error: QrcastError };
}

export interface Sender {
  readonly state: SenderState;
  /**
   * Plays `bytes` until stopped. Resolves once the first frame is on the
   * canvas. Calling it again replaces the current transfer.
   */
  start(bytes: Uint8Array, hints?: PayloadHints): Promise<void>;
  /** Ends the transfer and clears the canvas. */
  stop(): void;
  /** Stops and releases everything. The sender cannot be started again. */
  destroy(): void;
  /** Adds a listener; the returned function removes it. */
  on<K extends keyof SenderEvents>(event: K, listener: (payload: SenderEvents[K]) => void): () => void;
}

function invalidOption(message: string): QrcastError {
  return new QrcastError('invalid-input', { reason: 'option' }, message);
}

function cancelled(reason: 'stopped' | 'destroyed'): QrcastError {
  return new QrcastError(
    'cancelled',
    { reason },
    reason === 'stopped' ? 'The transfer was stopped.' : 'The sender was destroyed.',
  );
}

/** One call to `start`, from the size check until it is replaced or stopped. */
class Transfer {
  driver: SenderDriver | null = null;
  /** Whether the `start` promise has settled. */
  settled = false;
  frame = 0;
  raf = 0;
  /** Timestamp of the last frame deadline, or null before the first tick. */
  deadline: number | null = null;
  next: ImageBitmap | null = null;

  constructor(
    readonly resolve: () => void,
    readonly reject: (error: unknown) => void,
  ) {}

  settle(error?: unknown): void {
    if (this.settled) return;
    this.settled = true;
    if (error === undefined) this.resolve();
    else this.reject(error);
  }

  /** Releases the codec instance and stops the frame loop. */
  release(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.driver?.dispose();
    this.next?.close();
    this.next = null;
  }
}

class QrcastSender implements Sender {
  readonly #codec: QrcastCodec;
  readonly #canvas: HTMLCanvasElement;
  readonly #context: ImageBitmapRenderingContext;
  readonly #events = new Emitter<SenderEvents>();
  #state: SenderState = 'idle';
  /** Transfers still in their size check. */
  readonly #preparing = new Set<Transfer>();
  /** The transfer that owns the codec and the canvas. */
  #active: Transfer | null = null;

  constructor(codec: QrcastCodec, canvas: HTMLCanvasElement, context: ImageBitmapRenderingContext) {
    this.#codec = codec;
    this.#canvas = canvas;
    this.#context = context;
  }

  get state(): SenderState {
    return this.#state;
  }

  on<K extends keyof SenderEvents>(event: K, listener: (payload: SenderEvents[K]) => void): () => void {
    return this.#events.on(event, listener);
  }

  start(bytes: Uint8Array, hints: PayloadHints = {}): Promise<void> {
    if (this.#state === 'destroyed') {
      return Promise.reject(
        new QrcastError('invalid-state', { state: 'destroyed' }, 'The sender was destroyed.'),
      );
    }
    return new Promise((resolve, reject) => {
      const transfer = new Transfer(resolve, reject);
      // A newer start replaces any start still in its size check.
      for (const older of this.#preparing) older.settle(cancelled('stopped'));
      this.#preparing.clear();
      this.#preparing.add(transfer);
      void this.#run(transfer, bytes, hints);
    });
  }

  async #run(transfer: Transfer, bytes: Uint8Array, hints: PayloadHints): Promise<void> {
    const internals = this.#codec[CODEC_INTERNALS];
    let envelope: Uint8Array;
    try {
      envelope = await prepareTransfer(bytes, hints, this.#codec);
      const feature = missingFeature(internals.sendFeatures);
      if (feature !== null) {
        throw new QrcastError(
          'unsupported-environment',
          { feature },
          `This browser cannot send with ${this.#codec.name}: ${feature} is missing.`,
        );
      }
    } catch (error) {
      // The current transfer, if any, keeps playing.
      this.#preparing.delete(transfer);
      transfer.settle(error);
      return;
    }
    if (transfer.settled) return;
    this.#preparing.delete(transfer);

    this.#end(this.#active, cancelled('stopped'));
    this.#active = transfer;
    this.#setState('loading');
    try {
      transfer.driver = await internals.createSender({
        onFailure: (error) => this.#fail(transfer, error),
      });
    } catch (error) {
      this.#fail(transfer, this.#loadError(error));
      return;
    }
    if (this.#active !== transfer) {
      transfer.driver.dispose();
      return;
    }
    try {
      await transfer.driver.start(envelope);
      const first = await transfer.driver.nextFrame();
      if (this.#active !== transfer) {
        first.close();
        return;
      }
      this.#show(transfer, first);
    } catch (error) {
      this.#fail(transfer, error);
      return;
    }
    // Settle first: a listener below may already stop or restart the sender.
    transfer.settle();
    this.#setState('playing');
    if (this.#active !== transfer) return;
    this.#events.emit('frame', { frame: transfer.frame });
    if (this.#active !== transfer) return;
    this.#requestFrame(transfer);
    transfer.raf = requestAnimationFrame((now) => this.#tick(transfer, now));
  }

  /** A failure to load the codec's own module counts as a failed codec start. */
  #loadError(error: unknown): unknown {
    if (error instanceof QrcastError) return error;
    return new QrcastError(
      'codec-init-failed',
      { codec: this.#codec.name },
      `The ${this.#codec.name} codec could not be loaded.`,
      { cause: error },
    );
  }

  #show(transfer: Transfer, bitmap: ImageBitmap): void {
    if (this.#canvas.width !== bitmap.width) this.#canvas.width = bitmap.width;
    if (this.#canvas.height !== bitmap.height) this.#canvas.height = bitmap.height;
    this.#context.transferFromImageBitmap(bitmap);
    transfer.frame++;
  }

  #requestFrame(transfer: Transfer): void {
    transfer.driver!.nextFrame().then(
      (bitmap) => {
        if (this.#active === transfer) transfer.next = bitmap;
        else bitmap.close();
      },
      (error: unknown) => this.#fail(transfer, error),
    );
  }

  #tick(transfer: Transfer, now: number): void {
    if (this.#active !== transfer) return;
    transfer.raf = requestAnimationFrame((time) => this.#tick(transfer, time));
    if (transfer.deadline === null) {
      transfer.deadline = now;
      return;
    }
    const interval = 1000 / transfer.driver!.fps;
    const elapsed = now - transfer.deadline;
    if (elapsed < interval - PACING_TOLERANCE_MS || transfer.next === null) return;
    // Keep the schedule, unless the page was hidden or busy for a while.
    transfer.deadline = elapsed > interval * 2 ? now : transfer.deadline + interval;
    const bitmap = transfer.next;
    transfer.next = null;
    this.#show(transfer, bitmap);
    this.#events.emit('frame', { frame: transfer.frame });
    if (this.#active === transfer) this.#requestFrame(transfer);
  }

  /** Handles a codec failure: rejects a pending start, or emits `error`. */
  #fail(transfer: Transfer, error: unknown): void {
    if (this.#active !== transfer) return;
    const pending = !transfer.settled;
    this.#end(transfer, error);
    this.#clear();
    this.#setState('idle');
    if (!pending) {
      this.#events.emit('error', { error: error as QrcastError });
    }
  }

  /** Ends the active transfer, rejecting its pending start with `reason`. */
  #end(transfer: Transfer | null, reason: unknown): void {
    if (!transfer) return;
    if (this.#active === transfer) this.#active = null;
    transfer.release();
    transfer.settle(reason);
  }

  #clear(): void {
    this.#context.transferFromImageBitmap(null);
  }

  #setState(state: SenderState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#events.emit('state', { state });
  }

  #cancelAll(reason: 'stopped' | 'destroyed'): void {
    for (const transfer of this.#preparing) transfer.settle(cancelled(reason));
    this.#preparing.clear();
    const active = this.#active;
    this.#end(active, cancelled(reason));
    if (active) this.#clear();
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
 * Creates a sender that plays transfers into `canvas`. Creating it loads
 * nothing; the codec loads when a transfer starts.
 *
 * Throws `invalid-input` (reason `option`) for a missing canvas, a canvas
 * that already has another rendering context, or a codec that is not one of
 * qrcast's codecs.
 */
export function createSender(options: SenderOptions): Sender {
  if (typeof options !== 'object' || options === null) {
    throw invalidOption('createSender needs an options object.');
  }
  const { codec, canvas } = options;
  if (!isQrcastCodec(codec)) {
    throw invalidOption('The codec must be created by a qrcast codec factory, such as cimbar().');
  }
  if (typeof canvas !== 'object' || canvas === null || typeof canvas.getContext !== 'function') {
    throw invalidOption('createSender needs a canvas element.');
  }
  const context = canvas.getContext('bitmaprenderer');
  if (!context) {
    throw invalidOption('The canvas already has another rendering context.');
  }
  return new QrcastSender(codec, canvas, context);
}
