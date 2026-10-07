import { describe, expect, test } from 'vitest';
import { decodeVarint, encodeVarint } from '../src/envelope/varint.js';

const cases: Array<[number, number[]]> = [
  [0, [0x00]],
  [7, [0x07]],
  [127, [0x7f]],
  [128, [0x80, 0x01]],
  [200, [0xc8, 0x01]],
  [4096, [0x80, 0x20]],
  [16384, [0x80, 0x80, 0x01]],
  [2 ** 53 - 1, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f]],
];

describe('encodeVarint', () => {
  test.each(cases)('%i', (value, bytes) => {
    expect([...encodeVarint(value)]).toEqual(bytes);
  });

  test.each([-1, 1.5, Number.NaN, 2 ** 53])('rejects %d', (value) => {
    expect(() => encodeVarint(value)).toThrow(RangeError);
  });
});

describe('decodeVarint', () => {
  test.each(cases)('%i', (value, bytes) => {
    expect(decodeVarint(Uint8Array.from(bytes), 0)).toEqual({
      ok: true,
      value,
      length: bytes.length,
    });
  });

  test('reads at an offset and ignores what follows', () => {
    expect(decodeVarint(Uint8Array.from([0xaa, 0xc8, 0x01, 0xff]), 1)).toEqual({
      ok: true,
      value: 200,
      length: 2,
    });
  });

  test('rejects a non-minimal form', () => {
    expect(decodeVarint(Uint8Array.from([0x87, 0x00]), 0)).toEqual({
      ok: false,
      reason: 'non-minimal',
    });
    expect(decodeVarint(Uint8Array.from([0x80, 0x80, 0x00]), 0)).toEqual({
      ok: false,
      reason: 'non-minimal',
    });
  });

  test('rejects truncated input', () => {
    expect(decodeVarint(new Uint8Array(0), 0)).toEqual({ ok: false, reason: 'truncated' });
    expect(decodeVarint(Uint8Array.from([0x80]), 0)).toEqual({ ok: false, reason: 'truncated' });
  });

  test('rejects more than 8 bytes', () => {
    expect(decodeVarint(new Uint8Array(9).fill(0xff), 0)).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });
});
