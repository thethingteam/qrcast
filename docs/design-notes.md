# qrcast design notes

These notes record the design decisions made before the first line of code,
with the reasons behind them and the alternatives that were rejected. They are
the starting point for the first OpenSpec changes. As each decision is captured
in `openspec/specs/` (and its rationale in a change's `design.md`), remove it
from this file. Delete the file once it is empty.

Status legend: **Decided** means agreed and not to be reopened without a new
reason. **Proposed** means a recommended default that still needs confirmation.
**Open** means not decided yet.

## 1. Goal

qrcast moves an arbitrary `Uint8Array` from one device to another through a
screen and a camera: the sender shows an animated sequence of codes, the
receiver films it and gets the bytes back. The channel is one-way, so there is
no acknowledgement, no back channel, and no network.

- Bytes in, bytes out. Serializing and parsing the data is the caller's job.
- Headless: no UI, no user-facing strings. The library emits state and errors.
- Works offline. The library never makes a network request and never
  registers a service worker.

Non-goals: WebRTC or any network transport (it needs user interaction and has
compatibility problems), file pickers, download buttons, or other UI.

## 2. Architecture

```
 app bytes (Uint8Array)
        |
        v
 +-------------------------------+
 | envelope                      |  magic, version, flags, meta, body
 +-------------------------------+
        |
        v
 +-------------------------------+
 | size check                    |  v1: one segment, limit = codec.maxPayloadSize
 +-------------------------------+
        |
   +----+------------------+
   v                       v
 +-----------------+   +---------------------+
 | cimbar codec    |   | qr codec            |
 | (default)       |   | layers: 1 | 3       |
 | wirehair + zstd |   | own fountain code   |
 | built in        |   | QRCAST1F/... frames |
 +-----------------+   +---------------------+
```

The codec layer is abstract. Both codecs carry the same envelope. The protocol
does not hard-code any block or payload size; each codec reports its own
limits.

## 3. Envelope

Moved to `openspec/specs/envelope/`, with the rationale in the archived
`core-byte-protocol` change (`openspec/changes/archive/`).

## 4. Compression (Decided)

The envelope-level rules (raw DEFLATE, kept only when smaller, bounded
decompression) moved to the `envelope` spec. Each codec sets whether it wants
compression:

- **cimbar:** never; cimbar already compresses with zstd internally, and
  compressing twice wastes CPU for no gain.
- **qr:** compress.

## 5. Codecs

The sender chooses the codec. The receiver detects it (section 6).

| Codec | Measured speed (prototype, real phone) | Needs | When to use |
|---|---|---|---|
| `cimbar` (default) | ~92 KB/s (mode B) | WebGL, wasm | normal use |
| `qr`, `layers: 3` (color) | ~31 KB/s | Canvas 2D | cimbar unavailable |
| `qr`, `layers: 1` (black and white) | ~12.5 KB/s | Canvas 2D | poor light or color, most robust |

The QR ceiling is capacity per frame x frames per second (about 800 B x 15 fps
= 11.7 KB/s for black and white, x 3 for color). A headless loopback test
reaches 97 % of that, so the receiver is not the bottleneck. cimbar carries
about 6-7.5 KB per frame, which explains the gap.

### 5.1 cimbar codec (Decided)

Moved to `openspec/specs/cimbar-codec/` (with `sender` and `receiver`), with
the rationale in the archived `cimbar-codec` change (`openspec/changes/archive/`):
the unmodified libcimbar v0.6.8 wasm release (MPL-2.0) in classic workers, a
fresh instance per transfer, and the 16 MiB limit with its memory
measurements.

Reference numbers kept for later changes:

- Per-frame capacity: B 7500 B, Bm 5148 B, Bu 3240 B, 4C 7500 B.
- Protocol limits: the file size is stored in 25 bits (32 MiB) and wirehair
  allows at most 64000 blocks, so about 32 MiB for B, Bu and 4C, and about
  25.8 MiB for Bm (after cimbar's zstd). Above that the encoder does not
  fail; it produces wrong metadata. The fixed 128 MB heap binds first.
- Building libcimbar from source (an ES module build, memory growth) is
  still deferred.

### 5.2 QR codec (Decided)

Frame text, entirely in the QR alphanumeric character set
(`0-9 A-Z space $ % * + - . / :`):

```
 QRCAST1F/<SESSION>/<INDEX>/<TOTAL>/<LENGTH>/<CRC32>/<PAYLOAD>
 ^^^^^^^^
 |     ||
 |     |+-- mode    : F = fountain (the only mode in v1; other letters reserved)
 |     +--- version : 1 (one base36 character)
 +--------- family  : QRCAST
```

- The first 8 characters are parsed by position. A receiver can tell a qrcast
  frame from any other QR code (a URL in the camera view, for example) by
  looking at the first 6 characters. Someone who scans a single frame with a
  phone camera sees `QRCAST...` and can search for it.
- `SESSION`: 6 characters `[0-9A-Z]`, random per transfer.
- `INDEX`, `TOTAL`, `LENGTH`: uppercase base36, 1-8 characters.
  `TOTAL` = number of source blocks, `LENGTH` = byte length of the data that is
  fountain-coded (the last block is zero-padded and truncated by `LENGTH`).
- `CRC32`: CRC-32 of the whole fountain-coded data, 8 uppercase hex digits.
- `PAYLOAD`: Base45 of exactly one block. The Base45 alphabet contains `/`, so
  the fields are split at the **first six** `/` only.
- Block size and maximum block count are codec parameters, not protocol
  constants. The prototype used 800 B blocks and at most 5000 blocks (about
  3.8 MB after compression), because fountain decoding cost grows roughly with
  the square of the block count and 5000 still decodes smoothly on a phone.

Fountain code (systematic):

- Frames with `INDEX < TOTAL` carry source blocks. Frames with
  `INDEX >= TOTAL` are repair frames. The schedule inserts one repair frame
  after every 4 source frames; repair indexes keep increasing across passes
  and never repeat.
- A repair frame is the XOR of a subset of source blocks. The subset comes
  from a seed: CRC-32 of the ASCII text `<SESSION>/<INDEX in uppercase
  base36>`, fed to **mulberry32**; block `j` is included when the top bit of
  the `j`-th output is set. If no block is included, include `seed mod TOTAL`.
- The generator MUST be non-linear over GF(2). A pure shift/XOR generator
  (such as xorshift) spans at most 32 dimensions, and decoding never finishes.

Color (`layers: 3`):

- Three QR codes of the same version and size are placed in the R, G and B
  channels. A dark module sets that channel to 0, otherwise to the maximum,
  so all-dark is black, all-light is white, and the rest are 6 pure colors.
  Keep a white quiet zone of at least 4 modules.
- Frames go into the layers in schedule order, three per picture
  (R, G, B = frames 3k, 3k+1, 3k+2). When a pass is not a multiple of 3, the
  last picture continues with frames from the next pass, so no layer is empty.
- The frame text is identical to black and white; color is only a rendering
  option and needs no new mode letter.

## 6. Receiver codec detection (Decided)

The receiver does not ask which codec is used.

```
          +------------------+
 start -->|      DETECT      |  alternate frames: cimbar decoder / QR decoder
          +--------+---------+  (both decoders preloaded)
                   |
     first successful decode
          +--------+---------+
          v                  v
   +-------------+    +-------------+
   | LOCK cimbar |    |  LOCK qr    |  only the locked decoder keeps running
   +-------------+    +-------------+
```

- In QR mode, color versus black and white is decided per capture from the
  saturation of the central region: below the threshold, decode once in
  grayscale; above it, decode the R, G and B channels separately. A failure in
  one channel must not affect the others.
- cimbar pictures are colorful, so during DETECT the QR decoder will try (and
  fail) on them. This is harmless and stops after locking.
- "Nothing decodes" alone cannot tell a codec mismatch from bad lighting or
  distance, which is why detection is positive (first success), not a
  timeout warning.

## 7. Size limits and segmentation (Decided for v1)

- v1 handles **one segment only**. The size check against each codec's
  `maxPayloadSize` moved to the `codec-contract` spec (`core-byte-protocol`).
- Multi-segment transfer comes later, once the basics are stable. The plan is
  a new envelope version byte (for example `0x02` = segment container with
  transfer id, index and count). Single-segment transfers keep sending `0x01`,
  byte-identical to v1, so:
  - new sender + v1 receiver + small file: works;
  - new sender + v1 receiver + large file: clear `unsupported-format`;
  - v1 sender + new receiver: works.
  This makes segmentation a minor release, not a major one.
- Notes for the segmentation design (later): there is no back channel, so the
  sender cannot know when a segment is done. The preferred direction is
  round-robin (show each segment for its estimated time x 1.3, then loop) plus
  an optional manual "next segment" control. Spike needed first: does the
  cimbar decoder keep partial progress for one file while frames of another
  file arrive? Also measure the pause caused by re-instantiating wasm between
  segments.

## 8. Interop with plain cimbar (Decided)

- Receiving plain cimbar files (`acceptRaw`) moved to the `receiver` and
  `cimbar-codec` specs.
- QR frames that do not start with `QRCAST` are always ignored.
- Sending raw files (no envelope) to official cimbar receivers: after v1.

## 9. Errors

All error codes so far are in the `error-model` spec. The QR codec reuses
them; new codes need a spec change.

## 10. Packaging and offline (Decided)

Every user, online or offline, needs the wasm and worker files from somewhere.
qrcast makes the **consumer's bundler** copy them into the consumer's own
build output:

- Assets are referenced as `new URL('./file', import.meta.url)`, written
  literally so bundlers can detect them. No Vite-specific `?url` imports.
- The package is built with **plain `tsc`** (one output file per source file,
  not bundled), plus a script that copies the cimbar and zxing wasm, the
  emscripten glue and the worker scripts next to the emitted JS.
- Rejected:
  - CDN loading (zxing-wasm's default is jsDelivr): breaks offline and strict
    CSP, and makes third-party requests. The zxing wasm is copied into the
    package and located through `locateFile`.
  - Base64 inlining: adds about 2.6 MB to everyone's JS, prevents streaming
    compilation, and needs `blob:` workers that CSP blocks.
  - Vite library mode (inlines assets as base64) and tsup/esbuild bundling
    (does not copy the assets, so they 404 at runtime).
- ESM only, no CommonJS.
- cimbar is loaded with a dynamic import only when the `cimbar` codec is used,
  so QR-only users never download its 1.94 MB wasm.
- For cimbar this is implemented: see the `codec-contract` and
  `cimbar-codec` specs, the archived `cimbar-codec` design (worker loading,
  asset URLs), and the README (Vite `optimizeDeps.exclude`, PWA caching,
  CSP). The QR codec follows the same pattern for zxing (`locateFile`, asset
  URL overrides, `receiver.preload()`).
- Without a bundler (`<script type="module">`), `import.meta.url` points at
  the package itself, so the relative asset URLs still resolve. From an ESM
  CDN on another origin, workers cannot start (`codec-init-failed`); the
  `publish` change adds smoke tests for webpack and no bundler.

Asset sizes: `cimbar_js.wasm` 1.94 MB (607 KB gzip), `cimbar_js.js` 85 KB,
`zxing_reader.wasm` 954 KB.

## 11. Package layout (Decided)

- Subpath exports: `.` (core types and `QrcastError`, runs in Node),
  `./sender`, `./receiver` and `./cimbar` (from `cimbar-codec`); the QR codec
  will add `./qr`.
- `sideEffects: false`.
- Published `dist/`:

```
 dist/
   index.js                core: envelope, size check, types
   sender/index.js
   receiver/index.js
   codecs/cimbar/          index.js, cimbar-worker.js, cimbar_js.<stamp>.js,
                           cimbar_js.<stamp>.wasm, LICENSE (MPL-2.0)
   codecs/qr/              index.js, qr-worker.js, zxing_reader.wasm (planned)
```

## 12. Repository, tooling and release

Decided:

- New public repo, fresh history. Code, docs, OpenSpec artifacts and commit
  messages are all in English. Commits follow Conventional Commits.
- Published on the public **npm** registry as unscoped `qrcast`. Not GitHub
  Packages, which requires scoped names and an auth token even to install
  public packages.
- Versioning with **release-please**.
- Package manager **pnpm** (workspaces), language **TypeScript** (strict).
- CI runs consumer smoke tests in three setups: **Vite**, **webpack**, and
  **no bundler**. Each builds a minimal app that installs the packed package
  and checks that the wasm and workers are emitted and load.
- Wire format changes are breaking changes.

Proposed:

- Layout: `packages/qrcast` (published) and `apps/demo` (Vite, private,
  deployed to GitHub Pages; the demo itself does not need to work offline).
- release-please starts at `0.1.0` with `bump-minor-pre-major`, so breaking
  changes before 1.0 bump the minor version. Release 1.0 once the API and wire
  format are stable.
- npm trusted publishing (GitHub Actions OIDC, with provenance), no stored npm
  token. If pnpm's support for it is unclear, run `npm publish` in the publish
  step.
- Tests with Vitest: Node for the core, browser mode (Playwright) for the
  sender and receiver.
- Node >= 22.

## 13. Testing approach

- End-to-end and stress tests use seeded pseudo-random payloads (xorshift32 is
  fine for generating test data). The seed and size travel in the name, so the
  receiver regenerates the expected bytes and compares them byte for byte; no
  separate checksum is needed.
- A digital loopback (a canvas `captureStream()` used as the camera) gives an
  upper bound without optical loss. Real-device numbers come from manual
  tests.
- SHA-256 via `crypto.subtle` needs a secure context (HTTPS or localhost).

## 14. Open questions

- Confirm the change order (section 15).
- Optional whole-payload integrity hash in meta (for example SHA-256).
  Deferred by `core-byte-protocol`: it can be added later as a new meta key,
  because unknown keys are ignored.
- Whether the library exports a helper to sanitize names for downloads
  (basename only, strip control characters, cap at 200 bytes, keep the
  extension).
- cimbar memory limits on phones.
- Reserve the `qrcast` name on npm early (also check `qr-cast`).
- The pnpm trusted publishing flow: verify during setup. (TypeScript 7
  declaration emit was verified in `core-byte-protocol`.)

## 15. Planned changes

1. `core-byte-protocol` (done, archived): envelope, size check, codec
   interface, error types.
2. `cimbar-codec` (done, archived): sender, receiver and the cimbar codec
   (single segment), plus `apps/demo` and the browser tests.
3. `qr-codec`: port the existing black-and-white and color implementation
   as-is; performance work (worker pool, two-stage decode, 1080p) later.
4. `publish`: release-please, trusted publishing, consumer smoke tests.

## 16. Rejected names and prefixes

- Names avoided: `qrs`, `qifi`, `txqr`, `qrloop` (existing projects),
  `qr-share` (npm already has `qrshare`, so npm rejects `qr-share`; also many
  same-name projects, including a QR + cimbar transfer app), `gapcast` and
  `glyphcast` (well-known GitHub projects), `qrxfer` (an established project
  with the same purpose).
- `scancast` was considered but rejected because most people recognize "QR"
  more than "scan". `cast` was kept because it says what the library is: a
  one-way broadcast.
- Frame prefix `GQ` (from an earlier GeoJSON-specific prototype) is not
  reused. `QC1F` was rejected in favor of the readable `QRCAST1F`, which costs
  about 3 bytes per frame (~0.35 %).

## 17. Prior art

- libcimbar (sz3): the color barcode codec used here.
- A QR + cimbar air-gapped transfer *app* exists (QRShare by s-celles,
  BSD-3-Clause). It is an end-user app that other apps call through a page
  handoff, not an importable library. Its QR and cimbar paths are separate
  (no shared envelope), it loads cimbar relative to the page URL, and it does
  not segment. It uses wirehair-wasm for its QR fountain code. Wirehair
  decodes in roughly linear time, while the dense random code in section 5.2
  costs roughly quadratic time, so it could lift the block-count cap. Worth
  considering for the QR codec later.
- Blockchain Commons UR (`UR:BYTES/...`): precedent for human-readable
  prefixes on animated QR frames.
