import { describe, expect, test } from 'vitest';
import { FountainDecoder } from '../src/codecs/qr/decoder.js';
import { FountainEncoder, frameIndexAt } from '../src/codecs/qr/fountain.js';

function randomBytes(length: number, seed = 1): Uint8Array {
  let x = seed;
  return Uint8Array.from({ length }, () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x >>> 24;
  });
}

const decoderFor = (encoder: FountainEncoder) => FountainDecoder.fromFrame(encoder.frame(0));

describe('fountain decoder', () => {
  test('a repair frame fills a gap', () => {
    const data = randomBytes(800);
    const encoder = new FountainEncoder(data, 100, 'K3Z9QA');
    const decoder = decoderFor(encoder);
    for (const i of [0, 1, 2, 3, 4, 6, 7]) expect(decoder.accept(encoder.frame(i))).toBe(true);
    expect(decoder.isComplete).toBe(false);
    expect(decoder.accept(encoder.frame(8))).toBe(true); // blocks 0 1 5 6
    expect(decoder.isComplete).toBe(true);
    expect(decoder.assemble()).toEqual(data);
  });

  test('repair frames only', () => {
    const data = randomBytes(1000, 7);
    const encoder = new FountainEncoder(data, 100, 'ABCDEF');
    const decoder = decoderFor(encoder);
    for (let i = encoder.total; i < encoder.total + 200 && !decoder.isComplete; i++) decoder.accept(encoder.frame(i));
    expect(decoder.isComplete).toBe(true);
    expect(decoder.assemble()).toEqual(data);
  });

  test('a repair frame with no new information', () => {
    const encoder = new FountainEncoder(randomBytes(800), 100, 'K3Z9QA');
    const decoder = decoderFor(encoder);
    for (const i of [0, 1, 5, 6]) decoder.accept(encoder.frame(i));
    const rank = decoder.rank;
    expect(decoder.accept(encoder.frame(8))).toBe(false);
    expect(decoder.rank).toBe(rank);
  });

  test('duplicates do not count', () => {
    const encoder = new FountainEncoder(randomBytes(800), 100, 'K3Z9QA');
    const decoder = decoderFor(encoder);
    expect(decoder.accept(encoder.frame(2))).toBe(true);
    expect(decoder.accept(encoder.frame(2))).toBe(false);
    expect(decoder.accept(encoder.frame(9))).toBe(true);
    expect(decoder.accept(encoder.frame(9))).toBe(false);
  });

  test('assemble is null until complete and cuts the padding', () => {
    const data = randomBytes(250, 3);
    const encoder = new FountainEncoder(data, 100, 'K3Z9QA');
    const decoder = decoderFor(encoder);
    decoder.accept(encoder.frame(0));
    expect(decoder.assemble()).toBeNull();
    decoder.accept(encoder.frame(1));
    decoder.accept(encoder.frame(2));
    expect(decoder.assemble()).toEqual(data);
  });

  test('matches compares total, length and payload size', () => {
    const encoder = new FountainEncoder(randomBytes(800), 100, 'K3Z9QA');
    const decoder = decoderFor(encoder);
    expect(decoder.matches(encoder.frame(3))).toBe(true);
    expect(decoder.matches({ ...encoder.frame(3), length: 799 })).toBe(false);
    expect(decoder.matches({ ...encoder.frame(3), payload: new Uint8Array(99) })).toBe(false);
  });

  test('4500 blocks with 20 % of source frames dropped', () => {
    const data = randomBytes(4500 * 800 - 123, 11);
    const encoder = new FountainEncoder(data, 800, 'BIGONE');
    expect(encoder.total).toBe(4500);
    const decoder = decoderFor(encoder);
    let drop = 0;
    for (let p = 0; !decoder.isComplete; p++) {
      const index = frameIndexAt(encoder.total, p);
      if (index < encoder.total && drop++ % 5 === 0) continue;
      decoder.accept(encoder.frame(index));
      if (p > 4 * encoder.total) throw new Error('did not finish in four passes');
    }
    expect(decoder.assemble()).toEqual(data);
  }, 60_000);
});
