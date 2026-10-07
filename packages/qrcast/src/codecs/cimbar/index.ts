import {
  CODEC_INTERNALS,
  type CodecInternals,
  type QrcastCodec,
} from '../../internal/codec.js';
import { resolveOptions, type CimbarOptions } from './options.js';

export type { CimbarMode, CimbarOptions } from './options.js';
export type { QrcastCodec } from '../../internal/codec.js';

/** Largest envelope the cimbar codec carries: 16 MiB, in every mode. */
const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024;

/** A cimbar codec, created by {@link cimbar}. */
export interface CimbarCodec extends QrcastCodec {
  readonly name: 'cimbar';
}

/**
 * The cimbar codec, built on the official libcimbar wasm release. Creating it
 * loads nothing: the worker, script and wasm are fetched when a sender starts
 * or a receiver starts or preloads.
 *
 * Throws `invalid-input` (reason `option`) for an invalid option.
 */
export function cimbar(options?: CimbarOptions): CimbarCodec {
  const resolved = resolveOptions(options);
  const internals: CodecInternals = Object.freeze({
    sendFeatures: Object.freeze(['worker', 'webassembly', 'webgl'] as const),
    receiveFeatures: Object.freeze(['worker', 'webassembly', 'video-frame'] as const),
    async createSender(hooks) {
      const { createCimbarSender } = await import('./sender-driver.js');
      return createCimbarSender(resolved, hooks);
    },
    async createReceiver(hooks) {
      const { createCimbarReceiver } = await import('./receiver-driver.js');
      return createCimbarReceiver(resolved, hooks);
    },
  } satisfies CodecInternals);
  return Object.freeze({
    name: 'cimbar',
    maxPayloadSize: MAX_PAYLOAD_SIZE,
    // cimbar compresses with zstd itself; a second pass would only cost time.
    compress: false,
    [CODEC_INTERNALS]: internals,
  });
}
