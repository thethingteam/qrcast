import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CODEC_INTERNALS, isQrcastCodec } from '../src/internal/codec.js';
import { missingFeature, resetEnvironmentCache } from '../src/internal/environment.js';

describe('isQrcastCodec', () => {
  test('rejects a plain descriptor object', () => {
    expect(isQrcastCodec({ name: 'cimbar', maxPayloadSize: 16777216, compress: false })).toBe(false);
    expect(isQrcastCodec(null)).toBe(false);
    expect(isQrcastCodec('cimbar')).toBe(false);
  });

  test('accepts an object carrying the codec internals', () => {
    expect(isQrcastCodec({ name: 'x', maxPayloadSize: 1, compress: false, [CODEC_INTERNALS]: {} })).toBe(
      true,
    );
  });
});

describe('missingFeature', () => {
  class FakeCanvas {
    constructor(readonly gl: string | null) {}
    getContext(type: string): object | null {
      return type === this.gl ? {} : null;
    }
  }

  beforeEach(() => {
    resetEnvironmentCache();
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('VideoFrame', class {});
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends FakeCanvas {
        constructor() {
          super('webgl2');
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetEnvironmentCache();
  });

  test('returns null when every feature is there', () => {
    expect(missingFeature(['worker', 'webassembly', 'webgl', 'video-frame'])).toBeNull();
  });

  test.each([
    ['worker', 'Worker'],
    ['webassembly', 'WebAssembly'],
    ['video-frame', 'VideoFrame'],
    ['webgl', 'OffscreenCanvas'],
  ] as const)('reports %s when %s is missing', (feature, global) => {
    vi.stubGlobal(global, undefined);
    expect(missingFeature(['worker', 'webassembly', 'webgl', 'video-frame'])).toBe(feature);
  });

  test('reports webgl when OffscreenCanvas has no WebGL context', () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends FakeCanvas {
        constructor() {
          super(null);
        }
      },
    );
    expect(missingFeature(['webgl'])).toBe('webgl');
  });

  test('accepts WebGL 1 when WebGL 2 is missing', () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends FakeCanvas {
        constructor() {
          super('webgl');
        }
      },
    );
    expect(missingFeature(['webgl'])).toBeNull();
  });

  test('checks only the features asked for, in order', () => {
    vi.stubGlobal('VideoFrame', undefined);
    vi.stubGlobal('Worker', undefined);
    expect(missingFeature(['webassembly', 'video-frame', 'worker'])).toBe('video-frame');
    expect(missingFeature(['webassembly'])).toBeNull();
  });
});
