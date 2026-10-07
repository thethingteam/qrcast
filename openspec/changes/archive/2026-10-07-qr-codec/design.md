# Design

## Context

See proposal.md for the motivation. The starting point:

- The `cimbar-codec` change built a codec-agnostic sender and receiver core.
  A codec plugs in through internal drivers (`src/internal/codec.ts`):
  - A sender driver has `start(envelope)`, `nextFrame(): ImageBitmap`, `fps`
    and `dispose()`.
  - A receiver driver has `load()`, `canAccept()`, `push(VideoFrame)` and
    `dispose()`. It reports through `onData`, `onProgress`, `onFile` and
    `onFailure`.

  The core owns states, events, the size check, detection, unwrapping and
  `acceptRaw`. It draws bitmaps into the app's canvas through a
  `bitmaprenderer` context.
- The private prototype has a working QR implementation, proven on real
  phones (12.5 KB/s black and white, 31 KB/s color):
  - the frame protocol, fountain encoder and decoder, mulberry32 repair
    seeds, Base45 and CRC-32;
  - color layer composition and saturation detection;
  - a zxing-wasm decoder in a worker, with a `locateFile` override that
    keeps zxing off the CDN.

  It renders with the `qrcode` npm package on the main thread. It also
  assembles on the main thread.
- The wire format is decided in design notes section 5.2. The receiver
  detection is decided in section 6. The packaging rules are in section 10:
  - literal `new URL(..., import.meta.url)` references;
  - classic workers;
  - no CDN;
  - plain `tsc` plus an asset copy step.
- zxing-wasm 3.1.4 publishes a reader IIFE build (`dist/iife/reader/index.js`,
  37 KB). It defines a global `ZXingWASM` and works in a classic worker
  through `importScripts`. Its default wasm location is jsDelivr; the
  `locateFile` override replaces it.

## Goals / Non-Goals

**Goals:**

- Port the prototype's behavior and speed. The wire format follows the
  design notes exactly.
- No runtime dependencies, and the core stays as it is apart from a shared
  worker helper.
- Sending with QR loads no asset at all, so it works where cimbar's
  requirements fail.

**Non-Goals:**

- Being faster than the prototype. A worker pool, two-stage decoding,
  1080p capture and a sender worker come later.
- A QR code generator as public API.

## Decisions

### Layout

```
packages/qrcast/
  vendor/zxing-wasm/          zxing_reader.js (the IIFE), zxing_reader.wasm,
                              LICENSE (MIT), LICENSE.zxing-cpp (Apache-2.0),
                              README.md (version, sha256, update steps)
  src/codecs/qr/
    index.ts                  qr(): validated descriptor, no assets
    options.ts                option validation and defaults
    base45.ts, crc32.ts       pure helpers
    frame.ts                  format and parse QRCAST1F frames
    fountain.ts               session ids, schedule, repair composition (mulberry32),
                              encoder
    decoder.ts                GF(2) decoder (bitset rows, Gauss-Jordan)
    assembler.ts              sessions, integrity check, progress (pure)
    qrcodegen.ts              adapted Nayuki QR Code generator (MIT header kept)
    picture.ts                layers -> scaled RGBA picture
    sender-driver.ts          dynamic-import target
    receiver-driver.ts        dynamic-import target
    runtime.ts                literal asset URLs, worker start
    qr-worker.js              hand-written classic worker (checkJs)
    worker-globals.d.ts       the ZXingWASM global, for tsconfig.worker.json
  src/internal/worker.ts      shared worker start protocol (from cimbar's runtime)
```

The new entry is `./qr` in `exports`. `scripts/copy-assets.mjs` also copies
`vendor/zxing-wasm/*` and `qr-worker.js` to `dist/codecs/qr/`. Everything
under `frame.ts`, `fountain.ts`, `decoder.ts`, `assembler.ts`, `picture.ts`
and `qrcodegen.ts` is pure and runs in Node, so most behavior is tested
without a browser.

### QR encoder: a vendored copy of Nayuki's generator

The sender needs QR codes in alphanumeric mode, at error correction level L,
with a forced version (so that all frames and all color layers match).

Options:

