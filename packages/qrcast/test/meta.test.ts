import { describe, expect, test } from 'vitest';
import { QrcastError } from '../src/errors.js';
import { decodeMeta, encodeMeta, MAX_META_BYTES } from '../src/envelope/meta.js';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const utf8 = (value: string) => new TextEncoder().encode(value);

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('encodeMeta', () => {
  test('writes s, t, n in order', () => {
    expect(text(encodeMeta(10, { type: 'application/json', name: 'a.json' }))).toBe(
      '{"s":10,"t":"application/json","n":"a.json"}',
    );
    expect(text(encodeMeta(10, { name: 'a.json', type: 'application/json' }))).toBe(
      '{"s":10,"t":"application/json","n":"a.json"}',
    );
  });

  test('omits absent hints', () => {
    expect(text(encodeMeta(10, {}))).toBe('{"s":10}');
    expect(text(encodeMeta(10, { type: undefined, name: 'x' }))).toBe('{"s":10,"n":"x"}');
  });

  test('accepts meta exactly at the cap', () => {
    const overhead = '{"s":1,"n":""}'.length;
    const name = 'a'.repeat(MAX_META_BYTES - overhead);
    expect(encodeMeta(1, { name }).length).toBe(MAX_META_BYTES);
  });

  test('rejects meta over the cap with size and limit', () => {
    const error = caught(() => encodeMeta(1, { name: 'a'.repeat(5000) }));
    expect(error).toBeInstanceOf(QrcastError);
    expect(error).toMatchObject({
      code: 'invalid-input',
      details: { reason: 'meta-too-large', size: 5014, limit: 4096 },
    });
  });

  test('counts UTF-8 bytes, not characters', () => {
    // 1400 three-byte characters: 4200 bytes of name.
    const error = caught(() => encodeMeta(1, { name: '測'.repeat(1400) }));
    expect(error).toMatchObject({ details: { reason: 'meta-too-large' } });
  });

  test.each([
    ['type', 42],
    ['name', null],
  ])('rejects a non-string %s', (field, value) => {
    const error = caught(() => encodeMeta(1, { [field]: value } as never));
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'meta-field' } });
  });
});

describe('decodeMeta', () => {
  test('maps wire keys to readable names', () => {
    expect(decodeMeta(utf8('{"s":10,"t":"text/plain","n":"note.txt"}'))).toEqual({
      size: 10,
      type: 'text/plain',
      name: 'note.txt',
    });
  });

  test('drops unknown keys', () => {
    expect(decodeMeta(utf8('{"s":3,"x":"future"}'))).toEqual({ size: 3 });
  });

  test('round trips with encodeMeta', () => {
    const hints = { type: 'text/plain; charset=utf-8', name: 'ノート "1".txt' };
    expect(decodeMeta(encodeMeta(7, hints))).toEqual({ size: 7, ...hints });
  });

  test.each([
    ['not JSON', utf8('{"s":')],
    ['an array', utf8('[3]')],
    ['null', utf8('null')],
    ['a number', utf8('3')],
    ['missing s', utf8('{"t":"text/plain"}')],
    ['negative s', utf8('{"s":-1}')],
    ['fractional s', utf8('{"s":1.5}')],
    ['unsafe s', utf8('{"s":9007199254740992}')],
    ['string s', utf8('{"s":"3"}')],
    ['non-string t', utf8('{"s":3,"t":1}')],
    ['null n', utf8('{"s":3,"n":null}')],
    ['invalid UTF-8', Uint8Array.from([0x7b, 0x22, 0x73, 0x22, 0x3a, 0x31, 0x2c, 0x22, 0x6e, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])],
    ['a leading BOM', Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('{"s":1}')])],
    ['s only on the prototype', utf8('{"__proto__":{"s":1}}')],
  ])('rejects %s', (_label, bytes) => {
    const error = caught(() => decodeMeta(bytes));
    expect(error).toBeInstanceOf(QrcastError);
    expect(error).toMatchObject({ code: 'malformed-envelope', details: { reason: 'meta' } });
  });
});
