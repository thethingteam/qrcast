import type { CodecDescriptor } from '../codec.js';
import type { EnvironmentFeature, QrcastError } from '../errors.js';

/** Keys the internal part of qrcast's own codecs. Never exported publicly. */
export const CODEC_INTERNALS: unique symbol = Symbol('qrcast.codec');

/** Plays one transfer. Created per transfer and never reused. */
export interface SenderDriver {
  /** Frames per second to show. */
  readonly fps: number;
  /** Loads the codec and encodes the envelope; frames can be requested afterwards. */
  start(envelope: Uint8Array): Promise<void>;
  /** Renders the next frame. The caller owns the bitmap. */
  nextFrame(): Promise<ImageBitmap>;
  /** Releases the codec instance. Pending promises may never settle. */
  dispose(): void;
}

export interface SenderHooks {
  /** The codec failed after `start` was called. Called at most once. */
  onFailure(error: QrcastError): void;
}

/** Decodes one transfer. Created per transfer and never reused. */
export interface ReceiverDriver {
  /** Loads the codec instances. */
  load(): Promise<void>;
  /** Whether `push` would take a frame now; frames are skipped otherwise. */
  canAccept(): boolean;
  /** Takes the frame and closes it when done with it. */
  push(frame: VideoFrame): void;
  /** Releases the codec instances. */
  dispose(): void;
}

export interface ReceiverHooks {
  /** The first frame that decoded to data. Used to lock this codec. */
  onData(): void;
  /** Fraction of the file received, from 0 to 1. */
  onProgress(progress: number): void;
  /** A complete file, with the name the codec carried (or `''`). */
  onFile(bytes: Uint8Array, name: string): void;
  /** The codec failed. Called at most once. */
  onFailure(error: QrcastError): void;
}

export interface CodecInternals {
  /** Browser features needed to send, checked before any asset loads. */
  readonly sendFeatures: readonly EnvironmentFeature[];
  /** Browser features needed to receive, checked before any asset loads. */
  readonly receiveFeatures: readonly EnvironmentFeature[];
  createSender(hooks: SenderHooks): Promise<SenderDriver>;
  createReceiver(hooks: ReceiverHooks): Promise<ReceiverDriver>;
}

/** A codec created by one of qrcast's codec factories, such as `cimbar()`. */
export interface QrcastCodec extends CodecDescriptor {
  /** @internal */
  readonly [CODEC_INTERNALS]: CodecInternals;
}

export function isQrcastCodec(value: unknown): value is QrcastCodec {
  return typeof value === 'object' && value !== null && CODEC_INTERNALS in value;
}
