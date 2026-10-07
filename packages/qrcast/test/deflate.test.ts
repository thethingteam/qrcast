import { deflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { QrcastError } from '../src/errors.js';
import { deflateRaw, inflateRawBounded } from '../src/envelope/deflate.js';
import { randomBytes, rejection } from './helpers.js';

describe('deflateRaw', () => {
  test('round trips through inflateRawBounded', async () => {
    const input = new TextEncoder().encode('hello qrcast '.repeat(1000));
    const compressed = await deflateRaw(input);
    expect(compressed.length).toBeLessThan(input.length);
    expect(await inflateRawBounded(compressed, input.length)).toEqual(input);
  });

  test('round trips random data larger than one input slice', async () => {
    const input = randomBytes(100_000, 1);
    expect(await inflateRawBounded(await deflateRaw(input), input.length)).toEqual(input);
  });

  test('handles empty input', async () => {
    const compressed = await deflateRaw(new Uint8Array(0));
    expect(await inflateRawBounded(compressed, 0)).toEqual(new Uint8Array(0));
  });

  test('produces data that Node zlib reads as raw DEFLATE', async () => {
    const { inflateRawSync } = await import('node:zlib');
    const input = randomBytes(5000, 2);
    expect(new Uint8Array(inflateRawSync(await deflateRaw(input)))).toEqual(input);
  });
});

describe('inflateRawBounded', () => {
  test('returns output exactly at the limit', async () => {
    const input = new Uint8Array(1000).fill(7);
    expect(await inflateRawBounded(deflateRawSync(input), 1000)).toEqual(input);
  });

  test('returns shorter output as is (the caller checks the size)', async () => {
    const input = new Uint8Array(10).fill(7);
    expect((await inflateRawBounded(deflateRawSync(input), 1000)).length).toBe(10);
  });

  test('stops a decompression bomb with body-size', async () => {
    // 100 MB of zeros compresses to about 100 KB.
    const bomb = deflateRawSync(new Uint8Array(100 * 1024 * 1024));
    const before = process.memoryUsage().arrayBuffers;
    const error = await rejection(inflateRawBounded(bomb, 100));
    expect(error).toBeInstanceOf(QrcastError);
    expect(error).toMatchObject({ code: 'malformed-envelope', details: { reason: 'body-size' } });
    // The full output would add 100 MB; stopping early keeps growth small.
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(20 * 1024 * 1024);
  });

  test.each([
    ['corrupt data', Uint8Array.from([0xff, 0xff, 0xff, 0xff])],
    ['truncated data', deflateRawSync(randomBytes(1000, 3)).subarray(0, 500)],
  ])('rejects %s with compressed-body and keeps the cause', async (_label, bytes) => {
    const error = await rejection(inflateRawBounded(new Uint8Array(bytes), 10_000));
    expect(error).toBeInstanceOf(QrcastError);
    expect(error).toMatchObject({
      code: 'malformed-envelope',
      details: { reason: 'compressed-body' },
    });
    expect((error as Error).cause).toBeDefined();
  });
});
