/** Base45 (RFC 9285). The output uses only QR alphanumeric characters. */

export const BASE45_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const DECODE_TABLE = new Map([...BASE45_ALPHABET].map((ch, i) => [ch, i]));

export function base45Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    const n = bytes[i]! * 256 + bytes[i + 1]!;
    const rest = n % 2025;
    out += BASE45_ALPHABET[rest % 45]! + BASE45_ALPHABET[Math.floor(rest / 45)]! + BASE45_ALPHABET[Math.floor(n / 2025)]!;
  }
  if (i < bytes.length) {
    const n = bytes[i]!;
    out += BASE45_ALPHABET[n % 45]! + BASE45_ALPHABET[Math.floor(n / 45)]!;
  }
  return out;
}

/** Decodes Base45 text. Throws on a bad length, character or value. */
export function base45Decode(text: string): Uint8Array {
  if (text.length % 3 === 1) throw new Error('Invalid base45 length');
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    const c = DECODE_TABLE.get(text[i]!);
    const d = DECODE_TABLE.get(text[i + 1]!);
    if (c === undefined || d === undefined) throw new Error('Invalid base45 character');
    if (i + 2 < text.length) {
      const e = DECODE_TABLE.get(text[i + 2]!);
      if (e === undefined) throw new Error('Invalid base45 character');
      const n = c + d * 45 + e * 2025;
      if (n > 0xffff) throw new Error('Invalid base45 triplet');
      out[o++] = n >> 8;
      out[o++] = n & 0xff;
    } else {
      const n = c + d * 45;
      if (n > 0xff) throw new Error('Invalid base45 pair');
      out[o++] = n;
    }
  }
  return out;
}
