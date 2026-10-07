import { describe, expect, test } from 'vitest';
import { parseFrame } from '../src/codecs/qr/frame.js';
import {
  FountainEncoder,
  createSessionId,
  frameIndexAt,
  mulberry32,
  passLength,
  repairComposition,
  repairSeed,
  splitBlocks,
} from '../src/codecs/qr/fountain.js';

const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe('mulberry32', () => {
  test('first outputs from seed 0', () => {
    const next = mulberry32(0);
    expect(next()).toBe(0x4434b462);
    expect(next()).toBe(0x00159c37);
  });
});

describe('repair composition', () => {
  test('K3Z9QA frame 8 of 8', () => {
    expect(repairSeed('K3Z9QA', 8)).toBe(0xb18d40b8);
    expect(repairComposition('K3Z9QA', 8, 8)).toEqual([0, 1, 5, 6]);
  });

  test('a single block', () => {
    for (const index of [1, 2, 3, 99]) expect(repairComposition('K3Z9QA', index, 1)).toEqual([0]);
  });

  test('is never empty', () => {
    for (let index = 20; index < 400; index++) {
      expect(repairComposition('AAAAAA', index, 3).length).toBeGreaterThan(0);
    }
  });
});

describe('schedule', () => {
  test('TOTAL 10 over two passes', () => {
    expect(passLength(10)).toBe(13);
    const played = range(26, (p) => frameIndexAt(10, p));
    expect(played.slice(0, 13)).toEqual([0, 1, 2, 3, 10, 4, 5, 6, 7, 11, 8, 9, 12]);
    expect(played.slice(13)).toEqual([0, 1, 2, 3, 13, 4, 5, 6, 7, 14, 8, 9, 15]);
  });

  test('TOTAL 1 plays the block and one repair frame, with growing indexes', () => {
    expect(range(6, (p) => frameIndexAt(1, p))).toEqual([0, 1, 0, 2, 0, 3]);
  });

  test('TOTAL 4 has one repair frame per pass', () => {
    expect(range(10, (p) => frameIndexAt(4, p))).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 3, 5]);
  });
});

describe('blocks and encoder', () => {
  test('pads the last block with zeros', () => {
    const data = Uint8Array.from({ length: 1000 }, () => 9);
    const blocks = splitBlocks(data, 400);
    expect(blocks.map((b) => b.length)).toEqual([400, 400, 400]);
    expect([...blocks[2]!.subarray(0, 200)].every((b) => b === 9)).toBe(true);
    expect([...blocks[2]!.subarray(200)].every((b) => b === 0)).toBe(true);
  });

  test('source frames carry blocks, repair frames carry the XOR of their composition', () => {
    const data = Uint8Array.from({ length: 800 }, (_, i) => (i * 31) & 0xff);
    const encoder = new FountainEncoder(data, 100, 'K3Z9QA');
    expect(encoder.total).toBe(8);
    expect(encoder.payloadAt(5)).toEqual(encoder.blocks[5]);
    const expected = new Uint8Array(100);
    for (const j of [0, 1, 5, 6]) encoder.blocks[j]!.forEach((b, i) => (expected[i]! ^= b));
    expect(encoder.payloadAt(8)).toEqual(expected);
  });

  test('frame texts parse back with the transfer fields', () => {
    const data = new TextEncoder().encode('123456789');
    const encoder = new FountainEncoder(data, 4);
    for (let p = 0; p < 20; p++) {
      const frame = parseFrame(encoder.textAtPosition(p))!;
      expect(frame).toMatchObject({ total: 3, length: 9, crc32: 'CBF43926', session: encoder.session });
      expect(frame.payload.length).toBe(4);
    }
  });

  test('two transfers of the same bytes use different sessions', () => {
    const data = new Uint8Array(10);
    expect(new FountainEncoder(data, 4).session).not.toBe(new FountainEncoder(data, 4).session);
  });
});

describe('session ids', () => {
  test('1000 ids are all 6 characters of 0-9A-Z', () => {
    for (let i = 0; i < 1000; i++) expect(createSessionId()).toMatch(/^[0-9A-Z]{6}$/);
  });

  test('bytes at or above 252 are rejected', () => {
    let calls = 0;
    const id = createSessionId((bytes) => {
      bytes.fill(calls++ === 0 ? 255 : 36 + 1); // 37 % 36 = 1
      return bytes;
    });
    expect(id).toBe('111111');
    expect(calls).toBe(2);
  });
});
