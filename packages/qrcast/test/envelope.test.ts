import { deflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { QrcastError } from '../src/errors.js';
import { unwrapEnvelope, wrapEnvelope } from '../src/envelope/envelope.js';
import { fromHex, hex, randomBytes, rejection } from './helpers.js';

const MAGIC = [0x51, 0x52, 0x43, 0x41, 0x53, 0x54];
const utf8 = (value: string) => new TextEncoder().encode(value);

/** Builds an envelope by hand, so each field can be made invalid. */
function envelope(parts: {
  version?: number;
  flags?: number;
  metaLength?: number[];
  meta?: string | Uint8Array;
  body?: Uint8Array | number[];
}): Uint8Array {
  const meta = typeof parts.meta === 'string' ? utf8(parts.meta) : (parts.meta ?? utf8('{"s":0}'));
  return Uint8Array.from([
    ...MAGIC,
    parts.version ?? 1,
    parts.flags ?? 0,
    ...(parts.metaLength ?? [meta.length]),
    ...meta,
    ...(parts.body ?? []),
  ]);
}

async function expectFailure(
  input: Uint8Array,
  code: QrcastError['code'],
  details: Record<string, unknown>,
): Promise<void> {
  const error = await rejection(unwrapEnvelope(input));
  expect(error).toBeInstanceOf(QrcastError);
  expect(error).toMatchObject({ code, details });
}

describe('wrapEnvelope golden vectors', () => {
  test('body 01 02 03 without hints', async () => {
    expect(hex(await wrapEnvelope(Uint8Array.of(1, 2, 3)))).toBe(
      '5152434153540100077b2273223a337d010203',
    );
  });

  test('body 01 02 03 with type and name', async () => {
    const bytes = await wrapEnvelope(Uint8Array.of(1, 2, 3), { type: 'text/plain', name: 'a.txt' });
    expect(hex(bytes)).toBe(
      '5152434153540100247b2273223a332c2274223a22746578742f706c61696e222c226e223a22612e747874227d010203',
    );
  });

  test('empty body', async () => {
    expect(hex(await wrapEnvelope(new Uint8Array(0)))).toBe('5152434153540100077b2273223a307d');
  });

  test('a two-byte meta length', async () => {
    // {"s":1,"n":"…"} with a 186-character name is 200 bytes of meta.
    const bytes = await wrapEnvelope(Uint8Array.of(9), { name: 'a'.repeat(186) });
    expect([...bytes.subarray(8, 10)]).toEqual([0xc8, 0x01]);
  });
});

describe('wrapEnvelope compression', () => {
  const zeros = new Uint8Array(10_000);

  test('keeps a smaller compressed body and sets flags bit 0', async () => {
    const bytes = await wrapEnvelope(zeros, { compress: true });
    expect(bytes[7]).toBe(0x01);
    expect(bytes.length).toBeLessThan(10_000);
    expect(new TextDecoder().decode(bytes.subarray(9, 9 + bytes[8]!))).toBe('{"s":10000}');
  });

  test('sends an incompressible body as is', async () => {
    const random = randomBytes(10_000, 7);
    const bytes = await wrapEnvelope(random, { compress: true });
    expect(bytes[7]).toBe(0x00);
    expect(bytes.subarray(bytes.length - 10_000)).toEqual(random);
  });

  test('does not compress unless asked', async () => {
    const bytes = await wrapEnvelope(zeros);
    expect(bytes[7]).toBe(0x00);
    expect(bytes.length).toBe(9 + '{"s":10000}'.length + 10_000);
  });
});

describe('wrapEnvelope input validation', () => {
  test('rejects a body that is not a Uint8Array', async () => {
    const error = await rejection(wrapEnvelope([1, 2, 3] as unknown as Uint8Array));
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'body' } });
  });

  test('rejects a name that is not a string', async () => {
    const error = await rejection(
      wrapEnvelope(Uint8Array.of(1), { name: 42 as unknown as string }),
    );
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'meta-field' } });
  });

  test('rejects a meta over 4096 bytes before compressing', async () => {
    const error = await rejection(
      wrapEnvelope(new Uint8Array(10), { name: 'a'.repeat(5000), compress: true }),
    );
    expect(error).toMatchObject({
      code: 'invalid-input',
      details: { reason: 'meta-too-large', limit: 4096 },
    });
    expect((error as QrcastError & { details: { size: number } }).details.size).toBeGreaterThan(4096);
  });
});

describe('unwrapEnvelope', () => {
  test('returns the body and meta', async () => {
    const result = await unwrapEnvelope(
      await wrapEnvelope(Uint8Array.of(5, 6), { type: 'text/plain', name: 'note.txt' }),
    );
    expect(result).toEqual({
      kind: 'qrcast',
      meta: { size: 2, type: 'text/plain', name: 'note.txt' },
      bytes: Uint8Array.of(5, 6),
    });
  });

  test('returns an empty body', async () => {
    expect(await unwrapEnvelope(fromHex('5152434153540100077b2273223a307d'))).toEqual({
      kind: 'qrcast',
      meta: { size: 0 },
      bytes: new Uint8Array(0),
    });
  });

  test('ignores unknown meta keys', async () => {
    const result = await unwrapEnvelope(envelope({ meta: '{"s":3,"x":"future"}', body: [1, 2, 3] }));
    expect(result.meta).toEqual({ size: 3 });
  });

  test('does not alias the input buffer', async () => {
    const input = envelope({ meta: '{"s":2}', body: [1, 2] });
    const result = await unwrapEnvelope(input);
    input[input.length - 1] = 99;
    expect(result.bytes).toEqual(Uint8Array.of(1, 2));
  });

  test('accepts a Node Buffer', async () => {
    const result = await unwrapEnvelope(Buffer.from(envelope({ meta: '{"s":1}', body: [7] })));
    expect(result.bytes).toEqual(Uint8Array.of(7));
  });
});

