# Proposal

## Why

cimbar needs WebGL on an `OffscreenCanvas` and WebAssembly to send. Where
it cannot run (older Safari, locked-down browsers, poor GPUs), qrcast cannot
move any bytes. The design calls for a QR codec as the fallback. The private
prototype already proved one on real phones: about 12.5 KB/s in black and
white and 31 KB/s in color. Porting it now gives qrcast a working fallback
before the first release. The sender and receiver core was built so that a
second codec only needs a driver.

## What Changes

- Add the QR codec (`qrcast/qr`):
  - `qr({ layers, blockSize, fps })` is a lightweight descriptor:
    - name `qr`, and the envelope body is compressed;
    - `maxPayloadSize` is `blockSize` × 5000 blocks (4,000,000 bytes with
      the default 800-byte blocks).
  - `layers: 1` (black and white, the default) or `layers: 3` (color: three
    QR codes in the R, G and B channels of one picture).
  - Sending draws QR codes in alphanumeric mode, error correction level L, with one QR version for the whole transfer and a 4-module quiet
    zone. It needs no WebGL and no WebAssembly.
  - Receiving decodes with zxing-wasm in a classic worker. It decides per
    capture whether the picture is color or black and white, and rebuilds the
    data with the fountain decoder.
  - Escape hatches, the same as cimbar: `glueUrl`, `wasmUrl` and
    `workerFactory` for the zxing files.
- Define the QR wire format, decided in the design notes:
  - Frame text `QRCAST1F/<SESSION>/<INDEX>/<TOTAL>/<LENGTH>/<CRC32>/<PAYLOAD>`
    with a Base45 payload.
  - A systematic fountain code: one repair frame after every four source
    frames, with the repair composition seeded by CRC-32 and mulberry32.
  - The order in which frames fill the color layers.
  - Receivers ignore QR codes that do not start with `QRCAST`.
- The receiver can be created with `[cimbar(), qr()]`. It detects which one
  the sender uses, and locks to it.
- Ship the zxing-wasm v3.1.4 reader build (IIFE script and wasm; MIT, with
  zxing-cpp under Apache-2.0) unmodified in the package. It is loaded from
  the package, never from zxing-wasm's default CDN.
- Ship a QR encoder in the source: an adapted copy of Project Nayuki's QR
  Code generator (MIT). It adds no runtime dependency.
- Extend `apps/demo` with a codec choice (cimbar or QR, layers, block size)
  on the send page, and `[cimbar(), qr()]` on the receive page.
- Add browser loopback tests for QR in black and white and in color, and
  for detection between cimbar and QR.

Out of scope (left for later changes):

- Performance work: a decoder worker pool, two-stage decode, 1080p capture,
  and rendering QR frames in a worker.
- Using wirehair in place of the dense random fountain code.
- Multi-segment transfers.
- Frame modes other than `F`.
- Webpack and no-bundler smoke tests, which belong to the `publish` change.

## Capabilities

### New Capabilities

- `qr-frame-protocol`: the QR wire format. It covers the frame text and its
  fields, invalid frames, source block padding, the systematic fountain code
  (schedule, repair composition, decoding) and the order of frames in color
  layers. Changing it is a breaking change.
- `qr-codec`: the QR codec. It covers its descriptor and options, how it
  renders frames, how it receives (color detection, sessions, integrity
  check), its limits, workers and failures, and the bundled zxing-wasm files.

### Modified Capabilities

- `receiver`: codec detection gains a scenario with two real codecs,
  cimbar and QR.

## Impact

- New public entry point `qrcast/qr` in the package `exports`.
- New package contents in `dist/codecs/qr/`:
  - a hand-written classic worker;
  - the zxing-wasm reader script (about 37 KB) and wasm (954 KB);
  - their licenses (zxing-wasm MIT, zxing-cpp Apache-2.0).

  The build's asset copy step copies them.
- Consumers' bundlers emit about 1 MB of assets when they import
  `qrcast/qr`. The wasm is fetched only when a QR receiver starts or
  preloads; sending with QR fetches nothing.
- No new runtime dependencies. The QR encoder is in the source, and zxing is
  vendored under `packages/qrcast/vendor/zxing-wasm/`.
- `README.md`: the codec table marks QR as available, and a QR section is
  added.
- `docs/design-notes.md`: once the specs are archived, sections 5.2 and 6,
  the QR parts of 8, 10 and 11, and the QR notes in 17 move into the specs
  and the archived design.
