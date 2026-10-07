/** Seeded xorshift32 bytes: reproducible, effectively incompressible test data. */
export function randomBody(seed: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

export function randomName(seed: number, size: number): string {
  return `qrcast-random-${seed}-${size}.bin`;
}

/** The seed and size encoded in a random body's name, or null. */
export function parseRandomName(name: string): { seed: number; size: number } | null {
  const match = /^qrcast-random-(\d+)-(\d+)\.bin$/.exec(name);
  return match ? { seed: Number(match[1]), size: Number(match[2]) } : null;
}

export function describeError(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    return `${String(error.code)}: ${error.message} ${JSON.stringify((error as { details?: unknown }).details)}`;
  }
  return String(error);
}
