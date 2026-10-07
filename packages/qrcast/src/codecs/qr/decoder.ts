import { repairComposition, xorBytes } from './fountain.js';
import type { QrFrame } from './frame.js';

/** GF(2) row vector: bit `j` is the coefficient of source block `j`. */
type Bitset = Uint32Array;

const createBitset = (size: number): Bitset => new Uint32Array(Math.ceil(size / 32));
const hasBit = (b: Bitset, i: number): boolean => ((b[i >>> 5]! >>> (i & 31)) & 1) === 1;
const setBit = (b: Bitset, i: number): void => void (b[i >>> 5]! |= 1 << (i & 31));
const clearBit = (b: Bitset, i: number): void => void (b[i >>> 5]! &= ~(1 << (i & 31)));

function xorBits(target: Bitset, source: Bitset): void {
  for (let w = 0; w < target.length; w++) target[w]! ^= source[w]!;
}

/** Index of the lowest set bit, or -1 when the row is zero. */
function lowestBit(b: Bitset): number {
  for (let w = 0; w < b.length; w++) {
    const word = b[w]!;
    if (word !== 0) return w * 32 + (31 - Math.clz32(word & -word));
  }
  return -1;
}

function popcount(b: Bitset): number {
  let n = 0;
  for (let w = 0; w < b.length; w++) {
    let v = b[w]!;
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return n;
}

const isZero = (b: Bitset): boolean => b.every((word) => word === 0);

/** An equation not solved yet: the XOR of the blocks in `coef` equals `data`. */
interface Row {
  coef: Bitset;
  data: Uint8Array;
}

type Solved = [index: number, data: Uint8Array];

/**
 * Online GF(2) decoder. Source and repair frames are equations over the
 * source blocks; Gauss-Jordan elimination keeps them in reduced form. Rows
 * never contain known blocks, and a row's pivot column appears in no other
 * row, so when the rank is full every block is known.
 */
export class FountainDecoder {
  readonly total: number;
  readonly length: number;
  readonly blockSize: number;
  private readonly known: (Uint8Array | undefined)[];
  private knownCount = 0;
  /** Pivot column -> row. */
  private readonly rows = new Map<number, Row>();
  private readonly seenRepairs = new Set<number>();

  constructor(
    readonly session: string,
    info: { total: number; length: number; blockSize: number },
  ) {
    this.total = info.total;
    this.length = info.length;
    this.blockSize = info.blockSize;
    this.known = new Array(info.total);
  }

  static fromFrame(frame: QrFrame): FountainDecoder {
    return new FountainDecoder(frame.session, {
      total: frame.total,
      length: frame.length,
      blockSize: frame.payload.length,
    });
  }

  /** Independent equations held: known blocks plus unsolved rows. */
  get rank(): number {
    return this.knownCount + this.rows.size;
  }

  get isComplete(): boolean {
    return this.knownCount === this.total;
  }

  /** Whether the frame agrees with the first one this decoder was built from. */
  matches(frame: QrFrame): boolean {
    return frame.total === this.total && frame.length === this.length && frame.payload.length === this.blockSize;
  }

  /** Takes a frame; returns whether it added information. */
  accept(frame: QrFrame): boolean {
    if (frame.index < this.total) {
      if (this.known[frame.index]) return false;
      this.resolve([[frame.index, frame.payload.slice()]]);
      return true;
    }
    if (this.seenRepairs.has(frame.index)) return false;
    this.seenRepairs.add(frame.index);

    const row: Row = { coef: createBitset(this.total), data: frame.payload.slice() };
    for (const j of repairComposition(this.session, frame.index, this.total)) {
      const block = this.known[j];
      if (block) xorBytes(row.data, block);
      else setBit(row.coef, j);
    }
    const solved = this.insert(row);
    if (!solved) return false;
    this.resolve(solved);
    return true;
  }

  /** The joined blocks cut to `length`, or `null` while blocks are missing. */
  assemble(): Uint8Array | null {
    if (!this.isComplete) return null;
    const out = new Uint8Array(this.total * this.blockSize);
    this.known.forEach((block, i) => out.set(block!, i * this.blockSize));
    return out.subarray(0, this.length);
  }

  /**
   * Reduces `row` by the existing pivots and stores it. Returns `null` when
   * it adds nothing, otherwise the blocks that became determined.
   */
  private insert(row: Row): Solved[] | null {
    for (const [pivot, other] of this.rows) {
      if (hasBit(row.coef, pivot)) {
        xorBits(row.coef, other.coef);
        xorBytes(row.data, other.data);
      }
    }
    if (isZero(row.coef)) return null;

    const pivot = lowestBit(row.coef);
    const solved: Solved[] = [];
    for (const [otherPivot, other] of this.rows) {
      if (!hasBit(other.coef, pivot)) continue;
      xorBits(other.coef, row.coef);
      xorBytes(other.data, row.data);
      if (popcount(other.coef) === 1) {
        this.rows.delete(otherPivot);
        solved.push([otherPivot, other.data]);
      }
    }
    if (popcount(row.coef) === 1) solved.push([pivot, row.data]);
    else this.rows.set(pivot, row);
    return solved;
  }

  /** Records determined blocks and eliminates them from every row, cascading. */
  private resolve(queue: Solved[]): void {
    while (queue.length > 0) {
      const [j, data] = queue.shift()!;
      if (this.known[j]) continue;
      this.known[j] = data;
      this.knownCount++;

      const pivotRow = this.rows.get(j);
      if (pivotRow) this.rows.delete(j);
      for (const [pivot, row] of this.rows) {
        if (!hasBit(row.coef, j)) continue;
        clearBit(row.coef, j);
        xorBytes(row.data, data);
        // The pivot is still in the row, so it cannot become zero.
        if (popcount(row.coef) === 1) {
          this.rows.delete(pivot);
          queue.push([pivot, row.data]);
        }
      }
      if (pivotRow) {
        clearBit(pivotRow.coef, j);
        xorBytes(pivotRow.data, data);
        if (!isZero(pivotRow.coef)) {
          const solved = this.insert(pivotRow);
          if (solved) queue.push(...solved);
        }
      }
    }
  }
}
