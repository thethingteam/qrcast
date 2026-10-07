import { QrcastError } from '../../errors.js';

export const DEFAULT_LAYERS = 1;
export const DEFAULT_BLOCK_SIZE = 800;
export const MIN_BLOCK_SIZE = 100;
export const MAX_BLOCK_SIZE = 2000;
export const DEFAULT_FPS = 15;
export const MIN_FPS = 1;
export const MAX_FPS = 30;

export interface QrOptions {
  /**
   * Sending: 1 for black and white (default), or 3 for color, with three QR
   * codes in the red, green and blue channels of each picture. Receiving
   * ignores it.
   */
  layers?: 1 | 3 | undefined;
  /** Sending: bytes in each QR code, from 100 to 2000 (default 800). */
  blockSize?: number | undefined;
  /** Pictures per second when sending, from 1 to 30 (default 15). */
  fps?: number | undefined;
  /** Replaces the URL of the bundled zxing-wasm script. */
  glueUrl?: string | URL | undefined;
  /** Replaces the URL of the bundled zxing-wasm wasm. */
  wasmUrl?: string | URL | undefined;
  /**
   * Creates the decode workers instead of `new Worker(url)`. It receives the
   * URL of the bundled worker script, which must run as a classic worker.
   */
  workerFactory?: ((url: URL) => Worker) | undefined;
}

/** Options after validation, as the drivers use them. */
export interface ResolvedQrOptions {
  readonly layers: 1 | 3;
  readonly blockSize: number;
  readonly fps: number;
  readonly glueUrl: string | null;
  readonly wasmUrl: string | null;
  readonly workerFactory: ((url: URL) => Worker) | null;
}

function invalid(message: string): QrcastError {
  return new QrcastError('invalid-input', { reason: 'option' }, message);
}

function url(value: unknown, option: string): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.href;
  throw invalid(`The qr option ${option} must be a string or a URL.`);
}

export function resolveOptions(options: unknown): ResolvedQrOptions {
  if (options === undefined) options = {};
  if (typeof options !== 'object' || options === null) {
    throw invalid('The qr options must be an object.');
  }
  const { layers, blockSize, fps, glueUrl, wasmUrl, workerFactory } = options as Record<string, unknown>;
  if (layers !== undefined && layers !== 1 && layers !== 3) {
    throw invalid(`The qr layers must be 1 or 3; got ${String(layers)}.`);
  }
  if (
    blockSize !== undefined &&
    !(typeof blockSize === 'number' && Number.isInteger(blockSize) && blockSize >= MIN_BLOCK_SIZE && blockSize <= MAX_BLOCK_SIZE)
  ) {
    throw invalid(
      `The qr blockSize must be an integer from ${MIN_BLOCK_SIZE} to ${MAX_BLOCK_SIZE}; got ${String(blockSize)}.`,
    );
  }
  if (fps !== undefined && !(typeof fps === 'number' && Number.isFinite(fps) && fps >= MIN_FPS && fps <= MAX_FPS)) {
    throw invalid(`The qr fps must be a number from ${MIN_FPS} to ${MAX_FPS}; got ${String(fps)}.`);
  }
  if (workerFactory !== undefined && typeof workerFactory !== 'function') {
    throw invalid('The qr option workerFactory must be a function.');
  }
  return Object.freeze({
    layers: layers ?? DEFAULT_LAYERS,
    blockSize: blockSize ?? DEFAULT_BLOCK_SIZE,
    fps: fps ?? DEFAULT_FPS,
    glueUrl: url(glueUrl, 'glueUrl'),
    wasmUrl: url(wasmUrl, 'wasmUrl'),
    workerFactory: (workerFactory as ((url: URL) => Worker) | undefined) ?? null,
  });
}