- **`qrcode` (npm)**, which the prototype used: rejected.
  - It is CommonJS.
  - Its dependencies include `yargs` and `pngjs`.
  - It would be qrcast's first runtime dependency.
- **Project Nayuki's QR Code generator** (MIT): chosen. It is a single
  TypeScript file with no dependencies. `encodeSegments(segs, ecl,
  minVersion, maxVersion, mask, boostEcl)` forces a version directly, with
  min = max and `boostEcl = false`.

How the copy is adapted:

- It is copied from a pinned release tag.
- Its `namespace` wrapper becomes ES exports.
- Only the encoder parts qrcast needs are kept.
- The license header stays, and the file notes its origin and changes.

A Node test decodes its output with zxing-wasm, to check it against a real
reader.

### Sender: rendering on the main thread

The QR sender driver works on the main thread, with no worker.

`start(envelope)`:

1. Creates a session id with `crypto.getRandomValues` (rejection sampling
   for an even base36 spread).
2. Splits the envelope into blocks.
3. Picks the transfer's QR version: the smallest one that holds a frame
   whose `INDEX` has 8 base36 digits. That is the longest text the transfer
   can produce, so the version never changes mid-transfer (spec: QR
   symbols).

`nextFrame()`:

1. Takes the next `layers` frames from a global frame counter over the
   schedule. Picture `k` holds frames `3k..3k+2`, which continues across
   passes.
2. Encodes each frame at the fixed version, with an automatic mask.
3. Writes the picture straight into an `ImageData`:
   - white, with a 4-module quiet zone;
   - each module is a `scale × scale` square, where
     `scale = max(1, floor(1024 / (size + 8)))`;
   - a dark module sets its channel to 0.
4. Returns `createImageBitmap(imageData)`.

The core already asks for the next frame as soon as one is shown, so the
next frame is always ready one interval ahead.

Rejected alternatives:

- **An OffscreenCanvas with `drawImage` scaling** works, but needs one more
  browser feature. A direct pixel fill of a 1024² picture costs about a
  millisecond.
- **A sender worker.** A classic worker cannot import the TypeScript
  modules. A module worker would need the
  `new Worker(new URL(...), { type: 'module' })` pattern, which bundlers
  re-bundle, and the `publish` smoke tests cannot check that yet. The
  prototype rendered on the main thread at full speed.
- **Caching source-block matrices** (as the prototype did) only helps from
  the second pass on. It costs up to about 10 MB for 5000 blocks. It was
  left out, and is easy to add later.

Sending checks no browser features (`sendFeatures` is empty), because
`ImageData` and `createImageBitmap` are older than the core's
`bitmaprenderer` requirement.

### Defaults and limits

- **`layers`: 1.**
  - Black and white is the most robust in poor light and on screens or
    cameras with weak color.
  - QR is the fallback codec, chosen when cimbar's requirements fail, so
    robustness matters more than speed here. Apps that know their setup
    can pass `layers: 3` for about 2.5 times the speed.
  - The prototype also defaulted to black and white.
- **`blockSize`: 800 bytes, allowed from 100 to 2000.**
  - 800 is the prototype's measured setting: about version 27, and it
    scans well on phones.
  - Blocks above about 2000 bytes need versions near 40, which phones
    rarely read from a screen.
  - Below 100 bytes, the header overhead dominates.
- **At most 5000 blocks.** The dense random fountain code costs roughly the
  square of the block count to decode, and 5000 still decodes smoothly on a
  phone (prototype). So `maxPayloadSize = blockSize × 5000`, and receivers
  reject `TOTAL > 5000`. This also bounds the memory a hostile frame can
  make a receiver allocate.
- **`fps`: 15, allowed from 1 to 30**, the same range as cimbar.

### Receiver: capture, decode worker, assembly on the main thread

1. **Capture.** `push(frame)` crops the central square (side = the shorter
   edge) with `createImageBitmap(frame, sx, sy, side, side)`, closes the
   frame, and transfers the bitmap to the decode worker.
   - This is the prototype's path, proven on iPhone.
   - Cropping before any copy keeps the transfer small.
   - It avoids `VideoFrame.copyTo` with RGBA conversion, whose support is
     narrower.
