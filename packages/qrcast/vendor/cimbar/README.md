# libcimbar (vendored)

The official libcimbar wasm release, used by the `@thethingteam/qrcast/cimbar` codec. The
build copies these files to `dist/codecs/cimbar/`.

**Do not modify these files.** They are MPL-2.0 source files, kept byte for
byte as released so they can be compared with the official release directly.
They also keep their release file names for the same reason.

- Version: v0.6.8
- Source: `cimbar.wasm.tar.gz` from
  https://github.com/sz3/libcimbar/releases/tag/v0.6.8
  (sha256 `0a14b63decd9404e7a319b4b0f5cd873eb6aa325f90df4e965305f523567c4a5`)
- License: MPL-2.0, see `LICENSE` (from the repository root at the same tag)

| File | sha256 |
| --- | --- |
| `cimbar_js.2026-08-21T2336.js` | `c18d4c47ffd9ad4bf6c5e6c9fb1e8a8aabf52eadf5dfa70844b904b1c67d5418` |
| `cimbar_js.2026-08-21T2336.wasm` | `019a0d79419bdee0b918f409cdcfff919c172b75131dac5a36a44385151ca5af` |
| `LICENSE` | `32ee9dbf6196874fc9d406c54a888a6c4cbb9aa4a7f35b46befeaff43a78fe85` |

To verify, run `sha256sum cimbar_js.* LICENSE` in this directory; the output
must match the table. `test/vendor.test.ts` checks the glue and the wasm.

## Updating

1. Download `cimbar.wasm.tar.gz` from the new release and check its sha256
   against the asset digest GitHub shows.
2. Replace the glue and the wasm here with the new
   `cimbar_js.<stamp>.{js,wasm}`, and `LICENSE` with the file from the same
   tag.
3. Update the file names in `src/codecs/cimbar/runtime.ts` and
   `scripts/copy-assets.mjs`, the digests in `test/vendor.test.ts`, and this
   README.
4. The exported functions are an internal interface of libcimbar. Compare the
   new release's `send.js`, `send-worker.js`, `recv.js` and `recv-worker.js`
   with `src/codecs/cimbar/cimbar-worker.js`, then rerun the browser tests
   and the manual checks against the official web sender and receiver.
