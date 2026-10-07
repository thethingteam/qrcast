# qrcast

Send a `Uint8Array` from one device to another through a screen and a camera.
The sender shows an animated sequence of codes, the receiver films it and gets
the bytes back. No network, no pairing, no back channel.

> **Status: early development.** Only the core byte protocol (envelope, size
> check, error types) is implemented. The cimbar and QR codecs, the sender and
> the receiver are not built yet, and the package is not published. Expect
> breaking changes until 1.0.

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

## Codecs (planned)

The sender picks the codec; the receiver detects it from the first frame it
decodes.

| Codec | Speed (prototype, real phone) | Needs | When to use |
|---|---|---|---|
| `cimbar` (default) | ~92 KB/s | WebGL, WebAssembly | normal use |
| `qr`, `layers: 3` (color) | ~31 KB/s | Canvas 2D | cimbar unavailable |
| `qr`, `layers: 1` (black and white) | ~12.5 KB/s | Canvas 2D | poor light or color, most robust |

The cimbar codec uses [libcimbar](https://github.com/sz3/libcimbar)
(MPL-2.0). The QR codec uses its own fountain code, so frames can be missed
or arrive in any order.

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
| `invalid-input` | The caller passed a value the library cannot use. |

## Requirements

- ESM only. Node 22 or later for the core.
- Browsers: `CompressionStream`, plus WebGL and WebAssembly for cimbar.
- Content Security Policy: WebAssembly needs `'wasm-unsafe-eval'` (once the
  codecs land).

## Development

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm build      # tsc, emits packages/qrcast/dist
pnpm test       # type checks, then Vitest
pnpm typecheck
```

Repository layout:

```
packages/qrcast/   the published library (src, test)
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

[MIT](LICENSE). The bundled libcimbar files will ship unmodified under their
own MPL-2.0 license.
