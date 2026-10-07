// @ts-check
// The qrcast cimbar worker. A classic worker script, copied to the build as
// is: it loads the unmodified libcimbar glue with importScripts.
//
// The first message chooses the role and gives the glue and wasm URLs:
//   { type: 'init', role: 'encode' | 'extract' | 'assemble', mode, glueUrl, wasmUrl }
// The worker answers 'ready', or 'init-failed' when the glue or the wasm
// cannot be loaded. After 'ready', an abort or a throwing libcimbar call is
// reported as 'aborted', and the worker ignores every later message.
'use strict';

// Stand-ins for emscripten's GLFW, the same as the official send-worker
// uses. The glue aborts without any of them.
self.window = self;
self.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
self.document = {
  fullscreenElement: null,
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
  hidden: false,
};

/** The name of every file this worker encodes. */
const FILE_NAME = 'qrcast.bin';
/** cimbar's file name field holds at most 500 bytes. */
const FILE_NAME_LIMIT = 500;
const REPORT_LIMIT = 1024;

let ready = false;
let dead = false;
/** @type {OffscreenCanvas | null} */
let canvas = null;
/** The mode the decoder is configured for. */
let decodeMode = 0;

/** @type {Record<string, { ptr: number, size: number }>} */
const buffers = {};

/** A heap buffer of at least `size` bytes, reused between calls. */
function buffer(/** @type {string} */ name, /** @type {number} */ size) {
  const m = self.Module;
  const current = buffers[name];
  if (current && current.size >= size) return current.ptr;
  if (current) m._free(current.ptr);
  const ptr = m._malloc(size);
  if (!ptr) throw new Error(`malloc(${size}) failed`);
  buffers[name] = { ptr, size };
  return ptr;
}

function fail(/** @type {unknown} */ reason) {
  if (dead) return;
  dead = true;
  self.postMessage({ type: ready ? 'aborted' : 'init-failed', reason: String(reason) });
}

function check(/** @type {string} */ call, /** @type {number} */ result) {
  if (result < 0) throw new Error(`${call} returned ${result}`);
  return result;
}

/** @param {{ role: string, mode: number, glueUrl: string, wasmUrl: string }} message */
function init(message) {
  const role = message.role;
  // The glue adds the heap and the exports to this object when it loads.
  self.Module = /** @type {CimbarModule} */ (/** @type {unknown} */ ({
    locateFile: () => message.wasmUrl,
    onRuntimeInitialized() {
      try {
        const m = self.Module;
        if (role === 'encode') {
          check('cimbare_configure', m._cimbare_configure(message.mode, -1));
          check('cimbare_init_window', m._cimbare_init_window(0, 0));
        } else {
          configureDecode(message.mode);
        }
        ready = true;
        self.postMessage({ type: 'ready' });
      } catch (error) {
        fail(error);
      }
    },
    onAbort: fail,
  }));
  if (role === 'encode') {
    canvas = new OffscreenCanvas(1, 1);
    self.Module.canvas = canvas;
  }
  importScripts(message.glueUrl);
}

function configureDecode(/** @type {number} */ mode) {
  if (mode === decodeMode) return;
  check('cimbard_configure_decode', self.Module._cimbard_configure_decode(mode));
  decodeMode = mode;
}

/** @param {Uint8Array} bytes */
function encode(bytes) {
  const m = self.Module;
  const name = new TextEncoder().encode(FILE_NAME);
  const namePtr = buffer('name', name.length);
  m.HEAPU8.set(name, namePtr);
  // Encode id -1: a new id per instance, so receivers see a new file.
  check('cimbare_init_encode', m._cimbare_init_encode(namePtr, name.length, -1));

  const chunkSize = m._cimbare_encode_bufsize() * 16;
  const chunkPtr = buffer('chunk', chunkSize);
  // 1 means cimbar is waiting for more data, so a zero-length call finishes.
  let result = 1;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    m.HEAPU8.set(chunk, chunkPtr);
    result = check('cimbare_encode', m._cimbare_encode(chunkPtr, chunk.length));
  }
  if (result === 1) check('cimbare_encode', m._cimbare_encode(chunkPtr, 0));
  // render() draws the frame the previous next_frame() prepared.
  m._cimbare_next_frame(false);
  self.postMessage({ type: 'encoded' });
}

