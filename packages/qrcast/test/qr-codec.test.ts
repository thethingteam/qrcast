import { describe, expect, test, vi } from 'vitest';
import { qr } from '../src/codecs/qr/index.js';
import { resolveOptions } from '../src/codecs/qr/options.js';
import { QrcastError } from '../src/errors.js';
import { CODEC_INTERNALS, isQrcastCodec } from '../src/internal/codec.js';

const loads = vi.hoisted(() => ({ modules: [] as string[] }));
vi.mock('../src/codecs/qr/sender-driver.js', () => {
  loads.modules.push('sender-driver');
  return {};
});
vi.mock('../src/codecs/qr/receiver-driver.js', () => {
  loads.modules.push('receiver-driver');
  return {};
});
vi.mock('../src/codecs/qr/runtime.js', () => {
  loads.modules.push('runtime');
  return {};
});

function optionError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

describe('qr descriptor', () => {
  test('default descriptor', () => {
    const codec = qr();
    expect(codec.name).toBe('qr');
    expect(codec.maxPayloadSize).toBe(4_000_000);
    expect(codec.compress).toBe(true);
    expect(isQrcastCodec(codec)).toBe(true);
    expect(Object.isFrozen(codec)).toBe(true);
  });

  test('smaller blocks lower the limit', () => {
    expect(qr({ blockSize: 100 }).maxPayloadSize).toBe(500_000);
    expect(qr({ blockSize: 2000 }).maxPayloadSize).toBe(10_000_000);
  });

  test('needs no browser feature to send, and three to receive', () => {
    const internals = qr()[CODEC_INTERNALS];
    expect(internals.sendFeatures).toEqual([]);
    expect(internals.receiveFeatures).toEqual(['worker', 'webassembly', 'video-frame']);
  });

  test('creating the codec loads no driver or runtime module', () => {
    qr({ layers: 3, blockSize: 500, fps: 10, glueUrl: '/a.js', wasmUrl: new URL('https://example.test/a.wasm') });
    expect(loads.modules).toEqual([]);
  });
});

describe('qr options', () => {
  test.each([
    ['layers 2', { layers: 2 }],
    ['layers as a string', { layers: '1' }],
    ['blockSize 50', { blockSize: 50 }],
    ['blockSize 2001', { blockSize: 2001 }],
    ['a fractional blockSize', { blockSize: 800.5 }],
    ['fps 0', { fps: 0 }],
    ['fps 31', { fps: 31 }],
    ['fps NaN', { fps: Number.NaN }],
    ['a numeric glueUrl', { glueUrl: 1 }],
    ['a null wasmUrl', { wasmUrl: null }],
    ['a workerFactory that is not a function', { workerFactory: {} }],
  ])('rejects %s', (_label, options) => {
    const error = optionError(() => qr(options as never));
    expect(error).toBeInstanceOf(QrcastError);
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'option' } });
  });

  test('rejects options that are not an object', () => {
    expect(optionError(() => qr(5 as never))).toMatchObject({ code: 'invalid-input', details: { reason: 'option' } });
  });

  test('defaults: one layer, 800-byte blocks, 15 fps', () => {
    expect(resolveOptions(undefined)).toEqual({
      layers: 1,
      blockSize: 800,
      fps: 15,
      glueUrl: null,
      wasmUrl: null,
      workerFactory: null,
    });
  });

  test('accepts the limits and URL objects', () => {
    const factory = () => ({}) as Worker;
    expect(
      resolveOptions({ layers: 3, blockSize: 100, fps: 30, glueUrl: new URL('https://x.test/g.js'), wasmUrl: '/w.wasm', workerFactory: factory }),
    ).toEqual({ layers: 3, blockSize: 100, fps: 30, glueUrl: 'https://x.test/g.js', wasmUrl: '/w.wasm', workerFactory: factory });
    expect(resolveOptions({ blockSize: 2000, fps: 1 })).toMatchObject({ blockSize: 2000, fps: 1 });
  });
});