2. **Decode worker** (`qr-worker.js`, classic). On `init` it:
   - calls `importScripts(glueUrl)`;
   - calls `ZXingWASM.prepareZXingModule` with a `locateFile` that returns
     `wasmUrl` and `fireImmediately: true`;
   - posts `ready`, or the failure.

   For each bitmap it:
   - draws the bitmap into an OffscreenCanvas 2D context and reads the
     pixels;
   - computes the mean saturation (max − min of R, G and B) over a 64 × 64
     sample grid of the central 60 %;
   - below 24, reads the QR codes once;
   - otherwise, separates the R, G and B channels into grayscale images and
     reads each one inside its own `try`;
   - calls `readBarcodes` with `formats: ['QRCode']`, `tryHarder: true`,
     `tryRotate: false`, `tryInvert: false` and `maxNumberOfSymbols: 1`;
   - posts the valid texts, without duplicates.

   The threshold and the sampling are the prototype's. A black and white
   picture misread as color still decodes the same frame three times, so
   the threshold is set low on purpose.
3. **Flow control.** There is one decode worker, with at most 2 bitmaps in
   flight. When the worker is busy, `canAccept()` returns false and the core
   skips the capture.
4. **Assembly on the main thread** (`assembler.ts`, pure):
   - It parses each text and ignores anything that is not a valid frame.
   - It keeps up to two sessions, each with its own GF(2) decoder.
   - It reports `onData` on the first valid frame, and `onProgress` (rank ÷
     `TOTAL`) when the most recently advanced session gains information.
   - When a session is complete, it checks the CRC-32. On a match it reports
     `onFile(bytes, '')`. On a mismatch it resets that session.

Why the fountain decoder stays on the main thread:

- The decode worker is a classic script and cannot import the TypeScript
  decoder; the same module-worker problem as for the sender applies.
- The prototype assembled on the main thread with no visible cost. A
  repair frame costs about `rows × (blockSize + TOTAL / 8)` byte operations,
  around 1 ms at 5000 blocks with 1000 pending rows.

Why two sessions, and not one locked session:

- A headless library cannot show a "new transfer detected, switch?" prompt,
  as the prototype did.
- Keeping one locked session would leave the receiver stuck when the
  sender restarts with new bytes.
- Two sessions cover the restart case and keep memory bounded: at worst
  about 2 × (4 MB data + 3 MB rows).

Why a CRC mismatch resets the session instead of failing:

- QR's own error correction makes a mismatch very rare. When one happens,
  it most likely comes from a single bad frame.
- The sender keeps looping, so starting the session again recovers it.
- Failing would need a new error code and gives the app nothing to do
  except restart.

Why the repair generator is mulberry32:

- It must be non-linear over GF(2). A pure shift-and-XOR generator (such as
  xorshift) spans at most 32 dimensions, so repair frames built from it can
  never finish a transfer. mulberry32's integer multiplications break that
  linearity.

Why detection is positive (the first success), not a timeout warning:

- "Nothing decodes" alone cannot tell a codec mismatch from bad lighting or
  distance.
- cimbar pictures are colorful, so while detecting, the QR decoder tries (and
  fails) on them. This is harmless and stops after locking.

Unknown frame versions or modes (`QRCAST2F`, `QRCAST1X`) are ignored like
any other QR code. Failing on them would let one stray code end a
transfer. A newer sender is still noticed: the receiver never locks.

### Shared worker start protocol

The worker start code in `src/codecs/cimbar/runtime.ts` moves to
`src/internal/worker.ts`, with the codec name as a parameter. It covers:

- the factory or the default worker;
- the `init` message;
- `ready` or the failure;
- the 30 s timeout;
- `error` and `messageerror` mapped to `codec-init-failed` before `ready`
  and to an abort after it;
- `terminate`.

The cimbar runtime keeps its asset URLs and calls the helper, and cimbar's
existing tests guard the move. The alternative, a copy of the code in the
QR runtime, would duplicate about 80 lines of failure handling.

### Asset references and overrides

`src/codecs/qr/runtime.ts` holds the literal references:

