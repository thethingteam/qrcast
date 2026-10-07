import { QrcastError } from '../../errors.js';

/** cimbar modes. `B` is the default for sending. */
export type CimbarMode = 'B' | 'Bm' | 'Bu' | '4C';

/** libcimbar's numbers for each mode. */
export const MODE_NUMBERS: Readonly<Record<CimbarMode, number>> = { B: 68, Bm: 67, Bu: 66, '4C': 4 };

/** Modes a receiver tries, in order, until one decodes. */
export const AUTO_MODES: readonly number[] = [68, 67, 66, 4];

export const DEFAULT_FPS = 15;
export const MIN_FPS = 1;
export const MAX_FPS = 30;

export interface CimbarOptions {
  /**
   * Sending: the mode to encode in (default `B`). Receiving: the only mode to
   * try; without it, the receiver detects the mode.
   */
  mode?: CimbarMode | undefined;
  /** Frames per second when sending, from 1 to 30 (default 15). */
  fps?: number | undefined;
  /** Replaces the URL of the bundled libcimbar script. */
  glueUrl?: string | URL | undefined;
  /** Replaces the URL of the bundled libcimbar wasm. */
  wasmUrl?: string | URL | undefined;
  /**
   * Creates the codec's workers instead of `new Worker(url)`. It receives
   * the URL of the bundled worker script, which must run as a classic worker.
   */
  workerFactory?: ((url: URL) => Worker) | undefined;
}

/** Options after validation, as the drivers use them. */
export interface ResolvedCimbarOptions {
  /** The mode number to send in. */
  readonly sendMode: number;
  /** The fixed mode number to receive in, or `null` to detect it. */
  readonly receiveMode: number | null;
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
  throw invalid(`The cimbar option ${option} must be a string or a URL.`);
}

export function resolveOptions(options: unknown): ResolvedCimbarOptions {
  if (options === undefined) options = {};
  if (typeof options !== 'object' || options === null) {
    throw invalid('The cimbar options must be an object.');
  }
  const { mode, fps, glueUrl, wasmUrl, workerFactory } = options as Record<string, unknown>;
  if (mode !== undefined && !(typeof mode === 'string' && Object.hasOwn(MODE_NUMBERS, mode))) {
    throw invalid(`Unknown cimbar mode ${String(mode)}; use B, Bm, Bu or 4C.`);
  }
  if (
    fps !== undefined &&
    !(typeof fps === 'number' && Number.isFinite(fps) && fps >= MIN_FPS && fps <= MAX_FPS)
  ) {
    throw invalid(`The cimbar fps must be a number from ${MIN_FPS} to ${MAX_FPS}; got ${String(fps)}.`);
  }
  if (workerFactory !== undefined && typeof workerFactory !== 'function') {
    throw invalid('The cimbar option workerFactory must be a function.');
  }
  const modeNumber = mode === undefined ? null : MODE_NUMBERS[mode as CimbarMode];
  return Object.freeze({
    sendMode: modeNumber ?? MODE_NUMBERS.B,
    receiveMode: modeNumber,
    fps: fps ?? DEFAULT_FPS,
    glueUrl: url(glueUrl, 'glueUrl'),
    wasmUrl: url(wasmUrl, 'wasmUrl'),
    workerFactory: (workerFactory as ((url: URL) => Worker) | undefined) ?? null,
  });
}
