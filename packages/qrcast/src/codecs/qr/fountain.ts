import { crc32, crc32Hex } from './crc32.js';
import { formatFrame, toBase36, type QrFrame } from './frame.js';

/** One repair frame is played after every this many source frames. */
export const SOURCES_PER_REPAIR = 4;

const SESSION_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SESSION_LENGTH = 6;

/** A random 6-character session id, by rejection sampling for an even spread. */
export function createSessionId(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const limit = 252; // 36 * 7: larger bytes are dropped so every character is equally likely
  let id = '';
  while (id.length < SESSION_LENGTH) {
    for (const byte of random(new Uint8Array(16))) {
      if (byte >= limit) continue;
      id += SESSION_CHARS[byte % 36];
      if (id.length === SESSION_LENGTH) break;
    }
  }
  return id;
}

/** Splits `data` into blocks of `blockSize` bytes, zero-padding the last one. */
export function splitBlocks(data: Uint8Array, blockSize: number): Uint8Array[] {
  const total = Math.ceil(data.length / blockSize);
  return Array.from({ length: total }, (_, i) => {
    const block = new Uint8Array(blockSize);
    block.set(data.subarray(i * blockSize, (i + 1) * blockSize));
    return block;
  });
}

/** XORs `source` into `target` (same length). */
export function xorBytes(target: Uint8Array, source: Uint8Array): void {
  const n = target.length;
  if (target.byteOffset % 4 === 0 && source.byteOffset % 4 === 0) {
    const words = n >>> 2;
    const t32 = new Uint32Array(target.buffer, target.byteOffset, words);
    const s32 = new Uint32Array(source.buffer, source.byteOffset, words);
    for (let i = 0; i < words; i++) t32[i]! ^= s32[i]!;
    for (let i = words << 2; i < n; i++) target[i]! ^= source[i]!;
    return;
  }
  for (let i = 0; i < n; i++) target[i]! ^= source[i]!;
}

/**
 * mulberry32. Its integer multiplications make it non-linear over GF(2); a
 * shift-and-XOR generator (xorshift) spans at most 32 dimensions, so repair
 * frames built from it could never finish a transfer.
 */
export function mulberry32(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), x | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** The seed of a repair frame: the CRC-32 of the ASCII text `<SESSION>/<INDEX>`. */
export function repairSeed(session: string, index: number): number {
  return crc32(new TextEncoder().encode(`${session}/${toBase36(index)}`));
}

/** The source blocks (in increasing order) that a repair frame is the XOR of. */
export function repairComposition(session: string, index: number, total: number): number[] {
  const seed = repairSeed(session, index);
  const next = mulberry32(seed);
  const blocks: number[] = [];
  for (let j = 0; j < total; j++) if (next() & 0x80000000) blocks.push(j);
  if (blocks.length === 0) blocks.push(seed % total);
  return blocks;
}

/** Repair frames in one pass. */
export function repairsPerPass(total: number): number {
  return Math.ceil(total / SOURCES_PER_REPAIR);
}

/** Frames in one pass: every source frame plus its repair frames. */
export function passLength(total: number): number {
  return total + repairsPerPass(total);
}

/**
 * The frame index played at global position `position` (0-based, counting
 * across passes). Each pass plays the source frames in order, with a repair
 * frame after every 4 of them and after the last one; repair indexes start at
 * `total` and keep growing across passes.
 */
export function frameIndexAt(total: number, position: number): number {
  const length = passLength(total);
  const pass = Math.floor(position / length);
  const inPass = position - pass * length;
  const group = Math.floor(inPass / (SOURCES_PER_REPAIR + 1));
  const offset = inPass - group * (SOURCES_PER_REPAIR + 1);
  const sources = Math.min(SOURCES_PER_REPAIR, total - group * SOURCES_PER_REPAIR);
  if (offset < sources) return group * SOURCES_PER_REPAIR + offset;
  return total + pass * repairsPerPass(total) + group;
}

/** Turns coded data into the frames of one transfer. */
export class FountainEncoder {
  readonly session: string;
  readonly total: number;
  readonly length: number;
  readonly crc32: string;
  readonly blockSize: number;
  /** Zero-padded source blocks, each in its own 4-byte aligned buffer. */
  readonly blocks: Uint8Array[];

  constructor(data: Uint8Array, blockSize: number, session = createSessionId()) {
    this.session = session;
    this.blockSize = blockSize;
    this.length = data.length;
    this.crc32 = crc32Hex(data);
    this.blocks = splitBlocks(data, blockSize);
    this.total = this.blocks.length;
  }

  /** The payload of frame `index`: a source block, or the XOR of its composition. */
  payloadAt(index: number): Uint8Array {
    if (index < this.total) return this.blocks[index]!;
    const payload = new Uint8Array(this.blockSize);
    for (const j of repairComposition(this.session, index, this.total)) xorBytes(payload, this.blocks[j]!);
    return payload;
  }

  frame(index: number): QrFrame {
    return {
      session: this.session,
      index,
      total: this.total,
      length: this.length,
      crc32: this.crc32,
      payload: this.payloadAt(index),
    };
  }

  /** The text of frame `index`. */
  textAt(index: number): string {
    return formatFrame(this.frame(index));
  }

  /** The text played at global position `position` of the schedule. */
  textAtPosition(position: number): string {
    return this.textAt(frameIndexAt(this.total, position));
  }
}
