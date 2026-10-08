// The files each codec loads at run time, as [source in the package, name next
// to the emitted JavaScript]. Shared by the asset copy and the pack check.
export const codecAssets = {
  cimbar: [
    ['vendor/cimbar/cimbar_js.2026-08-21T2336.js', 'cimbar_js.2026-08-21T2336.js'],
    ['vendor/cimbar/cimbar_js.2026-08-21T2336.wasm', 'cimbar_js.2026-08-21T2336.wasm'],
    ['vendor/cimbar/LICENSE', 'LICENSE'],
    ['src/codecs/cimbar/cimbar-worker.js', 'cimbar-worker.js'],
  ],
  qr: [
    ['vendor/zxing-wasm/zxing_reader.js', 'zxing_reader.js'],
    ['vendor/zxing-wasm/zxing_reader.wasm', 'zxing_reader.wasm'],
    ['vendor/zxing-wasm/LICENSE', 'LICENSE'],
    ['vendor/zxing-wasm/LICENSE.zxing-cpp', 'LICENSE.zxing-cpp'],
    ['src/codecs/qr/qr-worker.js', 'qr-worker.js'],
  ],
};
