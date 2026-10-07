// Globals of qr-worker.js, type-checked with tsconfig.worker.json only.

interface ZXingModuleOverrides {
  locateFile?(path: string, prefix: string): string;
  onAbort?(what: unknown): void;
}

interface ZXingReadOptions {
  formats: string[];
  tryHarder: boolean;
  tryRotate: boolean;
  tryInvert: boolean;
  maxNumberOfSymbols: number;
}

interface ZXingReadResult {
  isValid: boolean;
  text: string;
}

/** The global the zxing-wasm reader IIFE defines (only what qrcast calls). */
declare var ZXingWASM: {
  prepareZXingModule(options: { overrides: ZXingModuleOverrides; fireImmediately: boolean }): Promise<unknown>;
  readBarcodes(image: ImageData, options: ZXingReadOptions): Promise<ZXingReadResult[]>;
};
