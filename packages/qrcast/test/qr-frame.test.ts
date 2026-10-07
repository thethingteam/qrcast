import { describe, expect, test } from 'vitest';
import { base45Encode } from '../src/codecs/qr/base45.js';
import { formatFrame, parseFrame, type QrFrame } from '../src/codecs/qr/frame.js';

const frame = (patch: Partial<QrFrame> = {}): QrFrame => ({
  session: 'K3Z9QA',
  index: 1,
  total: 3,
  length: 1000,
  crc32: 'CBF43926',
  payload: new Uint8Array(400).fill(7),
  ...patch,
});

describe('frame text', () => {
  test('source frame header', () => {
    const text = formatFrame(frame());
    expect(text.startsWith('QRCAST1F/K3Z9QA/1/3/RS/CBF43926/')).toBe(true);
    expect(text.slice('QRCAST1F/K3Z9QA/1/3/RS/CBF43926/'.length)).toBe(base45Encode(new Uint8Array(400).fill(7)));
  });

  test('round trips', () => {
    const original = frame({ index: 123456, payload: Uint8Array.from({ length: 400 }, (_, i) => i & 0xff) });
    expect(parseFrame(formatFrame(original))).toEqual(original);
  });

  test('a payload that contains a slash', () => {
    // Base45 of the bytes with value 2025 * 41 + ... : search for a block that yields '/'.
    let payload: Uint8Array | null = null;
    for (let a = 0; a < 256 && !payload; a++) {
      for (let b = 0; b < 256; b++) {
        const candidate = Uint8Array.of(a, b, a, b);
        if (base45Encode(candidate).includes('/')) {
          payload = candidate;
          break;
        }
      }
    }
    expect(payload).not.toBeNull();
    const original = frame({ total: 1, length: 4, payload: payload! });
    expect(formatFrame(original).split('/').length).toBeGreaterThan(7);
    expect(parseFrame(formatFrame(original))).toEqual(original);
  });

  test('fields of a transfer', () => {
    const parsed = parseFrame(formatFrame(frame({ total: 3, length: 9, payload: new Uint8Array(4) })));
    expect(parsed).toMatchObject({ total: 3, length: 9, crc32: 'CBF43926' });
    expect(parsed?.payload.length).toBe(4);
  });
});

describe('invalid frames', () => {
  const good = formatFrame(frame());
  const replaceField = (n: number, value: string) => good.split('/').map((f, i) => (i === n ? value : f)).join('/');

  test('the good frame parses', () => {
    expect(parseFrame(good)).not.toBeNull();
  });

  test.each([
    ['a URL', 'https://example.com/'],
    ['an empty text', ''],
    ['QRCAST2F', good.replace('QRCAST1F', 'QRCAST2F')],
    ['QRCAST1X', good.replace('QRCAST1F', 'QRCAST1X')],
    ['a lowercase character', good.toLowerCase()],
    ['a missing field', good.split('/').slice(0, 6).join('/')],
    ['an empty payload', good.split('/').slice(0, 6).join('/') + '/'],
    ['a short session', replaceField(1, 'K3Z9Q')],
    ['a lowercase session', replaceField(1, 'k3z9qa')],
    ['an index with leading zeros', replaceField(2, '01')],
    ['an index of nine digits', replaceField(2, '100000000')],
    ['a bad crc', replaceField(5, 'CBF4392')],
    ['TOTAL 0', replaceField(3, '0')],
    ['TOTAL 5001', replaceField(3, (5001).toString(36).toUpperCase())],
    ['LENGTH 0', replaceField(4, '0')],
    ['an invalid Base45 payload', good.split('/').slice(0, 6).join('/') + '/~~~'],
  ])('ignores %s', (_, text) => {
    expect(parseFrame(text)).toBeNull();
  });

  test('length and total disagree', () => {
    expect(parseFrame(formatFrame(frame({ total: 3, length: 2000 })))).toBeNull();
  });

  test('TOTAL 5000 is allowed', () => {
    expect(parseFrame(formatFrame(frame({ total: 5000, length: 400 * 4999 + 1 })))).not.toBeNull();
  });
});
