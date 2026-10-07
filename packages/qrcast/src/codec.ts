import { wrapEnvelope } from './envelope/envelope.js';
import type { PayloadHints } from './envelope/meta.js';
import { QrcastError } from './errors.js';

/**
 * What every codec reports to the qrcast core. Reading these values must not
 * load any wasm, worker or other asset.
 */
export interface CodecDescriptor {
  /** Codec name, such as `cimbar` or `qr`. */
  readonly name: string;
  /** Largest complete envelope (after any compression) the codec carries, in bytes. */
  readonly maxPayloadSize: number;
  /** Whether the envelope body is compressed for this codec. */
  readonly compress: boolean;
}

function invalidCodec(message: string): QrcastError {
  return new QrcastError('invalid-input', { reason: 'codec' }, message);
}

/**
 * Builds the envelope for `body` under the codec's compression policy and
 * checks it against the codec's `maxPayloadSize`. Call this before handing
 * anything to the codec.
 */
export async function prepareTransfer(
  body: Uint8Array,
  hints: PayloadHints,
  codec: CodecDescriptor,
): Promise<Uint8Array> {
  if (typeof codec !== 'object' || codec === null) {
    throw invalidCodec('The codec must be an object.');
  }
  const { name, maxPayloadSize, compress } = codec;
  if (typeof name !== 'string' || name === '') {
    throw invalidCodec('The codec name must be a non-empty string.');
  }
  if (!Number.isSafeInteger(maxPayloadSize) || maxPayloadSize <= 0) {
    throw invalidCodec(`Codec ${name} reports an invalid maxPayloadSize: ${maxPayloadSize}.`);
  }
  if (typeof compress !== 'boolean') {
    throw invalidCodec(`Codec ${name} must report compress as a boolean.`);
  }

  const envelope = await wrapEnvelope(body, { type: hints.type, name: hints.name, compress });
  if (envelope.length > maxPayloadSize) {
    throw new QrcastError(
      'payload-too-large',
      { size: envelope.length, limit: maxPayloadSize, codec: name },
      `The payload is ${envelope.length} bytes; codec ${name} carries at most ${maxPayloadSize}.`,
    );
  }
  return envelope;
}
