# qrcast

Send a `Uint8Array` from one device to another through a screen and a camera.
The sender shows an animated sequence of codes, the receiver films it and gets
the bytes back. No network, no pairing, no back channel.

> **Status: early development.** The core byte protocol, the sender, the
> receiver, the cimbar codec and the QR codec work. The package is not
> published. Expect breaking changes until 1.0.

## Why

- **Bytes in, bytes out.** qrcast moves an opaque `Uint8Array`. Serializing
  and parsing the data is up to you.
- **Headless.** No UI and no user-facing strings: the library reports state
  and typed errors, and your app decides what to show.
- **Offline.** The library never makes a network request (no CDN) and never
  registers a service worker. The wasm and worker files are copied into your
  build by your own bundler.
- **One-way.** Works across an air gap: the receiver never talks back to the
  sender.

## Sending

```ts
import { cimbar } from 'qrcast/cimbar';
import { createSender } from 'qrcast/sender';

const canvas = document.querySelector('canvas')!;
const sender = createSender({ codec: cimbar(), canvas });

sender.on('frame', ({ frame }) => console.log(`frame ${frame}`));
sender.on('error', ({ error }) => console.error(error.code, error.details));

const bytes = new TextEncoder().encode(JSON.stringify({ hello: 'world' }));
await sender.start(bytes, { type: 'application/json', name: 'hello.json' });
// ... later
sender.stop();
```

- **The canvas is yours.** Place and size it with CSS. The sender only sets
  its `width` and `height` to the frame's pixel size (1040 × 1040 for cimbar),
  and draws through a `bitmaprenderer` context, so the canvas must not have
  another context.
- **`start(bytes, hints)`** wraps the bytes in an envelope, checks the size,
  loads the codec, and resolves once the first frame is on the canvas. It
  then plays until `stop()`. Calling `start` again replaces the transfer.
  `destroy()` releases everything.
- **States:** `idle`, `loading`, `playing` and `destroyed` (`sender.state`
  and the `state` event).
- **Events:** `state`, `frame` (the frame count since `start`, from 1), and
  `error` for a codec failure while playing; the sender is then `idle`
  again. `on()` returns a function that removes the listener.
- **Errors from `start`:** `payload-too-large` and `invalid-input` before
  anything loads, `unsupported-environment`, `codec-init-failed`,
  `codec-aborted`, `cancelled` when `stop`, a new `start` or `destroy` ends
  it first, and `invalid-state` after `destroy`.
- Keep the screen awake while sending (for example with the Screen Wake Lock
  API); qrcast does not do it for you.

## Receiving

```ts
import { cimbar } from 'qrcast/cimbar';
import { qr } from 'qrcast/qr';
import { createReceiver } from 'qrcast/receiver';

const video = document.querySelector('video')!;
video.srcObject = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
});
await video.play();

const receiver = createReceiver({ codecs: [cimbar(), qr()], video });
receiver.on('lock', ({ codec }) => console.log(`receiving with ${codec}`));
receiver.on('progress', ({ progress }) => console.log(`${Math.round(progress * 100)} %`));

const result = await receiver.start();
if (result.kind === 'qrcast') {
  console.log(result.meta.name, result.meta.type, result.bytes);
}
```

- **The camera is yours.** The app opens the camera and plays it in a
  `<video>` element. The receiver only reads its frames: it never calls
  `getUserMedia` and never changes the element. While the video has no
  frame, the receiver keeps waiting.
- **`start()`** loads the decoders, reads frames until a file is complete,
  and resolves with it. `preload()` loads the decoders ahead of time, so
  that `start` begins scanning at once. Each `start` uses fresh decoders.
- **Detection:** the receiver tries its codecs in turn, locks to the first
  one that decodes a frame (the `lock` event), then reports `progress` from
  0 to 1. Pass `[cimbar(), qr()]` to receive from a sender that uses either
  codec. A QR code that is not a qrcast frame, such as a URL, never locks.
- **States:** `idle`, `loading`, `detecting`, `receiving` and `destroyed`.
- **Results:** `{ kind: 'qrcast', meta, bytes }`, where `meta` holds the
  original `size` and the sender's optional `type` and `name`. Treat `name`
  as untrusted input before using it as a file name.
