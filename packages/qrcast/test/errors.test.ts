import { describe, expect, expectTypeOf, test } from 'vitest';
import { QrcastError, type ErrorDetails } from '../src/errors.js';

describe('QrcastError', () => {
  test('is an Error with name, code, details and message', () => {
    const error = new QrcastError(
      'payload-too-large',
      { size: 1210, limit: 1000, codec: 'qr' },
      'Envelope is 1210 bytes; codec qr carries at most 1000.',
    );
    expect(error).toBeInstanceOf(QrcastError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('QrcastError');
    expect(error.code).toBe('payload-too-large');
    expect(error.details).toEqual({ size: 1210, limit: 1000, codec: 'qr' });
    expect(error.message).toBe('Envelope is 1210 bytes; codec qr carries at most 1000.');
    expect(error.stack).toBeTypeOf('string');
  });

  test('keeps the cause', () => {
    const cause = new TypeError('incorrect header check');
    const error = new QrcastError(
      'malformed-envelope',
      { reason: 'compressed-body' },
      'Compressed body is corrupt.',
      { cause },
    );
    expect(error.cause).toBe(cause);
  });

  test('has no cause when none is given', () => {
    const error = new QrcastError('invalid-input', { reason: 'body' }, 'Body must be a Uint8Array.');
    expect('cause' in error).toBe(false);
  });
});

describe('QrcastError types', () => {
  test('instanceof plus a code check narrows details', () => {
    const error: unknown = new QrcastError(
      'payload-too-large',
      { size: 1, limit: 0, codec: 'x' },
      'too large',
    );
    if (error instanceof QrcastError && error.code === 'payload-too-large') {
      expectTypeOf(error.details).toEqualTypeOf<ErrorDetails['payload-too-large']>();
      expectTypeOf(error.details.limit).toEqualTypeOf<number>();
    } else {
      throw new Error('expected a payload-too-large QrcastError');
    }
  });

  test('a second check narrows a details union by reason', () => {
    const error: QrcastError = new QrcastError(
      'unsupported-format',
      { reason: 'magic', value: '89504e470d0a' },
      'not qrcast',
    );
    if (error.code === 'unsupported-format' && error.details.reason === 'magic') {
      expectTypeOf(error.details.value).toEqualTypeOf<string>();
    }
  });

  test('constructor ties details to the code', () => {
    // @ts-expect-error: payload-too-large details need size, limit and codec
    void new QrcastError('payload-too-large', { reason: 'body' }, 'x');
    expectTypeOf(
      new QrcastError('invalid-input', { reason: 'body' }, 'x').code,
    ).toEqualTypeOf<'invalid-input'>();
  });
});

describe('codes added for senders, receivers and codecs', () => {
  test.each([
    ['unsupported-environment', { feature: 'video-frame' }],
    ['codec-init-failed', { codec: 'cimbar' }],
    ['codec-aborted', { codec: 'cimbar', role: 'sender', size: 1000000 }],
    ['codec-aborted', { codec: 'cimbar', role: 'receiver', progress: 0.4 }],
    ['codec-aborted', { codec: 'cimbar', role: 'receiver', progress: null }],
    ['cancelled', { reason: 'destroyed' }],
    ['invalid-state', { state: 'destroyed' }],
    ['invalid-input', { reason: 'option' }],
  ] as const)('%s carries its details', (code, details) => {
    const error = new QrcastError(code, details as never, 'x');
    expect(error.code).toBe(code);
    expect(error.details).toEqual(details);
  });

  test('codec-aborted details narrow by role', () => {
    const error: QrcastError = new QrcastError(
      'codec-aborted',
      { codec: 'cimbar', role: 'receiver', progress: 0.4 },
      'aborted',
    );
    if (error.code !== 'codec-aborted') throw new Error('expected codec-aborted');
    if (error.details.role === 'sender') {
      expectTypeOf(error.details.size).toEqualTypeOf<number>();
    } else {
      expectTypeOf(error.details.progress).toEqualTypeOf<number | null>();
      // @ts-expect-error: receiver details have no size
      void error.details.size;
    }
  });

  test('details are tied to the new codes', () => {
    // @ts-expect-error: unknown feature
    void new QrcastError('unsupported-environment', { feature: 'gpu' }, 'x');
    // @ts-expect-error: a sender abort needs the envelope size
    void new QrcastError('codec-aborted', { codec: 'cimbar', role: 'sender', progress: 0 }, 'x');
    // @ts-expect-error: unknown cancel reason
    void new QrcastError('cancelled', { reason: 'timeout' }, 'x');
  });
});
