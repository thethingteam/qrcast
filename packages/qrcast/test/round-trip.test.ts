import { describe, expect, test } from 'vitest';
import { unwrapEnvelope, wrapEnvelope } from '../src/envelope/envelope.js';
import { firstDifference, fromHex, randomBytes } from './helpers.js';

/**
 * A compressed envelope made once with Node's zlib (deflateRawSync). It pins
 * the decoding side; compressed output itself may differ between platforms.
 * Body: "qrcast " repeated 20 times (140 bytes), type text/plain, name
 * fixture.txt.
 */
const COMPRESSED_FIXTURE =
  '51524341535401012c7b2273223a3134302c2274223a22746578742f706c61696e222c226e223a' +
  '22666978747572652e747874227d2b2c4a4e2c2e51281c0c1400';

test('decodes the fixed compressed fixture', async () => {
  expect(await unwrapEnvelope(fromHex(COMPRESSED_FIXTURE))).toEqual({
    kind: 'qrcast',
    meta: { size: 140, type: 'text/plain', name: 'fixture.txt' },
    bytes: new TextEncoder().encode('qrcast '.repeat(20)),
  });
});

const bodies: Array<[string, Uint8Array]> = [
  ['empty', new Uint8Array(0)],
  ['one byte', Uint8Array.of(0)],
  ['1 KB of text', new TextEncoder().encode('{"type":"Feature"}'.repeat(57))],
  ['64 KB random', randomBytes(65_536, 11)],
  ['1 MB zeros', new Uint8Array(1024 * 1024)],
  ['300 KB mixed', Uint8Array.from({ length: 300_000 }, (_, i) => (i % 1000 < 500 ? 0 : i & 0xff))],
];

const hintSets = [
  {},
  { type: 'application/geo+json' },
  { name: 'map.geojson' },
  { type: 'application/octet-stream', name: 'データ 1.bin' },
];

describe.each([false, true])('round trip (compress: %s)', (compress) => {
  test.each(bodies)('%s', async (_label, body) => {
    for (const hints of hintSets) {
      const result = await unwrapEnvelope(await wrapEnvelope(body, { ...hints, compress }));
      expect(result.kind).toBe('qrcast');
      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(firstDifference(result.bytes, body)).toBe(-1);
      expect(result.meta).toEqual({ size: body.length, ...hints });
    }
  });
});
