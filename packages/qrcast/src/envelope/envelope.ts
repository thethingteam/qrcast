import { QrcastError } from '../errors.js';
import { deflateRaw, inflateRawBounded } from './deflate.js';
import { decodeMeta, encodeMeta, MAX_META_BYTES, type PayloadHints, type PayloadMeta } from './meta.js';
import { decodeVarint, encodeVarint } from './varint.js';

/** `QRCAST` in ASCII. */
const MAGIC = Uint8Array.from([0x51, 0x52, 0x43, 0x41, 0x53, 0x54]);
const VERSION = 0x01;
const FLAG_COMPRESSED = 0x01;
const KNOWN_FLAGS = FLAG_COMPRESSED;
const HEADER_BYTES = MAGIC.length + 2;

/** A payload received from a qrcast sender. */
export interface ReceivedPayload {
  kind: 'qrcast';
  meta: PayloadMeta;
  bytes: Uint8Array;
}

export interface WrapOptions extends PayloadHints {
  /** Compress the body with raw DEFLATE when that makes it smaller. */
  compress?: boolean | undefined;
}

/** Wraps `body` in a v1 envelope. */
export async function wrapEnvelope(body: Uint8Array, options: WrapOptions = {}): Promise<Uint8Array> {
  if (!(body instanceof Uint8Array)) {
    throw new QrcastError('invalid-input', { reason: 'body' }, 'The body must be a Uint8Array.');
  }
  const meta = encodeMeta(body.length, options);
  let payload = body;
  let flags = 0;
  if (options.compress === true) {
    const compressed = await deflateRaw(body);
    if (compressed.length < body.length) {
      payload = compressed;
      flags |= FLAG_COMPRESSED;
    }
  }
  const metaLength = encodeVarint(meta.length);
  const out = new Uint8Array(HEADER_BYTES + metaLength.length + meta.length + payload.length);
  let offset = 0;
  for (const part of [MAGIC, Uint8Array.of(VERSION, flags), metaLength, meta, payload]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function truncated(): QrcastError {
  return new QrcastError('malformed-envelope', { reason: 'truncated' }, 'The envelope is truncated.');
}

/**
 * Unwraps a v1 envelope. Fields are checked in envelope order and the first
 * failure is reported.
 */
export async function unwrapEnvelope(bytes: Uint8Array): Promise<ReceivedPayload> {
  if (!(bytes instanceof Uint8Array)) {
    throw new QrcastError('invalid-input', { reason: 'body' }, 'The input must be a Uint8Array.');
  }

  const head = bytes.subarray(0, MAGIC.length);
  if (head.length < MAGIC.length || head.some((byte, i) => byte !== MAGIC[i])) {
    throw new QrcastError(
      'unsupported-format',
      { reason: 'magic', value: hex(head) },
      'The input is not a qrcast payload: it does not start with "QRCAST".',
    );
  }

  const version = bytes[MAGIC.length];
  if (version === undefined) throw truncated();
  if (version !== VERSION) {
    throw new QrcastError(
      'unsupported-format',
      { reason: 'version', value: version },
      `Envelope version ${version} is not supported; this receiver reads version ${VERSION}.`,
    );
  }

  const flags = bytes[MAGIC.length + 1];
  if (flags === undefined) throw truncated();
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    throw new QrcastError(
      'unsupported-format',
      { reason: 'flags', value: flags },
      `Envelope flags 0x${flags.toString(16).padStart(2, '0')} use reserved bits.`,
    );
  }

  const metaLength = decodeVarint(bytes, HEADER_BYTES);
  if (!metaLength.ok) {
    if (metaLength.reason === 'truncated') throw truncated();
    throw new QrcastError(
      'malformed-envelope',
      { reason: 'meta-length' },
      'The meta length is not a minimal unsigned LEB128 varint.',
    );
  }
  if (metaLength.value > MAX_META_BYTES) {
    throw new QrcastError(
      'unsupported-format',
      { reason: 'meta-length', value: metaLength.value },
      `Meta length ${metaLength.value} exceeds the limit of ${MAX_META_BYTES} bytes.`,
    );
  }

  const metaStart = HEADER_BYTES + metaLength.length;
  const bodyStart = metaStart + metaLength.value;
  if (bodyStart > bytes.length) throw truncated();
  const meta = decodeMeta(bytes.subarray(metaStart, bodyStart));

  const payload = bytes.subarray(bodyStart);
  const compressed = (flags & FLAG_COMPRESSED) !== 0;
  const body = compressed ? await inflateRawBounded(payload, meta.size) : payload;
  if (body.length !== meta.size) {
    throw new QrcastError(
      'malformed-envelope',
      { reason: 'body-size' },
      `The body is ${body.length} bytes but the meta declares ${meta.size}.`,
    );
  }
  // Copy an uncompressed body so the result never aliases the caller's buffer.
  return { kind: 'qrcast', meta, bytes: compressed ? body : new Uint8Array(body) };
}
