/** Seeded xorshift32 bytes: reproducible, effectively incompressible test data. */
export function randomBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** Resolves to the rejection reason; fails the test if the promise resolves. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

/**
 * Index of the first byte where `a` and `b` differ, or -1 when they are equal.
 * Much faster than `toEqual` on large arrays.
 */
export function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : length;
}
