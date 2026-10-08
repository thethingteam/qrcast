# zxing-wasm (vendored)

The zxing-wasm reader build used by the `@thethingteam/qrcast/qr` codec. The build copies
these files to `dist/codecs/qr/`.

**Do not modify these files.** They are kept byte for byte as published on
npm so they can be compared with the package directly. `zxing_reader.js` is
the only renamed file (see below).

- Version: 3.1.4
- Source: the `zxing-wasm@3.1.4` npm package
- Licenses: `LICENSE` (zxing-wasm, MIT, from the package) and
  `LICENSE.zxing-cpp` (zxing-cpp, Apache-2.0, from
  https://github.com/zxing-cpp/zxing-cpp at commit
  `0b2d9a8fc81f420f369928c24331091ff0525976`, the commit this release pins)

| File | Origin in the npm package | sha256 |
| --- | --- | --- |
| `zxing_reader.js` | `dist/iife/reader/index.js` | `d33d09ce132a692faffbed0dce656c36cb2573b4b843885a6e036390d1071d95` |
| `zxing_reader.wasm` | `dist/reader/zxing_reader.wasm` | `e8af31edb56d0522f4de74495839385ef019ba8bc90d38e5ecb2f18795d86fb2` |
| `LICENSE` | `LICENSE` | `fb506e4ade12d7a9efa67c9d76a9a28c8e15d347ca49a69e48e29b40b34ad2ab` |
| `LICENSE.zxing-cpp` | zxing-cpp repository | `c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08` |

The IIFE script is renamed from `index.js` to `zxing_reader.js` so that it is
recognizable next to the wasm. To verify, run `sha256sum *` in this
directory; the output must match the table. `test/vendor.test.ts` compares the
script and the wasm with `node_modules/zxing-wasm` and with these digests.

The script contains zxing-wasm's default wasm location (a jsDelivr URL). The
codec's decode worker always passes a `locateFile` override, so that URL is
never requested.

## Updating

1. Change the exact `zxing-wasm` dev dependency in `package.json` and
   install it.
2. Copy `dist/iife/reader/index.js` as `zxing_reader.js`,
   `dist/reader/zxing_reader.wasm` and `LICENSE` from
   `node_modules/zxing-wasm` into this directory.
3. Replace `LICENSE.zxing-cpp` with the license at the zxing-cpp commit that
   the new release pins (`ZXING_CPP_COMMIT` in the package).
4. Update the version and digests here and in `test/vendor.test.ts`.
5. Check that `src/codecs/qr/qr-worker.js` still matches the `ZXingWASM`
   API (`prepareZXingModule`, `readBarcodes`), then rerun the browser tests.
