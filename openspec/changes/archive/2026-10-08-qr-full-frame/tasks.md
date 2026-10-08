# Tasks

## 1. Decode the whole capture

- [x] 1.1 Add a browser test in `packages/qrcast/test/browser/qr-receiver.test.ts` that films a 1280×720 canvas onto which the sender's QR canvas is drawn 360 pixels wide in the bottom right corner (outside the central 720×720 square), for `layers: 1` and `layers: 3`; verify both cases fail (time out without `lock`) before the fix
- [x] 1.2 In `packages/qrcast/src/codecs/qr/receiver-driver.ts`, pass the whole frame to `createImageBitmap` instead of the central square; verify the black and white case of 1.1 passes
- [x] 1.3 In `packages/qrcast/src/codecs/qr/qr-worker.js`, spread the 64 × 64 saturation samples over the whole capture and treat the capture as color when any of its 4 × 4 regions reaches the threshold; add a browser test that posts a 3840×2160 gray capture with a color picture in its corner straight to the decode worker and expects all three channels' texts (the loopback case of 1.1 cannot tell, because a grayscale read still decodes the green layer); verify that test fails before the change and passes after, and `pnpm typecheck` passes (the worker is type-checked)

## 2. Docs and checks

- [x] 2.1 In `README.md` and `packages/qrcast/README.md`, state that the QR receiver reads the code anywhere in the camera picture; verify both READMEs say the same
- [x] 2.2 Run `pnpm test`, `pnpm test:browser` and `pnpm build` in `packages/qrcast`, and `openspec validate qr-full-frame --strict`; verify all pass