```ts
const WORKER_URL = new URL('./qr-worker.js', import.meta.url);
const GLUE_URL = new URL('./zxing_reader.js', import.meta.url);
const WASM_URL = new URL('./zxing_reader.wasm', import.meta.url);
```

- They follow the cimbar pattern: the worker URL goes through a variable,
  so bundlers emit the classic script as is.
- The overrides `glueUrl`, `wasmUrl` and `workerFactory` are resolved
  against the page.
- The vendored IIFE is renamed from `index.js` to `zxing_reader.js`. The
  vendor test still compares digests with the npm files.
- The IIFE contains the jsDelivr URL only as a default. The `locateFile`
  override means it is never requested; a browser test checks that.

### Testing

**Node (Vitest).** Pure modules and the codec descriptor:

- Base45: the RFC 9285 vectors (`AB` → `BB8`, `Hello!!` → `%69 VD92EX0`,
  `base-45` → `UJCLQE7W581`) and invalid input.
- CRC-32: `123456789` → `CBF43926`.
- Frames: formatting, parsing, and every kind of invalid frame in the spec.
- mulberry32 and the repair composition (spec vectors), and the schedule
  (`TOTAL` 10).
- The decoder: filling a gap, repair frames only, frames that add no new
  information, and a 4500-block transfer that drops 20 % of source frames.
- The assembler:
  - two sessions, and eviction of a third;
  - a CRC mismatch that resets the session;
  - progress fractions;
  - mismatched frames within a session.
- Pictures: channel values, the quiet zone, the scale, and the color order
  across passes.
- `qrcodegen` output read by zxing-wasm in Node (a dev dependency pinned to
  3.1.4).
- Options and descriptor validation.
- A vendor digest test against the zxing-wasm 3.1.4 files.

**Browser (Vitest browser mode, Chromium).** The existing config gains a
middleware that serves `vendor/zxing-wasm/` at `src/codecs/qr/`. The tests:

- loopback transfers in black and white and in color;
- detection with `[cimbar(), qr()]` in both directions;
- an unrelated QR code that does not lock;
- a sender restart that resolves with body B;
- a bad `wasmUrl`;
- an abort, through a fixture worker;
- sending without `WebAssembly`;
- a constant canvas size;
- no request to another origin (`performance.getEntriesByType('resource')`).

**Manual.** With `apps/demo`, a phone receives from a desktop in black and
white and in color, and a desktop receives from a phone.

## Risks / Trade-offs

- [Main-thread QR encoding causes jank on slow phones, up to 3 symbols per
  picture in color] → Measure in the demo. The fix (a module worker, or
  caching symbols) does not change the specs.
- [Main-thread fountain decoding near 5000 blocks] → The prototype showed
  it is acceptable. It can move to a worker later.
- [The saturation threshold is tuned on few devices] → It is an internal
  constant. The receiver also decodes three channels of a black and white
  picture correctly, so a low threshold only costs time.
- [Vendored Nayuki code drifts from upstream] → It is pinned to a tag,
  covered by the zxing round-trip test, and the README records how to
  update it.
- [The zxing IIFE contains a CDN URL string] → It is unused because of
  `locateFile`. A browser test asserts that no request goes to another
  origin.
- [OffscreenCanvas 2D in workers needs Safari 16.4] → `VideoFrame` already
  requires 16.4 for receiving, so this adds no new limit.
- [Default `layers: 1` is slower than color] → This is a deliberate choice
  for robustness. It is documented in the README, and `layers: 3` is one
  option away.

## Migration Plan

Additive and pre-1.0. Existing cimbar users see no change, apart from the
internal move of the worker helper.

## Manual check results

Checked with `apps/demo` on 2026-10-07 (task 8.3):

- A phone receiving from the desktop works in all three modes: QR black and
  white, QR color (`layers: 3`) and cimbar.
- Not measured yet: transfer speed, and the exact phone model and browser.
- Not tested yet: a desktop receiving from a phone. The owner will check it,
  and record speeds, after the demo and its interface are reworked.

## Open Questions

- The best saturation threshold and crop on phones (it only tunes internal
  constants).
- Whether a second decode worker helps phones (performance work, later).
