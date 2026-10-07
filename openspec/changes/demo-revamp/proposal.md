# Proposal

## Why

The demo is the only way to try qrcast on real phones, and the first phone
tests showed three problems:

- A received custom file is hard to judge. Nothing says what the right bytes
  are, so a successful download proves little.
- The sender cannot be tuned for a small screen. A phone shows a code as dense
  as a desktop does, in a smaller area, so a desktop webcam cannot read it.
  The QR block size is a bare number field, and the cimbar `mode` select does
  not say that it changes the density.
- The page is unstyled forms and plain text. It is awkward on a phone.

## What Changes

- The entry page lists examples as cards. Each example is a fixed, known
  payload: plain text, JSON, GeoJSON, an image, and the existing random body.
  A card opens the send page for that example. "Your own file" and "Receive"
  are cards too.
- The receive page checks what it received:
  - it shows the size and the first 8 hex digits of the SHA-256, and the send
    page shows the same, so a person can compare them across devices;
  - for a known example it states whether the bytes match the example;
  - it previews by type: text, formatted JSON, GeoJSON drawn as SVG (no map
    tiles, so no network), and images.
- The send page makes the code size adjustable:
  - the code fills the available screen, with a full-screen button;
  - density is one control per codec: QR block size, cimbar mode;
  - a "small screen" preset picks a sparse setting.
- A mobile-first style with a dark theme. Sliders replace number fields and
  show the value, the expected frames per code and the estimated time.

No change to the `qrcast` library or its API.

## Capabilities

### New Capabilities
- `demo-app`: what the demo pages let a person do and check: pick an example,
  tune the code for the screen, and verify the received bytes.

### Modified Capabilities

None.

## Impact

- `apps/demo` only: `index.html`, `send.html`, `receive.html`, `src/`, and a
  small example set (one image file under `public/`).
- No new runtime dependency. Hashing uses the browser's Web Crypto.
- Out of scope: new cimbar densities (needs a library change; decide after the
  phone-to-desktop test), a sender worker, and the reverse-direction speed
  figures, which are recorded after this change.