- **`acceptRaw: true`** also accepts files sent without a qrcast envelope,
  such as those of the official cimbar web sender, as
  `{ kind: 'raw', name, bytes }` (`name` is `''` when the sender gave none).
  Without it, such a file fails with `unsupported-format`.
- **Errors from `start`:** `unsupported-environment`, `codec-init-failed`,
  `codec-aborted`, the envelope errors (`unsupported-format`,
  `malformed-envelope`), `cancelled` after `stop()` or `destroy()`, and
  `invalid-state` when a `start` is already pending or after `destroy`.

## Codecs

The sender picks the codec; the receiver detects it from the first frame it
decodes.

| Codec | Speed (prototype, real phone) | Needs to send | Status |
|---|---|---|---|
| `cimbar` (default) | ~92 KB/s | WebGL, WebAssembly | available |
| `qr`, `layers: 3` (color) | ~31 KB/s | nothing special | available |
| `qr`, `layers: 1` (black and white, the default) | ~12.5 KB/s | nothing special | available |

### cimbar

`cimbar(options)` from `qrcast/cimbar` uses the unmodified official
[libcimbar](https://github.com/sz3/libcimbar) v0.6.8 wasm release (MPL-2.0),
which ships in the package next to the code that loads it.

- Up to 16 MiB per transfer. The envelope body is not compressed again,
  because cimbar compresses with zstd itself.
- `mode`: `B` (default), `Bm`, `Bu` or `4C`. A sender uses `B` unless told
  otherwise; a receiver without `mode` detects the mode.
- `fps`: frames per second when sending, from 1 to 30 (default 15).
- The encoder and decoders run in workers. Creating the codec loads
  nothing; about 2 MB (mostly the 1.94 MB wasm) is fetched when a transfer
  starts or a receiver preloads.
- `glueUrl`, `wasmUrl` and `workerFactory` replace the bundled files, for
  setups where they cannot be served next to the code (see below).
- Each cimbar file is named `qrcast.bin`, so the official cimbar web receiver
  saves the envelope under that name.

### qr

`qr(options)` from `qrcast/qr` is the fallback for browsers that cannot run
cimbar. It shows QR codes, and a receiver reads them with the unmodified
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.4 reader.

```ts
import { qr } from 'qrcast/qr';
import { createSender } from 'qrcast/sender';

const sender = createSender({ codec: qr({ layers: 3 }), canvas });
```

- `layers`: `1` (default) for black and white, or `3` for color: three QR
  codes in the red, green and blue channels of each picture, about 2.5 times
  faster. Black and white is the default because it is the most robust in
  poor light and on weak screens or cameras. A receiver ignores `layers` and
  decides per capture whether the picture is color.
- `blockSize`: bytes in each QR code, from 100 to 2000 (default 800).
- `fps`: pictures per second when sending, from 1 to 30 (default 15).
- A transfer has at most 5000 blocks, so it carries up to `blockSize` × 5000
  bytes: 4,000,000 with the defaults. The envelope body is compressed before
  it is split. The receiver rebuilds the data from any frames in any order,
  because the sender adds a repair frame after every four source frames.
- QR files do not carry a file name, so with `acceptRaw` a raw file arrives
  with `name` `''`.
- **Sending fetches nothing**: it draws on the main thread and needs no
  worker, no wasm and no WebGL. The canvas is square, at most 1024 pixels
  wide, and keeps its size for the whole transfer. Scale it with CSS and
  `image-rendering: pixelated`, so that the browser does not blur the
  modules.
- Receiving decodes in a worker. About 1 MB is fetched when a receiver starts
  or preloads: the worker, the zxing script (37 KB) and its wasm (954 KB).
- `glueUrl`, `wasmUrl` and `workerFactory` replace the bundled files, the same
  as for cimbar.

## Wire format

Every transfer is wrapped in a small envelope, whatever the codec:

```
 ["QRCAST" 6 B][version 1 B][flags 1 B][meta length LEB128][meta UTF-8 JSON][body]
```

- `version` is `0x01`. A receiver rejects any version it does not know
  instead of guessing.
- `flags` bit 0 marks a raw DEFLATE body; the other bits are reserved and
  must be 0.
- `meta` holds the original body size (`s`) and the optional type hint (`t`)
  and name (`n`), at most 4096 bytes.

The normative specs (envelope, codec contract, error model) live under
[`openspec/`](openspec/). Any change to the wire format is a breaking change.

## Errors

Every error the library raises is a `QrcastError` with a stable `code` and
typed `details`:

```ts
import { QrcastError } from 'qrcast';

try {
  // ...
} catch (error) {
  if (error instanceof QrcastError && error.code === 'payload-too-large') {
    console.log(`${error.details.size} bytes; ${error.details.codec} carries at most ${error.details.limit}`);
  }
}
```

| Code | When |
|---|---|
| `payload-too-large` | The envelope is larger than the codec can carry. Raised before any encoding starts. |
| `unsupported-format` | Unknown magic, envelope version or flag bit, or oversized meta. |
| `malformed-envelope` | The payload looks like qrcast but is truncated or corrupt. |
| `invalid-input` | The caller passed a value the library cannot use (`reason`: `body`, `meta-field`, `meta-too-large`, `codec` or `option`). |
| `unsupported-environment` | The browser lacks a feature the codec needs (`feature`: `worker`, `webassembly`, `webgl` or `video-frame`). |
| `codec-init-failed` | The codec's worker, script or wasm could not be loaded. |
| `codec-aborted` | The codec's wasm instance aborted, for example out of memory. Carries the envelope `size` (sender) or the last `progress` (receiver). |
| `cancelled` | `stop()`, a new `start()` or `destroy()` ended a pending call. |
| `invalid-state` | The call is not allowed in the current state, such as `start()` after `destroy()`. |

## Bundlers and offline use

The codec references its files with `new URL('./file', import.meta.url)`,
which Vite, webpack, Rollup and esbuild understand: your build copies the
worker, the libcimbar or zxing-wasm scripts and the wasm files next to your
own assets, and they are fetched from your origin. qrcast never contacts any other host
and never registers a service worker, so caching those files for offline use is
your app's job (see below).

- **Vite:** exclude qrcast from dependency pre-bundling, or the files 404 in
  development:

  ```ts
  // vite.config.ts
  export default defineConfig({
    optimizeDeps: { exclude: ['qrcast'] },
  });
  ```

- **Offline (PWA):** cache the emitted `.wasm` file with your other assets.
  With `vite-plugin-pwa`, add `wasm` to the glob patterns and raise the size
  limit, because the largest wasm is about 1.94 MB:

  ```ts
  VitePWA({
    workbox: {
      globPatterns: ['**/*.{js,css,html,wasm}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
  });
  ```

- **Served from another origin** (for example an ESM CDN): browsers do not
  start workers from another origin, so a transfer fails with
  `codec-init-failed`. Host the files yourself and pass `workerFactory`
  (and `glueUrl` and `wasmUrl` if needed) to `cimbar()` or `qr()`.

## Requirements

- ESM only. Node 22 or later for the core; the sender and receiver entry
  points can be imported in Node (for server-side rendering) but run only in
  browsers.
- Sending with cimbar: Web Workers, WebAssembly, WebGL on `OffscreenCanvas`,
  and `CompressionStream`.
- Receiving with cimbar: Web Workers, WebAssembly and `VideoFrame`.
- Sending with QR: nothing beyond Canvas 2D and `createImageBitmap`.
  Receiving with QR: Web Workers, WebAssembly and `VideoFrame`, plus
  `OffscreenCanvas` 2D in workers (Safari 16.4).
- Tested automatically in Chromium. Safari needs version 17 or later to send
  (WebGL on `OffscreenCanvas`) and 16.4 or later to receive; Safari and
  Firefox are not tested yet. A missing feature is reported as
  `unsupported-environment`.
- Content Security Policy: WebAssembly needs `'wasm-unsafe-eval'` in
  `script-src`, and the workers need `worker-src 'self'` (or a `script-src`
  that allows your origin). No `blob:` URLs are used.

## Development

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm --filter qrcast exec playwright install chromium   # once, for the browser tests
pnpm build          # tsc and the asset copy: packages/qrcast/dist, then the demo
pnpm test           # type checks, then the Node tests
pnpm test:browser   # browser tests in headless Chromium (real cimbar loopback)
pnpm smoke          # packs the package and builds it into minimal apps: no bundler, Vite, webpack
pnpm typecheck
pnpm --filter demo dev   # the demo app over HTTPS, reachable from phones on the LAN
```

The demo (`apps/demo`) is for trying transfers between real devices. The
entry page offers examples with known content (text, JSON, GeoJSON, an image,
a random body) and your own files. The send page lets you tune the code
density for the screen (QR block size, cimbar mode) and shows the payload's
size and short SHA-256. The receive page shows the same, says whether a known
example arrived intact, and previews it. The demo depends on the built
package, so run `pnpm build` first. Its tests run with `pnpm --filter demo test`.

`pnpm smoke` installs the packed tarball (not the workspace sources) into three
minimal apps under `smoke/`, builds them, checks that the wasm and worker files
are emitted, and loads each in headless Chromium, failing on any request that
leaves the page's origin. Run `pnpm build` first. It needs network access to
install Vite and webpack.

## Releasing

For maintainers. Releases are built from Conventional Commits (`feat:` and
`fix:`): release-please keeps a release PR open with the next version and the
changelog, and merging that PR tags `vX.Y.Z` and publishes `qrcast` to npm from
GitHub Actions with provenance. There is no npm token. Before 1.0, a breaking
change bumps the minor version. Check the release PR's diff before you merge
it, because merging publishes.

One-time setup, in this order:

1. In the repository's Settings, Actions, General, turn on "Allow GitHub
   Actions to create and approve pull requests". release-please needs it to
   open the release PR.
2. Claim the name by publishing the current `0.0.0` by hand. This version has
   no provenance, and the first real release (`0.1.0`) comes from CI:

   ```sh
   pnpm install
   pnpm build && pnpm test
   cd packages/qrcast
   npm login
   npm publish --access public --provenance=false
   ```

3. On npmjs.com, open the `qrcast` package, then Settings, Trusted Publisher,
   and add a GitHub Actions publisher: your GitHub user or organization, the
   repository `qrcast`, and the workflow file name `release.yml`. npm only
   allows this once the package exists.

Check the current npm behavior when you do this: if npm can attach a trusted
publisher to a package that does not exist yet, step 2 is not needed.

To roll back a bad release, deprecate it and ship a fixed patch release:

```sh
npm deprecate qrcast@X.Y.Z "Broken, use X.Y.Z+1"
```

For reliable reading, make the code as large as the sender's screen allows
(the demo has a full-screen button) and hold the camera so the code fills much
of the picture. A code that is small in the camera frame reads slowly or not
at all. On a small screen, pick the "Large cells" cimbar mode (Bu) or a lower
QR block size.

Repository layout:

```
packages/qrcast/   the published library (src, test, vendor/cimbar, vendor/zxing-wasm)
apps/demo/         demo app (private, not published)
openspec/          specs and change proposals
docs/              design notes: decisions not yet captured in specs
```

Contributions:

- Read [`docs/design-notes.md`](docs/design-notes.md) before planning a
  change. Decisions marked **Decided** are not reopened without a new reason.
- Changes are planned with [OpenSpec](https://github.com/Fission-AI/OpenSpec)
  (`openspec/changes/`) before they are implemented.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/);
  the changelog is generated from them.
- Everything in the repository is written in English.

## License

[MIT](LICENSE). The bundled libcimbar files ship unmodified under their own
MPL-2.0 license (`packages/qrcast/vendor/cimbar/LICENSE`, copied next to them
in the package). The bundled zxing-wasm files ship unmodified under its MIT
license, and zxing-cpp inside the wasm under Apache-2.0
(`packages/qrcast/vendor/zxing-wasm/LICENSE` and `LICENSE.zxing-cpp`, copied
next to them in the package). The QR encoder is adapted from Project Nayuki's
QR Code generator library (MIT; the notice stays in
`packages/qrcast/src/codecs/qr/qrcodegen.ts`).
