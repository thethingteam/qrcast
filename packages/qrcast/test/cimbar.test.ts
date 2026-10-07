import { describe, expect, test, vi } from 'vitest';
import { cimbar } from '../src/codecs/cimbar/index.js';
import { resolveOptions } from '../src/codecs/cimbar/options.js';
import { QrcastError } from '../src/errors.js';
import { CODEC_INTERNALS, isQrcastCodec } from '../src/internal/codec.js';

const loads = vi.hoisted(() => ({ modules: [] as string[] }));
vi.mock('../src/codecs/cimbar/sender-driver.js', () => {
  loads.modules.push('sender-driver');
  return {};
});
vi.mock('../src/codecs/cimbar/receiver-driver.js', () => {
  loads.modules.push('receiver-driver');
  return {};
});
vi.mock('../src/codecs/cimbar/runtime.js', () => {
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

describe('cimbar descriptor', () => {
  test.each([undefined, { mode: 'Bm' as const }, { mode: '4C' as const, fps: 30 }])(
    'has the cimbar values (%o)',
    (options) => {
      const codec = cimbar(options);
      expect(codec.name).toBe('cimbar');
      expect(codec.maxPayloadSize).toBe(16777216);
      expect(codec.compress).toBe(false);
      expect(isQrcastCodec(codec)).toBe(true);
      expect(Object.isFrozen(codec)).toBe(true);
    },
  );

  test('declares the browser features each role needs', () => {
    const internals = cimbar()[CODEC_INTERNALS];
    expect(internals.sendFeatures).toEqual(['worker', 'webassembly', 'webgl']);
    expect(internals.receiveFeatures).toEqual(['worker', 'webassembly', 'video-frame']);
  });

  test('creating the codec loads no driver or runtime module', () => {
    cimbar({ mode: 'B', fps: 10, glueUrl: '/a.js', wasmUrl: new URL('https://example.test/a.wasm') });
    expect(loads.modules).toEqual([]);
  });
});

describe('cimbar options', () => {
  test.each([
    ['an unknown mode', { mode: '8C' }],
    ['a mode in the wrong case', { mode: 'b' }],
    ['fps 0', { fps: 0 }],
    ['fps 31', { fps: 31 }],
    ['fps NaN', { fps: Number.NaN }],
    ['fps as a string', { fps: '15' }],
    ['a numeric glueUrl', { glueUrl: 1 }],
    ['a null wasmUrl', { wasmUrl: null }],
    ['a workerFactory that is not a function', { workerFactory: {} }],
  ])('rejects %s', (_label, options) => {
    const error = optionError(() => cimbar(options as never));
    expect(error).toBeInstanceOf(QrcastError);
    expect(error).toMatchObject({ code: 'invalid-input', details: { reason: 'option' } });
  });

  test('rejects options that are not an object', () => {
    expect(optionError(() => cimbar('B' as never))).toMatchObject({
      code: 'invalid-input',
      details: { reason: 'option' },
    });
  });

  test('defaults: mode B and 15 fps for sending, detection for receiving', () => {
    expect(resolveOptions(undefined)).toEqual({
      sendMode: 68,
      receiveMode: null,
      fps: 15,
      glueUrl: null,
      wasmUrl: null,
      workerFactory: null,
    });
  });

  test('a mode fixes both roles', () => {
    expect(resolveOptions({ mode: '4C' })).toMatchObject({ sendMode: 4, receiveMode: 4 });
    expect(resolveOptions({ mode: 'Bu' })).toMatchObject({ sendMode: 66, receiveMode: 66 });
  });

  test('accepts fps from 1 to 30, fractions included', () => {
    expect(resolveOptions({ fps: 1 }).fps).toBe(1);
    expect(resolveOptions({ fps: 7.5 }).fps).toBe(7.5);
    expect(resolveOptions({ fps: 30 }).fps).toBe(30);
  });

  test('URLs become strings', () => {
    const resolved = resolveOptions({ glueUrl: new URL('https://example.test/g.js'), wasmUrl: '/w.wasm' });
    expect(resolved.glueUrl).toBe('https://example.test/g.js');
    expect(resolved.wasmUrl).toBe('/w.wasm');
  });
});
