import { describe, expect, test, vi } from 'vitest';
import { prepareTransfer, type CodecDescriptor } from '../src/codec.js';
import { unwrapEnvelope, wrapEnvelope } from '../src/envelope/envelope.js';
import { QrcastError } from '../src/errors.js';
import { randomBytes, rejection } from './helpers.js';

/** A stand-in for a real codec, recording what the sender hands it. */
function testCodec(overrides: Partial<CodecDescriptor> = {}) {
  const encode = vi.fn<(envelope: Uint8Array) => void>();
  const codec = { name: 'test', maxPayloadSize: 1_000_000, compress: false, ...overrides, encode };
  return { codec, encode };
}

/** The sender's order of work: prepare first, then hand the envelope over. */
async function send(body: Uint8Array, codec: CodecDescriptor & { encode(e: Uint8Array): void }) {
  codec.encode(await prepareTransfer(body, {}, codec));
}

describe('compression follows the codec', () => {
  const zeros = new Uint8Array(10_000);

  test('a codec without compression gets the original body', async () => {
    const envelope = await prepareTransfer(zeros, {}, testCodec({ compress: false }).codec);
    expect(envelope[7]).toBe(0x00);
    expect(envelope.length).toBe(9 + '{"s":10000}'.length + 10_000);
  });

  test('a codec with compression gets a compressed body', async () => {
    const envelope = await prepareTransfer(zeros, {}, testCodec({ compress: true }).codec);
    expect(envelope[7]).toBe(0x01);
  });

  test('hints reach the envelope', async () => {
    const envelope = await prepareTransfer(
      Uint8Array.of(1),
      { type: 'text/plain', name: 'a.txt' },
      testCodec().codec,
    );
    expect((await unwrapEnvelope(envelope)).meta).toEqual({
      size: 1,
      type: 'text/plain',
      name: 'a.txt',
    });
  });
});

describe('size check before encoding', () => {
  test('an envelope over the limit fails and the codec receives nothing', async () => {
    const { codec, encode } = testCodec({ maxPayloadSize: 1000 });
    const body = randomBytes(2000, 5);
    const error = await rejection(send(body, codec));
    expect(error).toBeInstanceOf(QrcastError);
    expect(error).toMatchObject({
      code: 'payload-too-large',
      details: { size: 9 + '{"s":2000}'.length + 2000, limit: 1000, codec: 'test' },
    });
    expect(encode).not.toHaveBeenCalled();
  });

  test('an envelope exactly at the limit passes', async () => {
    const body = randomBytes(500, 6);
    const size = (await wrapEnvelope(body)).length;
    const { codec, encode } = testCodec({ maxPayloadSize: size });
    await send(body, codec);
    expect(encode).toHaveBeenCalledOnce();
    expect(encode.mock.calls[0]![0].length).toBe(size);
  });

  test('one byte over the limit fails', async () => {
    const body = randomBytes(500, 6);
    const size = (await wrapEnvelope(body)).length;
    const error = await rejection(prepareTransfer(body, {}, testCodec({ maxPayloadSize: size - 1 }).codec));
    expect(error).toMatchObject({ code: 'payload-too-large', details: { size, limit: size - 1 } });
  });

  test('the limit applies to the compressed envelope', async () => {
    const codec = testCodec({ compress: true, maxPayloadSize: 1000 }).codec;
    const envelope = await prepareTransfer(new Uint8Array(10_000), {}, codec);
    expect(envelope.length).toBeLessThanOrEqual(1000);
  });

  test('input errors win over the size check', async () => {
    const error = await rejection(
      prepareTransfer(new Uint8Array(10), { name: 'a'.repeat(5000) }, testCodec({ maxPayloadSize: 1 }).codec),
    );
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'meta-too-large' } });
  });
});

describe('invalid codec descriptors', () => {
  test.each<[string, Partial<Record<keyof CodecDescriptor, unknown>>]>([
    ['a zero limit', { maxPayloadSize: 0 }],
    ['a negative limit', { maxPayloadSize: -1 }],
    ['a fractional limit', { maxPayloadSize: 1.5 }],
    ['an infinite limit', { maxPayloadSize: Number.POSITIVE_INFINITY }],
    ['a string limit', { maxPayloadSize: '1000' }],
    ['an empty name', { name: '' }],
    ['a missing name', { name: undefined }],
    ['a non-boolean compress', { compress: 'yes' }],
  ])('%s', async (_label, overrides) => {
    const codec = { ...testCodec().codec, ...overrides } as unknown as CodecDescriptor;
    const error = await rejection(prepareTransfer(Uint8Array.of(1), {}, codec));
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'codec' } });
  });

  test('a codec that is not an object', async () => {
    const error = await rejection(prepareTransfer(Uint8Array.of(1), {}, null as unknown as CodecDescriptor));
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'codec' } });
  });
});
