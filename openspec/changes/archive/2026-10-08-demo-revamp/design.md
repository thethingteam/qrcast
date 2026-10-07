# Design

## Context

The demo is three static pages and three small modules (`send.ts`,
`receive.ts`, `random.ts`) built by Vite. The library already exposes what the
controls need: QR `blockSize` (100–2000) and `fps`, and cimbar `mode`. The
cimbar per-frame capacities are B 7500 B, Bm 5148 B, Bu 3240 B and 4C 7500 B
(design notes). See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Make a transfer self-checking without a person inspecting the file.
- Make the code size a first-class control, especially for phone to desktop.
- Keep the demo dependency-free and offline-capable.

**Non-Goals:**
- New cimbar densities, or any library API change.
- A design system or component framework. Plain CSS and TypeScript stay.
- Recording measured speeds (done after this change, on real devices).

## Decisions

**One example registry, shared by both pages.** `examples.ts` exports each
example's id, name, MIME type and a `bytes()` function. Names follow
`qrcast-example-<id>.<ext>`, like the random body's name today. The receiver
looks the received name up in the registry and compares bytes. Alternative: put
the expected hash in the envelope meta. Rejected: it makes the check depend on
the sender and so proves less, and it would add to the library's contract.

**Verification by hash display plus registry match.** The hash lets a person
compare custom files across devices; the registry gives a hard verdict for
examples. SHA-256 comes from `crypto.subtle`, which the demo already has
because it is served over HTTPS for the camera.

**Example content is generated or committed, never encoded by the browser.**
Text, JSON and GeoJSON are built from literals in code. The image is one small
PNG committed under `public/` and fetched as a same-origin file. Canvas PNG
encoding differs by browser, so it would break byte equality across devices.

**Routing by query string, not by more HTML pages.** The cards link to
`send.html?example=<id>`. Alternative: one page per example. Rejected: they
would differ only by the registry id.

**GeoJSON preview is a hand-written SVG projection.** Equirectangular scaling
of the bounding box, for Point, LineString, Polygon and their Multi forms.
Alternative: Leaflet. Rejected: it fetches tiles, and the library must not
make network requests; the demo should not suggest otherwise.

**Sizing the code from the layout, not a fixed pixel size.** The sender draws
into the canvas at the codec's native resolution; CSS scales it to
`min(100vw, free height)` with `image-rendering: pixelated`. The Fullscreen API
adds the remaining area. This changes the physical module size without
touching the codec.

**Density control per codec.**
- QR: a slider on `blockSize` with its range. The page shows frames per code
  (`ceil(size / blockSize)`) and the estimated time (frames / fps, plus the
  repair overhead of 25 %). A smaller block gives a lower QR version and larger
  modules at the same screen size.
- cimbar: the mode select is relabeled by what it does to a code shown at a
  fixed width. Measured in Chromium (picture size, and color transitions
  counted along a middle row as a proxy for cell size):

  | Mode | Picture | Transitions per row | Cell size at equal width |
  |------|---------|---------------------|--------------------------|
  | B    | 1040×1040 | ~250 | 1.00× |
  | 4C   | 1040×1040 | ~265 | 1.00× |
  | Bm   | 1040×736  | ~270 | 1.00× (shorter picture) |
  | Bu   | 752×656   | ~180 | about 1.38× |

  Only Bu gives larger cells; Bm is the same density in a landscape picture.
  So the cimbar choice is "Standard" (B), "Wide" (Bm), "Large cells" (Bu) and
  "4 colors" (4C). A sparser cimbar than Bu would need a library change.
- The "small screen" preset: QR block size 200, one layer; cimbar Bu (the
  largest cells measured).

**Styling by CSS variables and one stylesheet.** `style.css` is shared, with
`prefers-color-scheme` and a `data-theme` override as in the artifact guidance.
Controls are native elements (`input[type=range]`, `select`, `button`) styled
for touch (44 px targets). Alternative: Tailwind. Rejected: it adds a build
dependency to a demo with three pages.

## Risks / Trade-offs

- [The cimbar modes are a weak density ladder] → Measured: only Bu helps (about 1.38×). The out-of-scope note covers the library follow-up.
- [Sparser QR means more frames and a longer transfer] → The estimate is
  shown next to the slider so the trade-off is visible.
- [Registry match by name can be fooled by a custom file with an example's
  name] → Acceptable for a demo; the page states "matches the example", not
  "authentic".
- [Fullscreen is unavailable on iOS Safari for non-video elements] → The code
  still scales to the viewport; the button is hidden when the API is missing.

## Open Questions

- Which sample image to ship (any small, license-free PNG under 20 KB).
