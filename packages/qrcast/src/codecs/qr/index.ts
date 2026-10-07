import { CODEC_INTERNALS, type CodecInternals, type QrcastCodec } from '../../internal/codec.js';
import { resolveOptions, type QrOptions } from './options.js';
import { MAX_TOTAL_BLOCKS } from './frame.js';

export type { QrOptions } from './options.js';
export type { QrcastCodec } from '../../internal/codec.js';

/** A QR codec, created by {@link qr}. */
export interface QrCodec extends QrcastCodec {
  readonly name: 'qr';
}

/**
 * The QR codec: animated QR codes in black and white or color, read with the
 * bundled zxing-wasm. Creating it loads nothing, and sending never loads any
 * asset. A receiver fetches the worker, script and wasm when it starts or
 * preloads.
 *
 * Throws `invalid-input` (reason `option`) for an invalid option.
 */
export function qr(options?: QrOptions): QrCodec {
  const resolved = resolveOptions(options);
  const internals: CodecInternals = Object.freeze({
    sendFeatures: Object.freeze([] as const),
    receiveFeatures: Object.freeze(['worker', 'webassembly', 'video-frame'] as const),
    async createSender(hooks) {
      const { createQrSender } = await import('./sender-driver.js');
      return createQrSender(resolved, hooks);
    },
    async createReceiver(hooks) {
      const { createQrReceiver } = await import('./receiver-driver.js');
      return createQrReceiver(resolved, hooks);
    },
  } satisfies CodecInternals);
  return Object.freeze({
    name: 'qr',
    maxPayloadSize: resolved.blockSize * MAX_TOTAL_BLOCKS,
    compress: true,
    [CODEC_INTERNALS]: internals,
  });
}
