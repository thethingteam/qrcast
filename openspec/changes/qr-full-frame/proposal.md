# Proposal

## Why

The QR receiver decodes only the central square of each capture (side = the
shorter edge), and nothing documents it (issue #5). On a landscape camera this
drops a large part of the picture: a 1280×720 laptop webcam never decodes the
left and right 280 pixels. A person sees the whole frame in their preview,
holds the sending phone where it looks fine, and nothing happens: no `lock`
and no error. The cimbar receiver reads the whole frame, so the two codecs
behave differently for the same placement.

## What Changes

- The QR receiver decodes the whole capture at its own resolution instead of
  the central square. A code anywhere in the camera picture can be read.
- Color detection looks at the whole capture: a capture is read as color when
  any part of it is saturated enough, instead of only the central 60 %. A
  color code at the side of a landscape frame is then still read as color.
- No API change and no new option. The issue's alternatives (a `region`
  option, or only documenting the crop) are not needed once the whole frame
  is read.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `qr-codec`: a new requirement that the receiver reads QR codes anywhere in
  the capture, and "Color detection per capture" changes from the central
  region to regions covering the whole capture.

## Impact

- Code: `packages/qrcast/src/codecs/qr/receiver-driver.ts` (no crop) and
  `packages/qrcast/src/codecs/qr/qr-worker.js` (saturation over the whole
  capture).
- Cost: each capture has more pixels (16:9 instead of 1:1, about 1.8×). In a
  local measurement zxing took about 1.6× as long on a full 1920×1080 frame as
  on its central 1080×1080 square. The receiver already skips captures while
  its worker is busy, so a slower decode lowers the capture rate rather than
  queuing work.
- Tests: a new browser test films a 1280×720 canvas with the code near a
  corner, outside the old central square, for black and white and color. A
  second one checks that the decode worker reads a color picture in the
  corner of a large gray capture in all three channels.
- Docs: the README notes that the code may be anywhere in the picture.
