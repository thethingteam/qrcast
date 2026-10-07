// Globals of cimbar-worker.js, type-checked with tsconfig.worker.json only.

/** The emscripten module of the libcimbar glue: setup hooks and the exports qrcast calls. */
interface CimbarModule {
  canvas?: OffscreenCanvas;
  locateFile?(path: string): string;
  onRuntimeInitialized?(): void;
  onAbort?(what: unknown): void;

  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _cimbare_configure(mode: number, compression: number): number;
  _cimbare_init_window(width: number, height: number): number;
  _cimbare_init_encode(namePtr: number, nameSize: number, encodeId: number): number;
  _cimbare_encode_bufsize(): number;
  _cimbare_encode(ptr: number, size: number): number;
  _cimbare_render(): number;
  _cimbare_next_frame(colorBalance: boolean): number;

  _cimbard_configure_decode(mode: number): number;
  _cimbard_get_bufsize(): number;
  _cimbard_scan_extract_decode(
    pixelPtr: number,
    width: number,
    height: number,
    format: number,
    outPtr: number,
    outSize: number,
  ): number;
  _cimbard_fountain_decode(ptr: number, size: number): bigint | number;
  _cimbard_get_report(ptr: number, size: number): number;
  _cimbard_get_filename(id: number, ptr: number, size: number): number;
  _cimbard_get_decompress_bufsize(): number;
  _cimbard_decompress_read(id: number, ptr: number, size: number): number;
}

declare var Module: CimbarModule;
declare var window: unknown;
declare var document: unknown;
declare var matchMedia: unknown;
