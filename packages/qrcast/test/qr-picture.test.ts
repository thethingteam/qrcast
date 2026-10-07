import { describe, expect, test } from 'vitest';
import { FountainEncoder, frameIndexAt } from '../src/codecs/qr/fountain.js';
import { chooseVersion, encodeFrameText, pictureGeometry, renderPicture } from '../src/codecs/qr/picture.js';
import { channel, readQr } from './zxing.js';

const bytes = (length: number, seed = 1) => Uint8Array.from({ length }, (_, i) => (i * 37 + seed * 11) & 0xff);

describe('qrcodegen', () => {
  test('zxing reads back alphanumeric frame text at level L with a forced version', async () => {
    const encoder = new FountainEncoder(bytes(8000), 800, 'K3Z9QA');
    const version = chooseVersion(encoder);
    for (const position of [0, 4, 5, 12]) {
      const text = encoder.textAtPosition(position);
      const qr = encodeFrameText(text, version);
      expect(qr.version).toBe(version);
      expect(qr.errorCorrectionLevel.ordinal).toBe(0);
      const { scale, side } = pictureGeometry(qr.size);
      const data = new Uint8ClampedArray(side * side * 4).fill(255);
      for (let y = 0; y < qr.size * scale; y++)
        for (let x = 0; x < qr.size * scale; x++)
          if (qr.getModule(Math.floor(x / scale), Math.floor(y / scale))) {
            const o = ((y + 4 * scale) * side + x + 4 * scale) * 4;
            data[o] = data[o + 1] = data[o + 2] = 0;
          }
      expect(await readQr({ width: side, height: side, data })).toEqual([text]);
    }
  });
});

describe('version choice', () => {
  test('the first and a much later pass encode at the chosen version', () => {
    const encoder = new FountainEncoder(bytes(8000), 800, 'K3Z9QA');
    const version = chooseVersion(encoder);
    // Repair indexes of later passes need up to 5 digits at this size; the
    // version is chosen for 8.
    for (const position of [0, 5, 11 * 10 ** 4]) {
      expect(encoder.textAtPosition(position).length).toBeLessThanOrEqual(encoder.textAt(0).length + 7);
      expect(encodeFrameText(encoder.textAtPosition(position), version).version).toBe(version);
    }
    expect(encoder.textAt(100_000).split('/')[2]!.length).toBeGreaterThanOrEqual(4);
  });

  test('is the smallest version for an 8-digit index', () => {
    const encoder = new FountainEncoder(bytes(300), 100, 'K3Z9QA');
    const version = chooseVersion(encoder);
    const longest = encoder.textAt(0).replace('/0/', '/ZZZZZZZZ/');
    expect(encodeFrameText(longest, version).version).toBe(version);
    if (version > 1) expect(() => encodeFrameText(longest, version - 1)).toThrow();
  });
});

describe('pictures', () => {
  const encoder = new FountainEncoder(bytes(8000), 800, 'K3Z9QA');
  const version = chooseVersion(encoder);

  test('size: square, at most 1024, with a whole number of pixels per module', () => {
    const picture = renderPicture(encoder, version, 1, 0);
    const modules = version * 4 + 17;
    const { scale } = pictureGeometry(modules);
    expect(picture.width).toBe(picture.height);
    expect(picture.width).toBeLessThanOrEqual(1024);
    expect(picture.width).toBe((modules + 8) * scale);
    expect(scale).toBe(Math.max(1, Math.floor(1024 / (modules + 8))));
    expect(picture.data.length).toBe(picture.width * picture.height * 4);
  });

  test('scale is at least 1 pixel', () => {
    expect(pictureGeometry(177).scale).toBe(5);
    expect(pictureGeometry(2000).scale).toBe(1);
  });

  test('black and white decodes as one frame per picture, in schedule order', async () => {
    for (const k of [0, 1, 2]) {
      const picture = renderPicture(encoder, version, 1, k);
      expect(await readQr(picture)).toEqual([encoder.textAtPosition(k)]);
    }
  });

  test('quiet zone: white border of 4 modules', () => {
    const picture = renderPicture(encoder, version, 3, 0);
    const { scale, side } = pictureGeometry(version * 4 + 17);
    const white = (x: number, y: number) => [0, 1, 2].every((c) => picture.data[(y * side + x) * 4 + c] === 255);
    for (let i = 0; i < side; i++) {
      for (let d = 0; d < 4 * scale; d++) {
        expect(white(i, d) && white(i, side - 1 - d) && white(d, i) && white(side - 1 - d, i)).toBe(true);
      }
    }
    expect(picture.data[3]).toBe(255);
  });

  test('color: each channel reads as its own frame', async () => {
    const picture = renderPicture(encoder, version, 3, 2);
    for (const c of [0, 1, 2] as const) {
      expect(await readQr(channel(picture, c))).toEqual([encoder.textAtPosition(6 + c)]);
    }
  });

  test('channel values: dark in red and blue only gives pure green', () => {
    const picture = renderPicture(encoder, version, 3, 0);
    const modules = version * 4 + 17;
    const { scale } = pictureGeometry(modules);
    const seen = new Set<string>();
    for (let my = 0; my < modules; my++)
      for (let mx = 0; mx < modules; mx++) {
        const o = (((my + 4) * scale) * picture.width + (mx + 4) * scale) * 4;
        seen.add(`${picture.data[o]},${picture.data[o + 1]},${picture.data[o + 2]}`);
      }
    for (const rgb of seen) expect(['0,0,0', '255,255,255', '0,255,0', '255,0,255', '0,255,255', '255,0,0', '255,255,0', '0,0,255']).toContain(rgb);
    expect(seen.has('0,255,0')).toBe(true);
  });

  test('a pass that is not a multiple of three continues with the next pass', async () => {
    const small = new FountainEncoder(bytes(1000, 4), 100, 'K3Z9QA'); // TOTAL 10, 13 frames per pass
    const v = chooseVersion(small);
    const picture = renderPicture(small, v, 3, 4);
    const expected = [12, 13 - 13, 1].map((_, i) => frameIndexAt(10, 12 + i));
    expect(expected).toEqual([12, 0, 1]);
    for (const c of [0, 1, 2] as const) {
      expect(await readQr(channel(picture, c))).toEqual([small.textAt(expected[c]!)]);
    }
  });
});
