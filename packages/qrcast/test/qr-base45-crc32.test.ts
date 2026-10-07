import { describe, expect, test } from 'vitest';
import { base45Decode, base45Encode } from '../src/codecs/qr/base45.js';
import { crc32, crc32Hex } from '../src/codecs/qr/crc32.js';

const ascii = (text: string) => new TextEncoder().encode(text);

describe('base45', () => {
  test.each([
    ['AB', 'BB8'],
    ['Hello!!', '%69 VD92EX0'],
    ['base-45', 'UJCLQE7W581'],
  ])('RFC 9285 vector %s', (plain, encoded) => {
    expect(base45Encode(ascii(plain))).toBe(encoded);
    expect(base45Decode(encoded)).toEqual(ascii(plain));
  });

  test('round trips every byte value and odd lengths', () => {
    const bytes = Uint8Array.from({ length: 513 }, (_, i) => (i * 7) & 0xff);
    expect(base45Decode(base45Encode(bytes))).toEqual(bytes);
    expect(base45Decode('')).toEqual(new Uint8Array(0));
  });

  test.each([
    ['a length of 3n + 1', 'BB8A'],
    ['a character outside the alphabet', 'bb8'],
    ['a triplet above 65535', ':::'],
    ['a pair above 255', '::'],
    ['an invalid trailing character', 'BB8~~'],
  ])('rejects %s', (_, text) => {
    expect(() => base45Decode(text)).toThrow();
  });
});

describe('crc32', () => {
  test('known check value', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32Hex(ascii('123456789'))).toBe('CBF43926');
  });

  test('pads to 8 digits and handles empty input', () => {
    expect(crc32Hex(new Uint8Array(0))).toBe('00000000');
  });
});
