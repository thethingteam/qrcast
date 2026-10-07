/** Longest varint accepted: 8 bytes carry 56 bits, exact in a JS number. */
export const MAX_VARINT_BYTES = 8;

export type VarintResult =
  | { ok: true; value: number; length: number }
  | { ok: false; reason: 'truncated' | 'non-minimal' | 'too-long' };

/** Encodes a non-negative safe integer as the shortest unsigned LEB128. */
export function encodeVarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`varint value must be a non-negative safe integer, got ${value}`);
  }
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
  return Uint8Array.from(out);
}

/**
 * Decodes an unsigned LEB128 varint starting at `offset`. Rejects input that
 * ends mid-varint, uses more bytes than needed, or is longer than
 * {@link MAX_VARINT_BYTES}.
 */
export function decodeVarint(bytes: Uint8Array, offset: number): VarintResult {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    const byte = bytes[offset + i];
    if (byte === undefined) return { ok: false, reason: 'truncated' };
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) {
      // A zero final byte after other bytes adds nothing: a shorter form exists.
      if (byte === 0 && i > 0) return { ok: false, reason: 'non-minimal' };
      return { ok: true, value, length: i + 1 };
    }
    scale *= 0x80;
  }
  return { ok: false, reason: 'too-long' };
}
