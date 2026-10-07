# Tasks

## 1. Density measurement

- [x] 1.1 Render a cimbar frame in each mode (B, Bm, Bu, 4C) and record the cell size relative to the picture; verify by writing the numbers into `design.md` under Decisions and adjusting the control labels to match
- [x] 1.2 Decide the small-screen preset values from 1.1 and the QR block size range; verify they are written in `design.md`

## 2. Shared pieces

- [x] 2.0 Add Vitest as a dev dependency of `apps/demo` with a `test` script; verify `pnpm --filter demo test` runs (the root `pnpm test` picks it up)
- [x] 2.1 Add `apps/demo/src/examples.ts` with the registry (text, JSON, GeoJSON, image, random) and a name lookup; verify with a Vitest test that each example's bytes are stable and its name round-trips through the lookup
- [x] 2.2 Add `apps/demo/src/hash.ts` (SHA-256 short digest) and `geojson.ts` (SVG preview); verify with Vitest tests for the digest of a known input and for Point, LineString and Polygon output
- [x] 2.3 Add `apps/demo/src/style.css` with the tokens, dark theme, 44 px controls and no horizontal overflow at 360 px; verify in the browser at 360 px and in both themes

## 3. Pages

- [x] 3.1 Rewrite `index.html` as the card entry page; verify each card opens its page and that the page works at 360 px
- [x] 3.2 Rewrite `send.html` and `send.ts`: example from `?example=`, hash display, per-codec density sliders with the frames and time estimate, small-screen preset, screen-fit canvas and full-screen button; verify by starting each codec and checking the estimate against the sender's actual frame count
- [x] 3.3 Rewrite `receive.html` and `receive.ts`: size, hash, example match verdict, typed previews, download link; verify by receiving each example in the browser test setup and checking the verdict, including a corrupted copy

## 4. Integration

- [x] 4.1 Run `pnpm --filter demo build` and `pnpm -r typecheck`; verify both pass and `dist` contains the example image
- [x] 4.2 Check in a real browser that no request leaves the origin while sending, receiving and previewing GeoJSON; verify with the network panel
- [x] 4.3 Update the README demo section and run `openspec validate demo-revamp --strict`; verify both succeed

## 5. Feedback after the first phone test

- [x] 5.1 Add a close-camera control to the receive page and make Start open the camera when it is closed; verify with a fake camera device that the tracks end and the button text toggles
- [x] 5.2 Show a state pill, enable the Start and Stop buttons by state, treat a stop as "Stopped", and scroll the code into view on send; verify the states in the browser on both pages
- [x] 5.3 Show elapsed time and time left while receiving; verify `secondsLeft` in a unit test and the live text during a loopback
- [x] 5.4 Show the speed from the bytes the codes carried, with the compression ratio; verify `wireSize` and `formatRate` in unit tests, and that a random body's speed stays under blockSize × layers × fps in a loopback
- [x] 5.5 Add a camera list and a zoom slider to the receive page, each shown only when the device offers it; verify with two fake camera devices in the browser that the list appears, switching works and the slider follows the reported range
- [x] 5.6 Let the sender's code grow beyond the page column and show the picture size and on-screen size; show the camera rate and the useful frames per second on the receiver; verify in the browser at 1400×900 that the canvas exceeds 720 px and that both readouts appear during a loopback
