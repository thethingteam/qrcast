// @ts-check
// The qrcast QR decode worker. A classic worker script, copied to the build as
// is: it loads the unmodified zxing-wasm reader script with importScripts.
//
// Messages in:
//   { type: 'init', glueUrl, wasmUrl }  load zxing and its wasm
//   { type: 'decode', bitmap }          read the QR codes in an ImageBitmap
// Messages out:
//   { type: 'ready' } or { type: 'init-failed', reason }
//   { type: 'decoded', texts }          one per 'decode', texts without duplicates
//   { type: 'aborted', reason }         zxing or this worker failed after 'ready';
//                                       the worker then ignores every message
'use strict';

(() => {
  /** Mean saturation (max - min of R, G, B) of a region from which a picture is read as color. */
  const COLOR_THRESHOLD = 24;
  /** Samples per side of the whole picture, and regions per side. */
  const SAMPLES = 64;
  const REGIONS = 4;
  /** The channels of a color picture, as offsets into RGBA. */
  const CHANNELS = [0, 1, 2];

  const READ_OPTIONS = {
    formats: ['QRCode'],
    tryHarder: true,
    tryRotate: false,
    tryInvert: false,
    maxNumberOfSymbols: 1,
  };

  let ready = false;
  let dead = false;
  /** @type {OffscreenCanvas | null} */
  let canvas = null;

  function fail(/** @type {unknown} */ reason) {
    if (dead) return;
    dead = true;
    self.postMessage({ type: ready ? 'aborted' : 'init-failed', reason: String(reason) });
  }

  /** @param {{ glueUrl: string, wasmUrl: string }} message */
  function init(message) {
    importScripts(message.glueUrl);
    // zxing-wasm downloads its wasm from a CDN by default. This override keeps
    // it on the URL the app (or the package) gives.
    ZXingWASM.prepareZXingModule({
      overrides: {
        locateFile: (path, prefix) => (path.endsWith('.wasm') ? message.wasmUrl : prefix + path),
        onAbort: fail,
      },
      fireImmediately: true,
    }).then(() => {
      if (dead) return;
      ready = true;
      self.postMessage({ type: 'ready' });
    }, fail);
  }

  /** The pixels of the bitmap, which is closed. */
  function pixelsOf(/** @type {ImageBitmap} */ bitmap) {
    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    }
    const context = /** @type {OffscreenCanvasRenderingContext2D} */ (
      canvas.getContext('2d', { willReadFrequently: true })
    );
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * The highest mean saturation among the regions of the picture, each
   * sampled on a grid. The regions cover the whole picture, so a color code
   * anywhere in it fills most of at least one region.
   */
  function saturation(/** @type {ImageData} */ image) {
    const { data, width, height } = image;
    const steps = Math.max(1, Math.min(SAMPLES / REGIONS, Math.floor(width / REGIONS), Math.floor(height / REGIONS)));
    let highest = 0;
    for (let ry = 0; ry < REGIONS; ry++) {
      for (let rx = 0; rx < REGIONS; rx++) {
        const x0 = Math.floor((rx * width) / REGIONS);
        const y0 = Math.floor((ry * height) / REGIONS);
        const w = Math.floor(((rx + 1) * width) / REGIONS) - x0;
        const h = Math.floor(((ry + 1) * height) / REGIONS) - y0;
        let sum = 0;
        for (let sy = 0; sy < steps; sy++) {
          const y = y0 + Math.floor(((sy + 0.5) * h) / steps);
          for (let sx = 0; sx < steps; sx++) {
            const x = x0 + Math.floor(((sx + 0.5) * w) / steps);
            const i = (y * width + x) * 4;
            const r = /** @type {number} */ (data[i]);
            const g = /** @type {number} */ (data[i + 1]);
            const b = /** @type {number} */ (data[i + 2]);
            sum += Math.max(r, g, b) - Math.min(r, g, b);
          }
        }
        highest = Math.max(highest, sum / (steps * steps));
      }
    }
    return highest;
  }

  /** One channel of the picture as a grayscale image. */
  function channelImage(/** @type {ImageData} */ image, /** @type {number} */ channel) {
    const { data, width, height } = image;
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const v = /** @type {number} */ (data[i + channel]);
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
    return new ImageData(out, width, height);
  }

  async function read(/** @type {ImageData} */ image) {
    const results = await ZXingWASM.readBarcodes(image, READ_OPTIONS);
    return results.filter((result) => result.isValid).map((result) => result.text);
  }

  /** @param {ImageBitmap} bitmap */
  async function decode(bitmap) {
    const image = pixelsOf(bitmap);
    /** @type {string[]} */
    let found = [];
    if (saturation(image) < COLOR_THRESHOLD) {
      found = await read(image).catch(() => []);
    } else {
      // Each channel has its own try: one failing channel keeps the others.
      for (const channel of CHANNELS) {
        try {
          found.push(...(await read(channelImage(image, channel))));
        } catch {
          // This channel gave nothing; the next capture will try again.
        }
      }
    }
    self.postMessage({ type: 'decoded', texts: [...new Set(found)] });
  }

  self.onmessage = async (event) => {
    if (dead) return;
    const message = event.data;
    try {
      if (message.type === 'init') init(message);
      else if (message.type === 'decode') await decode(message.bitmap);
    } catch (error) {
      fail(error);
    }
  };

  // Uncaught errors after 'ready' are aborts; before it, the main thread's
  // error handler reports the failed load.
  self.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    fail(event.reason);
  });
})();
