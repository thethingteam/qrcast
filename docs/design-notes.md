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
| `qr`, `layers: 3` (color) | ~31 KB/s | nothing special to send | cimbar unavailable |
| `qr`, `layers: 1` (black and white) | ~12.5 KB/s | nothing special to send | poor light or color, most robust |

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

Field notes from phone and tablet tests of the demo:

- **The code's size in the camera picture decides how fast it reads.** The
  cells are about 8 px, so a code that is small in the camera frame gives each
  cell too few pixels. A loopback test with mode B (frames scaled down, no
  camera noise) took about 0.9 s at 700 px, 2.4 to 2.8 s at 520 and 400 px,
  and never finished at 300 px. A real transfer got clearly faster once the
  sender's code was allowed to grow from about 670 px to the screen height.
  Nearest-neighbour or smooth scaling made no difference.
- Only mode Bu gives larger cells at the same screen width (about 1.38×; Bm has
  the same cell size as B in a shorter picture). A sparser cimbar than Bu would
  need a library change.
- Each libcimbar instance reserves a fixed 128 MB heap that does not grow. A
  receiver starts up to three extract workers and one assemble worker, so about
  512 MB at once. An iPad once failed to start with `RangeError: Out of memory`
  and worked after the browser was restarted. Falling back to fewer workers
  when an instance cannot be allocated is not designed yet.

### 5.2 QR codec (Decided)

Moved to `openspec/specs/qr-frame-protocol/` (frame text, fountain code and
color layers) and `openspec/specs/qr-codec/` (descriptor, options, sending,
receiving and limits), with the rationale in the archived `qr-codec` change
(`openspec/changes/archive/`): the vendored Nayuki encoder, the block and
frame limits, sessions, and the shared worker helper.

## 6. Receiver codec detection (Decided)

Moved to the `receiver` spec (Codec detection) and the `qr-codec` spec (Color
detection per capture, Locking on the first frame), with the rationale in the
archived `cimbar-codec` and `qr-codec` changes (`openspec/changes/archive/`).
The receiver does not ask which codec is used: the first codec that decodes a
frame wins.

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
- Sending raw files (no envelope) to official cimbar receivers: after v1.

## 9. Errors

All error codes so far are in the `error-model` spec. The QR codec reuses
them; new codes need a spec change.

## 10. Packaging and offline (Decided)

Moved to `openspec/specs/package-distribution/` (contents, network-free, bundler
support), with the rationale and the rejected alternatives (CDN, base64
inlining, bundled library builds) in the archived `publish` change
(`openspec/changes/archive/`). For cimbar and QR, the asset loading is in the
`codec-contract`, `cimbar-codec` and `qr-codec` specs.

## 11. Package layout (Decided)

Subpath exports (`.`, `./sender`, `./receiver`, `./cimbar`, `./qr`),
`sideEffects: false` and the `dist/` layout are in `packages/qrcast/package.json`,
and the `package-distribution` spec checks that the tarball matches them.

## 12. Repository, tooling and release

Decided:

- Public repo, fresh history. Code, docs, OpenSpec artifacts and commit
  messages are all in English. Commits follow Conventional Commits.
- Published on the public **npm** registry as unscoped `qrcast`. Not GitHub
  Packages, which requires scoped names and an auth token even to install
  public packages.
- Package manager **pnpm** (workspaces), language **TypeScript** (strict),
  tests with Vitest, Node >= 22.
- Wire format changes are breaking changes.
- Versioning, the release PR, trusted publishing and the consumer smoke tests
  moved to the `package-distribution` spec and the archived `publish` change.

Proposed:

- Release 1.0 once the API and wire format are stable.

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

- Optional whole-payload integrity hash in meta (for example SHA-256).
  Deferred by `core-byte-protocol`: it can be added later as a new meta key,
  because unknown keys are ignored.
- Whether the library exports a helper to sanitize names for downloads
  (basename only, strip control characters, cap at 200 bytes, keep the
  extension).
- cimbar memory limits on phones and tablets: whether to start workers one by
  one and fall back to fewer when an instance cannot be allocated, and an
  option to set the worker count (see section 5.1, field notes).
- Reserve the `qrcast` name on npm early (also check `qr-cast`). The owner
  does this by publishing the current `0.0.0`; see the README's "Releasing".

## 15. Planned changes

1. `core-byte-protocol` (done, archived): envelope, size check, codec
   interface, error types.
2. `cimbar-codec` (done, archived): sender, receiver and the cimbar codec
   (single segment), plus `apps/demo` and the browser tests.
3. `qr-codec` (done): the black-and-white and color QR codec, ported from the
   prototype; performance work (worker pool, two-stage decode, 1080p) later.
4. `publish` (done): release-please, trusted publishing, consumer smoke
   tests.

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
  decodes in roughly linear time, while the dense random code in the
  `qr-frame-protocol` spec costs roughly quadratic time (see the `qr-codec` design), so it could lift
  the block-count cap. Worth considering for the QR codec later.
- Blockchain Commons UR (`UR:BYTES/...`): precedent for human-readable
  prefixes on animated QR frames.
