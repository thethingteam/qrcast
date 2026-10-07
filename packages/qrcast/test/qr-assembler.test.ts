import { describe, expect, test } from 'vitest';
import { Assembler } from '../src/codecs/qr/assembler.js';
import { FountainEncoder, frameIndexAt } from '../src/codecs/qr/fountain.js';
import { formatFrame } from '../src/codecs/qr/frame.js';

const bytes = (length: number, fill: number) => Uint8Array.from({ length }, (_, i) => (i * 13 + fill) & 0xff);

function harness() {
  const log = { data: 0, progress: [] as number[], files: [] as Uint8Array[] };
  const assembler = new Assembler({
    onData: () => log.data++,
    onProgress: (p) => log.progress.push(p),
    onFile: (b) => log.files.push(b),
  });
  return { assembler, log };
}

describe('assembler', () => {
  test('ignores invalid texts and reports the first valid frame once', () => {
    const { assembler, log } = harness();
    assembler.push('https://example.com/');
    assembler.push('QRCAST2F/AAAAAA/0/1/4/00000000/AB');
    expect(log.data).toBe(0);
    const encoder = new FountainEncoder(bytes(300, 1), 100, 'AAAAAA');
    assembler.push(encoder.textAt(0));
    assembler.push(encoder.textAt(1));
    expect(log.data).toBe(1);
  });

  test('completes with the exact bytes, progress ending at 1', () => {
    const { assembler, log } = harness();
    const data = bytes(950, 2);
    const encoder = new FountainEncoder(data, 100, 'AAAAAA');
    for (let p = 0; log.files.length === 0; p++) assembler.push(encoder.textAtPosition(p));
    expect(log.files[0]).toEqual(data);
    expect(log.progress.at(-1)).toBe(1);
    expect(log.progress.slice(0, -1).every((p) => p < 1)).toBe(true);
  });

  test('half of the source frames give progress 0.5', () => {
    const { assembler, log } = harness();
    const encoder = new FountainEncoder(bytes(100 * 100, 3), 100, 'AAAAAA');
    expect(encoder.total).toBe(100);
    for (let i = 0; i < 50; i++) assembler.push(encoder.textAt(i));
    expect(log.progress.at(-1)).toBe(0.5);
  });

  test('a repeated frame does not report progress', () => {
    const { assembler, log } = harness();
    const encoder = new FountainEncoder(bytes(300, 3), 100, 'AAAAAA');
    assembler.push(encoder.textAt(0));
    assembler.push(encoder.textAt(0));
    expect(log.progress).toHaveLength(1);
  });

  test('ignores frames that disagree with their session', () => {
    const { assembler, log } = harness();
    const encoder = new FountainEncoder(bytes(300, 4), 100, 'AAAAAA');
    assembler.push(encoder.textAt(0));
    assembler.push(formatFrame({ ...encoder.frame(1), length: 299 }));
    assembler.push(formatFrame({ ...encoder.frame(1), crc32: '00000000' }));
    assembler.push(formatFrame({ ...encoder.frame(1), payload: new Uint8Array(50), length: 150 }));
    expect(log.progress).toHaveLength(1);
  });

  describe('a third session', () => {
    const setup = () => {
      const h = harness();
      const a = new FountainEncoder(bytes(1000, 5), 100, 'AAAAAA');
      const b = new FountainEncoder(bytes(1000, 6), 100, 'BBBBBB');
      const c = new FountainEncoder(bytes(1000, 7), 100, 'CCCCCC');
      h.assembler.push(a.textAt(0));
      h.assembler.push(b.textAt(0));
      h.assembler.push(a.textAt(1)); // A gained information after B
      h.assembler.push(c.textAt(0)); // evicts B
      return { ...h, a, b };
    };

    test('evicts the session that gained information least recently', () => {
      const { assembler, log, b } = setup();
      // B starts again from nothing: three frames give 3/10, not 4/10.
      for (let i = 1; i < 4; i++) assembler.push(b.textAt(i));
      expect(log.progress.at(-1)).toBe(0.3);
    });

    test('keeps the fresher session and its frames', () => {
      const { assembler, log, a } = setup();
      // Only frames 2 to 9 are pushed, so A completes only if frames 0 and 1 survived.
      for (let i = 2; i < 10; i++) assembler.push(a.textAt(i));
      expect(log.files[0]).toEqual(bytes(1000, 5));
    });
  });

  test('a forged session with a wrong CRC32 resets and later completes with correct frames', () => {
    const { assembler, log } = harness();
    const data = bytes(300, 8);
    const encoder = new FountainEncoder(data, 100, 'AAAAAA');
    const forged = (i: number) => formatFrame({ ...encoder.frame(i), crc32: '00000000' });
    assembler.push(forged(0));
    assembler.push(forged(1));
    assembler.push(forged(2));
    expect(log.files).toHaveLength(0);
    expect(log.progress.at(-1)).toBe(0);
    for (let p = 0; log.files.length === 0 && p < 30; p++) assembler.push(encoder.textAtPosition(p));
    expect(log.files[0]).toEqual(data);
  });

  test('a restart from body A to body B completes with B', () => {
    const { assembler, log } = harness();
    const a = new FountainEncoder(bytes(2000, 9), 100, 'AAAAAA');
    const b = new FountainEncoder(bytes(2000, 10), 100, 'BBBBBB');
    for (let p = 0; p < 8; p++) assembler.push(a.textAtPosition(p));
    for (let p = 0; log.files.length === 0; p++) assembler.push(b.textAtPosition(p));
    expect(log.files[0]).toEqual(bytes(2000, 10));
  });

  test('stops after the file', () => {
    const { assembler, log } = harness();
    const encoder = new FountainEncoder(bytes(100, 1), 100, 'AAAAAA');
    assembler.push(encoder.textAt(0));
    const progress = log.progress.length;
    assembler.push(encoder.textAt(frameIndexAt(1, 1)));
    expect(log.files).toHaveLength(1);
    expect(log.progress).toHaveLength(progress);
  });
});
