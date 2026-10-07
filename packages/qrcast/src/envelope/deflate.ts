import { QrcastError } from '../errors.js';

/**
 * Input is fed to the decompressor in slices of this size. DEFLATE expands at
 * most about 1032:1, so one slice yields at most a few MB before the size
 * limit is checked again.
 */
const INPUT_SLICE_BYTES = 4096;

async function collect(readable: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Writes `bytes` into `writable` in slices, then closes it. */
async function feed(writable: WritableStream<BufferSource>, bytes: Uint8Array): Promise<void> {
  const writer = writable.getWriter();
  for (let offset = 0; offset < bytes.length; offset += INPUT_SLICE_BYTES) {
    await writer.ready;
    await writer.write(bytes.slice(offset, offset + INPUT_SLICE_BYTES));
  }
  await writer.close();
}

/** Compresses `bytes` with raw DEFLATE (RFC 1951). */
export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const [chunks] = await Promise.all([collect(stream.readable), feed(stream.writable, bytes)]);
  return concat(
    chunks,
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
}

/**
 * Decompresses raw DEFLATE data, stopping as soon as the output would exceed
 * `limit` bytes. The output buffer is never sized from `limit`, because the
 * limit comes from untrusted input.
 *
 * Throws `malformed-envelope` with reason `body-size` when the output is too
 * large, and with reason `compressed-body` when the data is corrupt,
 * truncated, or followed by trailing bytes.
 */
export async function inflateRawBounded(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  // Feeding errors also error the readable side, which reports them below.
  const feeding = feed(stream.writable, bytes).catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new QrcastError(
          'malformed-envelope',
          { reason: 'body-size' },
          `Decompressed body exceeds its declared size of ${limit} bytes.`,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof QrcastError) throw error;
    throw new QrcastError(
      'malformed-envelope',
      { reason: 'compressed-body' },
      'Compressed body is not valid raw DEFLATE data.',
      { cause: error },
    );
  } finally {
    await feeding;
  }
  return concat(chunks, total);
}
