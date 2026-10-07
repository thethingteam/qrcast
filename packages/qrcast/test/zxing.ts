import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

const wasm = readFileSync(fileURLToPath(new URL('../vendor/zxing-wasm/zxing_reader.wasm', import.meta.url)));
let ready: Promise<unknown> | undefined;

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** The texts of the QR codes zxing-wasm reads from the picture. */
export async function readQr(picture: Pixels): Promise<string[]> {
  ready ??= prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer }, fireImmediately: true });
  await ready;
  const results = await readBarcodes(
    { data: picture.data, width: picture.width, height: picture.height, colorSpace: 'srgb' } as ImageData,
    { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 },
  );
  return results.filter((r) => r.isValid).map((r) => r.text);
}

/** One channel of an RGBA picture as a grayscale picture. */
export function channel(picture: Pixels, index: 0 | 1 | 2): Pixels {
  const data = new Uint8ClampedArray(picture.data.length);
  for (let i = 0; i < picture.data.length; i += 4) {
    const v = picture.data[i + index]!;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { ...picture, data };
}
