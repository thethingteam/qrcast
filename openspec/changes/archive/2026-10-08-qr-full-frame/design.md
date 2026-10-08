# Design

## Context

See proposal.md for the problem. Today `push(frame)` in the QR receiver
driver calls `createImageBitmap(frame, sx, sy, side, side)` with
`side = min(displayWidth, displayHeight)`, and the decode worker then
samples a 64 × 64 grid over the central 60 % of that square to decide
whether the capture is color (mean saturation ≥ 24). The archived `qr-codec`
design chose the crop to keep the bitmap transfer small and left "the best
saturation threshold and crop on phones" open. The cimbar receiver copies
the whole frame.

## Goals / Non-Goals

**Goals:**

- A QR code anywhere in the capture can be read, in black and white and in
  color, on landscape and portrait cameras.
- No new option and no API change.

**Non-Goals:**

- Decode speed work (a worker pool, two-stage decoding). It stays in the
  later performance work listed in the `qr-codec` design.
- Tuning the saturation threshold itself; it stays at 24.

## Decisions

### Decode the whole capture at its own resolution

`push` calls `createImageBitmap(frame)` with no source rectangle. Nothing else
in the capture path changes: the bitmap is still transferred to the worker,
which draws it into an OffscreenCanvas sized to the bitmap.

Local measurement (Node, the vendored zxing wasm, a synthetic frame with a
gray background, `tryHarder: true`), mean time per `readBarcodes` call:

| Capture | Central square | Whole frame | Whole frame scaled to the square's pixel count |
| --- | --- | --- | --- |
| 1280×720, block 800 | 4.1 ms | 6.6–6.9 ms | 4.0–4.1 ms |
| 1920×1080, block 800 | 7.7–8.4 ms | 13.1–13.9 ms | 7.7–8.0 ms |
| 1920×1080, block 2000 | 9.5–10.0 ms | 14.5–15.6 ms | 8.9–13.5 ms |

All three read every code from 2 to 6 pixels per module, wherever the
whole-frame variants found it.

Alternatives:

- **Scale the whole frame down to the square's pixel count.** Same cost as
  today, but a 16:9 frame loses 25 % of its pixels per module. The issue's
  case is a 720p laptop webcam, where a 400-pixel code at block size 800 has
  about 3.8 pixels per module; scaled, it would have about 2.9, close to where
  real camera blur stops decoding. It also needs `createImageBitmap` resize
  options, whose support on older Safari is less certain than the plain call.
  Rejected: the receiver is not the bottleneck (the `qr-codec` design measured
  97 % of the sender's ceiling in a loopback), and a slower decode only lowers
  the capture rate because `canAccept()` already skips captures while two are
  in flight.
- **A `region: 'center-square' | 'full'` option.** It adds API surface for a
  choice an app has no good reason to make. Rejected.
- **Only document the crop.** Leaves landscape receivers broken. Rejected.

### Color detection over regions covering the whole capture

The worker keeps the 64 × 64 sample grid but spreads it over the whole
capture, and groups it into 4 × 4 regions of 16 × 16 samples. The capture is
color when the mean saturation of any region is at least 24.

Why not keep the central 60 %: a color code in a corner of a landscape frame
overlaps the center little, so the gray background around it pulls the mean
below the threshold. The capture is then read once in grayscale, which cannot
decode a three-layer picture. Why not the mean over the whole capture: the
same dilution, worse. With 4 × 4 regions, a code at least twice a region's
size covers one region almost completely, and a smaller code still fills a
large part of one.

The bias toward color is deliberate and unchanged from the `qr-codec` design:
a black and white picture misread as color is still decoded (three times, in
each channel), while a color picture misread as black and white is not
decoded at all.

## Risks / Trade-offs

- [Each capture costs more: about 1.6× the decode time for 16:9 frames, and
  the bitmap transfer is about 1.8× larger] → Flow control drops captures
  while the worker is busy, so the cost lowers the capture rate instead of
  building a queue. The fountain code tolerates missed frames. Phones are
  slower than the measurement machine; if they fall behind, the planned
  performance work (more decode workers) is the fix, not a crop.
- [Color decoding of a 1080p capture runs zxing three times on 2 MP instead
  of 1.2 MP] → Same mitigation; color pictures carry three frames per
  capture, so they still make more progress per decode than black and white.
- [A saturated object filling one sixteenth of the picture (a red mug, a
  colorful poster) makes black and white captures decode three times] → They
  still decode; only the capture rate drops. Before this change the same
  object in the center had the same effect.

## Migration Plan

None. The wire format and the API do not change. Apps that drew the central
square over their preview as a workaround can drop it.