describe('unwrapEnvelope rejects unsupported formats', () => {
  test('a foreign payload, reporting its leading bytes', async () => {
    await expectFailure(fromHex('89504e470d0a1a0a0000'), 'unsupported-format', {
      reason: 'magic',
      value: '89504e470d0a',
    });
  });

  test('input shorter than the magic', async () => {
    await expectFailure(Uint8Array.of(0x51, 0x52, 0x43), 'unsupported-format', {
      reason: 'magic',
      value: '515243',
    });
  });

  test('empty input', async () => {
    await expectFailure(new Uint8Array(0), 'unsupported-format', { reason: 'magic', value: '' });
  });

  test('an old GQ prefix', async () => {
    await expectFailure(fromHex('47513200000000'), 'unsupported-format', {
      reason: 'magic',
      value: '475132000000',
    });
  });

  test('a future version', async () => {
    await expectFailure(envelope({ version: 2 }), 'unsupported-format', {
      reason: 'version',
      value: 2,
    });
  });

  test('version 0', async () => {
    await expectFailure(envelope({ version: 0 }), 'unsupported-format', {
      reason: 'version',
      value: 0,
    });
  });

  test.each([0x02, 0x80, 0xff])('reserved flag bits (0x%s)', async (flags) => {
    await expectFailure(envelope({ flags }), 'unsupported-format', {
      reason: 'flags',
      value: flags,
    });
  });

  test('reports the version before the flags', async () => {
    await expectFailure(envelope({ version: 2, flags: 0x80 }), 'unsupported-format', {
      reason: 'version',
      value: 2,
    });
  });

  test('a meta length above 4096, without reading the meta', async () => {
    // 5000 = 0x88 0x27; no meta bytes follow.
    await expectFailure(envelope({ metaLength: [0x88, 0x27], meta: '' }), 'unsupported-format', {
      reason: 'meta-length',
      value: 5000,
    });
  });
});

describe('unwrapEnvelope rejects malformed envelopes', () => {
  test.each([
    ['after the magic', Uint8Array.from(MAGIC)],
    ['after the version', Uint8Array.from([...MAGIC, 1])],
    ['after the flags', Uint8Array.from([...MAGIC, 1, 0])],
    ['inside the meta length', Uint8Array.from([...MAGIC, 1, 0, 0x80])],
    ['inside the meta', Uint8Array.from([...MAGIC, 1, 0, 7, ...utf8('{"s":')])],
  ])('truncated %s', async (_label, input) => {
    await expectFailure(input, 'malformed-envelope', { reason: 'truncated' });
  });

  test('a non-minimal meta length', async () => {
    await expectFailure(
      envelope({ metaLength: [0x87, 0x00], meta: '{"s":3}', body: [1, 2, 3] }),
      'malformed-envelope',
      { reason: 'meta-length' },
    );
  });

  test('an over-long meta length', async () => {
    await expectFailure(
      envelope({ metaLength: [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00] }),
      'malformed-envelope',
      { reason: 'meta-length' },
    );
  });

  test.each([
    ['not an object', '[3]'],
    ['missing s', '{"t":"text/plain"}'],
    ['a non-string name', '{"s":0,"n":1}'],
    ['not JSON', '{"s":0'],
  ])('meta %s', async (_label, meta) => {
    await expectFailure(envelope({ meta }), 'malformed-envelope', { reason: 'meta' });
  });

  test('meta that is not UTF-8', async () => {
    await expectFailure(
      envelope({ meta: Uint8Array.from([...utf8('{"s":0,"n":"'), 0xc3, ...utf8('"}')]) }),
      'malformed-envelope',
      { reason: 'meta' },
    );
  });

  test('a body shorter than declared', async () => {
    await expectFailure(
      envelope({ meta: '{"s":10}', body: new Uint8Array(9) }),
      'malformed-envelope',
      { reason: 'body-size' },
    );
  });

  test('a body longer than declared', async () => {
    await expectFailure(
      envelope({ meta: '{"s":10}', body: new Uint8Array(11) }),
      'malformed-envelope',
      { reason: 'body-size' },
    );
  });

  test('a compressed body that inflates to less than declared', async () => {
    await expectFailure(
      envelope({ flags: 1, meta: '{"s":100}', body: deflateRawSync(new Uint8Array(50)) }),
      'malformed-envelope',
      { reason: 'body-size' },
    );
  });

  test('a decompression bomb', async () => {
    await expectFailure(
      envelope({ flags: 1, meta: '{"s":100}', body: deflateRawSync(new Uint8Array(100 * 1024 * 1024)) }),
      'malformed-envelope',
      { reason: 'body-size' },
    );
  });

  test('a corrupt compressed body', async () => {
    await expectFailure(
      envelope({ flags: 1, meta: '{"s":10}', body: [0xff, 0xff, 0xff, 0xff] }),
      'malformed-envelope',
      { reason: 'compressed-body' },
    );
  });
});
