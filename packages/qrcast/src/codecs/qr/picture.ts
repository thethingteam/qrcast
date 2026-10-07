import type { FountainEncoder } from './fountain.js';
import { formatFrame } from './frame.js';
import { Ecc, QrCode, QrSegment } from './qrcodegen.js';

/** Largest side of a picture in pixels. */
const MAX_PICTURE_SIZE = 1024;
/** White border around the symbols, in modules. */
const QUIET_ZONE = 4;

/** Encodes frame text as alphanumeric QR at level L, at exactly `version`. */
export function encodeFrameText(text: string, version: number): QrCode {
  return QrCode.encodeSegments([QrSegment.makeAlphanumeric(text)], Ecc.LOW, version, version, -1, false);
}

/**
 * The QR version for a whole transfer: the smallest one that holds the
 * longest frame text it can produce, which is a frame whose `INDEX` has 8
 * base36 digits. Later frames are never longer, so the version never changes.
 */
export function chooseVersion(encoder: FountainEncoder): number {
  const longest = formatFrame({ ...encoder.frame(0), index: 36 ** 8 - 1 });
  return QrCode.encodeSegments([QrSegment.makeAlphanumeric(longest)], Ecc.LOW, 1, 40, -1, false).version;
}

/** Pixels per module, and the picture side in pixels, for a symbol of `modules`. */
export function pictureGeometry(modules: number): { scale: number; side: number } {
  const cells = modules + 2 * QUIET_ZONE;
  const scale = Math.max(1, Math.floor(MAX_PICTURE_SIZE / cells));
  return { scale, side: cells * scale };
}

export interface Picture {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Draws picture number `number` of a transfer. With one layer it shows frame
 * `number` in black and white. With three, it shows frames `3 * number` to
 * `3 * number + 2` of the schedule in the red, green and blue channels. A dark
 * module sets its channel to 0; light modules and the quiet zone are 255.
 */
export function renderPicture(encoder: FountainEncoder, version: number, layers: 1 | 3, number: number): Picture {
  const symbols = Array.from({ length: layers }, (_, layer) =>
    encodeFrameText(encoder.textAtPosition(number * layers + layer), version),
  );
  const modules = symbols[0]!.size;
  const { scale, side } = pictureGeometry(modules);
  const data = new Uint8ClampedArray(side * side * 4).fill(255);

  for (let my = 0; my < modules; my++) {
    for (let mx = 0; mx < modules; mx++) {
      // Dark modules of the symbols, as the channels to clear.
      const dark = symbols.map((symbol) => symbol.getModule(mx, my));
      if (!dark.some(Boolean)) continue;
      const x0 = (mx + QUIET_ZONE) * scale;
      const y0 = (my + QUIET_ZONE) * scale;
      for (let y = y0; y < y0 + scale; y++) {
        let offset = (y * side + x0) * 4;
        for (let x = 0; x < scale; x++, offset += 4) {
          for (let channel = 0; channel < 3; channel++) {
            if (dark[layers === 1 ? 0 : channel]) data[offset + channel] = 0;
          }
        }
      }
    }
  }
  return { width: side, height: side, data };
}
