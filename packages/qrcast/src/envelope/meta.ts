import { QrcastError } from '../errors.js';

/** Largest encoded meta, in bytes. */
export const MAX_META_BYTES = 4096;

/** What a receiver learns about the body, besides its bytes. */
export interface PayloadMeta {
  /** Original (uncompressed) body size in bytes. */
  size: number;
  /** Type hint set by the sender; a MIME type is recommended. Only a hint. */
  type?: string;
  /** Name set by the sender. Untrusted: sanitize before using it as a file name. */
  name?: string;
}

/** Optional hints a sender attaches to a transfer. */
export interface PayloadHints {
  type?: string | undefined;
  name?: string | undefined;
}

const encoder = new TextEncoder();

/**
 * Encodes meta as UTF-8 JSON with the wire keys `s`, `t`, `n` in that order,
 * leaving out absent hints.
 */
export function encodeMeta(size: number, hints: PayloadHints): Uint8Array {
  const wire: { s: number; t?: string; n?: string } = { s: size };
  for (const [key, field] of [
    ['t', 'type'],
    ['n', 'name'],
  ] as const) {
    const value: unknown = hints[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new QrcastError(
        'invalid-input',
        { reason: 'meta-field' },
        `The ${field} hint must be a string, got ${typeof value}.`,
      );
    }
    wire[key] = value;
  }
  const bytes = encoder.encode(JSON.stringify(wire));
  if (bytes.length > MAX_META_BYTES) {
    throw new QrcastError(
      'invalid-input',
      { reason: 'meta-too-large', size: bytes.length, limit: MAX_META_BYTES },
      `Encoded meta is ${bytes.length} bytes; the limit is ${MAX_META_BYTES}. Shorten the type or name.`,
    );
  }
  return bytes;
}

// ignoreBOM keeps a leading BOM in the text, so JSON.parse rejects it.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function malformedMeta(message: string, cause?: unknown): QrcastError {
  return new QrcastError(
    'malformed-envelope',
    { reason: 'meta' },
    message,
    cause === undefined ? undefined : { cause },
  );
}

/** Parses and validates meta bytes. Unknown keys are dropped. */
export function decodeMeta(bytes: Uint8Array): PayloadMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch (cause) {
    throw malformedMeta('Meta is not valid UTF-8 JSON.', cause);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw malformedMeta('Meta is not a JSON object.');
  }
  const wire = parsed as Record<string, unknown>;
  const size = Object.hasOwn(wire, 's') ? wire['s'] : undefined;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw malformedMeta('Meta key "s" must be a non-negative integer.');
  }
  const meta: PayloadMeta = { size };
  for (const [key, field] of [
    ['t', 'type'],
    ['n', 'name'],
  ] as const) {
    if (!Object.hasOwn(wire, key)) continue;
    const value = wire[key];
    if (typeof value !== 'string') {
      throw malformedMeta(`Meta key "${key}" must be a string.`);
    }
    meta[field] = value;
  }
  return meta;
}