function frame() {
  const m = self.Module;
  m._cimbare_render();
  m._cimbare_next_frame(false);
  const bitmap = /** @type {OffscreenCanvas} */ (canvas).transferToImageBitmap();
  self.postMessage({ type: 'frame', bitmap }, [bitmap]);
}

/** libcimbar's pixel format numbers. */
const PIXEL_FORMATS = /** @type {Record<string, number>} */ ({ NV12: 12, I420: 420, RGBA: 4 });

/** @param {{ pixels: Uint8Array, format: string, width: number, height: number, mode: number }} message */
function extract(message) {
  const m = self.Module;
  configureDecode(message.mode);
  const { pixels } = message;
  const pixelPtr = buffer('pixels', pixels.length);
  m.HEAPU8.set(pixels, pixelPtr);
  const outSize = m._cimbard_get_bufsize();
  const outPtr = buffer('fountain', outSize);
  const length = m._cimbard_scan_extract_decode(
    pixelPtr,
    message.width,
    message.height,
    PIXEL_FORMATS[message.format] ?? 4,
    outPtr,
    outSize,
  );
  // 0 or less: no code found, or one that could not be read. Not an error.
  const bytes = length > 0 ? m.HEAPU8.slice(outPtr, outPtr + length) : new Uint8Array(0);
  self.postMessage({ type: 'extracted', bytes, mode: message.mode }, [bytes.buffer]);
}

function readText(/** @type {number} */ ptr, /** @type {number} */ length) {
  return length > 0 ? new TextDecoder().decode(self.Module.HEAPU8.subarray(ptr, ptr + length)) : '';
}

/** The progress of the file being received, from cimbar's JSON report. */
function progress() {
  const ptr = buffer('report', REPORT_LIMIT);
  const text = readText(ptr, self.Module._cimbard_get_report(ptr, REPORT_LIMIT));
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) return null;
    const fractions = value.filter((item) => typeof item === 'number' && Number.isFinite(item));
    return fractions.length > 0 ? Math.min(1, Math.max(0, ...fractions)) : null;
  } catch {
    return null;
  }
}

/** @param {{ bytes: Uint8Array, mode: number }} message */
function assemble(message) {
  const m = self.Module;
  configureDecode(message.mode);
  const { bytes } = message;
  const inPtr = buffer('fountain', bytes.length);
  m.HEAPU8.set(bytes, inPtr);
  // A BigInt: above 0 when a file is complete (its id in the low 32 bits),
  // 0 while incomplete, below 0 for a chunk cimbar rejects.
  const result = BigInt(m._cimbard_fountain_decode(inPtr, bytes.length));
  if (result <= 0n) {
    self.postMessage({ type: 'progress', progress: progress() });
    return;
  }
  const id = Number(result & 0xffffffffn);
  const namePtr = buffer('name', FILE_NAME_LIMIT);
  const name = readText(namePtr, m._cimbard_get_filename(id, namePtr, FILE_NAME_LIMIT));

  const chunkSize = m._cimbard_get_decompress_bufsize();
  const chunkPtr = buffer('decompress', chunkSize);
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const read = m._cimbard_decompress_read(id, chunkPtr, chunkSize);
    if (read <= 0) break;
    chunks.push(m.HEAPU8.slice(chunkPtr, chunkPtr + read));
    total += read;
  }
  const file = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    file.set(chunk, offset);
    offset += chunk.length;
  }
  self.postMessage({ type: 'file', name, bytes: file }, [file.buffer]);
}

self.onmessage = (event) => {
  if (dead) return;
  const message = event.data;
  try {
    switch (message.type) {
      case 'init':
        init(message);
        break;
      case 'encode':
        encode(message.bytes);
        break;
      case 'frame':
        frame();
        break;
      case 'extract':
        extract(message);
        break;
      case 'assemble':
        assemble(message);
        break;
    }
  } catch (error) {
    fail(error);
  }
};
