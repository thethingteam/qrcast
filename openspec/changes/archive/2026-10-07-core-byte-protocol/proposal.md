# Proposal

## Why

Both planned codecs (cimbar and QR) must carry the same bytes in the same
wrapper, report limits the same way, and fail with the same error shapes.
That shared layer has to exist before either codec can be built, and the
repository has no code or package yet to put it in.

## What Changes

- Set up the minimal workspace: a pnpm workspace with one published package,
  `packages/qrcast` (strict TypeScript, ESM only, built with plain `tsc`,
  tested with Vitest in Node). No demo app, release tooling or CI yet.
- Add the v1 envelope that wraps every transfer:
  `["QRCAST"][ver 0x01][flags][metaLen LEB128][meta UTF-8 JSON][body]`.
  - Meta carries `s` (original body size, set by the library), and the
    optional hints `t` (type) and `n` (name). Unknown keys are ignored.
  - Encoded meta is capped at 4096 bytes.
  - Flags bit 0 marks a `deflate-raw` compressed body. Every other bit is
    reserved: senders write 0 and receivers reject a set reserved bit.
  - Compression is kept only when it makes the body smaller. Decompression is
    streamed and stops as soon as the output would exceed `s`.
  - Receivers reject an unknown magic, version, reserved flag bit or oversized
    meta with `unsupported-format`, and never guess.
- Add the codec descriptor that the core needs from every codec: its name,
  its `maxPayloadSize` (measured on the complete envelope), and whether the
  envelope body should be compressed for it.
- Add the size check: the sender builds the envelope and checks it against the
  codec's `maxPayloadSize` before any encoding work, and throws
  `payload-too-large` with the size, the limit and the codec name.
- Add the error model: every error the library raises is a `QrcastError` with
  a stable `code` and typed details. This change introduces
  `payload-too-large`, `unsupported-format`, `malformed-envelope` and
  `invalid-input`.

Out of scope: the cimbar and QR codecs themselves, the sender and receiver
loops, raw (non-qrcast) cimbar files, multi-segment transfers, an integrity
hash in meta, a name sanitizing helper, the demo app, release-please and CI.

## Capabilities

### New Capabilities

- `envelope`: the v1 wire format that wraps every transfer, including meta,
  flags, compression and how receivers parse and reject payloads.
- `codec-contract`: what a codec must report to the core (name, payload limit,
  compression policy) and the pre-encoding size check against that limit.
- `error-model`: the single error type, its stable codes and the details each
  code carries.

### Modified Capabilities

None. There are no existing specs.

## Impact

- New files: root `package.json`, `pnpm-workspace.yaml`, shared TypeScript
  config, and `packages/qrcast/` (sources, tests, package manifest).
- Public API: the package root exports `QrcastError`, the error code and
  details types, the codec descriptor type, and the meta and result types.
  The envelope functions stay internal for now, because callers never handle
  the envelope directly.
- Wire format: this change fixes the v1 envelope. Any later change to it is
  a breaking change.
- Dependencies: none at runtime (`CompressionStream` is built into browsers
  and Node). Development only: TypeScript and Vitest.
- `docs/design-notes.md`: the sections captured here are removed from it once
  the specs are archived.
