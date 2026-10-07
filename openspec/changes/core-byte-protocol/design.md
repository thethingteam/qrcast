# Design

## Context

The repository has no code yet: only `docs/design-notes.md`, the OpenSpec
setup and `CLAUDE.md`. The envelope layout, the compression rules, the
one-segment size check and the first error codes are already decided in the
design notes (sections 3, 4, 7 and 9); this change turns them into code and
specs. Four open questions from the notes were settled for this change:

- Reserved flag bits are rejected with `unsupported-format`.
- Encoded meta is capped at 4096 bytes.
- No integrity hash in meta for now. Unknown meta keys are already ignored,
  so a hash key can be added later without a new envelope version.
- The minimal workspace is set up here rather than in a separate change.

Constraints that shape the approach: the library never makes network
requests; the core must run in Node and in browsers; the package is ESM only
and built with plain `tsc`; wire format changes are breaking.

## Goals / Non-Goals

**Goals:**

- A package skeleton that the codec changes can add to without restructuring.
- A byte-exact, fully specified v1 envelope with golden test vectors, so that
  an accidental wire change fails a test.
- Safe parsing of untrusted input: no allocation driven by attacker-chosen
  sizes, and no unbounded decompression.

**Non-Goals:**

- The full codec interface. This change defines only the part the core needs
  (name, limit, compression policy). The sender and receiver hooks are
  designed in `cimbar-codec`, when there is a real codec to shape them.
- A final export map. Only the package root exists; subpath entries come with
  the sender, receiver and codecs.
- Browser test runs. The core only uses APIs that Node also has, so Node tests
  cover it; browser mode arrives with the sender and receiver.

## Decisions

### Envelope fields (from the design notes)

- The `QRCAST` magic identifies a qrcast payload. This matters for cimbar,
  which hands over an opaque file. It is readable in a hex dump, matches the
  QR frame prefix, and costs 6 bytes once per transfer.
- The version byte is what allows multi-segment transfers later without
  breaking v1 receivers: a segment container gets a new version, while
  single-segment transfers keep sending `0x01` byte for byte.
- `meta.t` is only a hint and `meta.n` is untrusted; both stay optional so
  that a transfer of plain bytes costs only `{"s":N}`.

### Workspace layout

```
 package.json            private root: scripts that run in every package
 pnpm-workspace.yaml     packages/*  (apps/* is added with the demo)
 tsconfig.base.json      strict options shared by all packages
 packages/qrcast/
   package.json          name "qrcast", type module, exports ".", sideEffects false
   tsconfig.json         editor and type-check config (src + test)
   tsconfig.build.json   emits src only to dist/, with declarations
   src/
     index.ts            public exports (types and QrcastError only)
     errors.ts           QrcastError, codes, details types
     codec.ts            CodecDescriptor, prepareTransfer()
     envelope/
       envelope.ts       wrapEnvelope(), unwrapEnvelope()
       meta.ts           encode and validate meta JSON
       varint.ts         minimal unsigned LEB128
       deflate.ts        compress, bounded decompress
   test/                 Vitest, Node environment
```

- TypeScript 7 (current stable 7.0.x), `module` and `moduleResolution`
  `NodeNext`, `target` ES2022, `verbatimModuleSyntax`, relative imports with
  `.js` extensions so that `tsc` output runs unbundled. `lib` includes `DOM`
  for the stream and encoding types; the core still uses only APIs that Node
  also provides (`CompressionStream`, `DecompressionStream`, `TextEncoder`,
  `TextDecoder`).
- `engines.node` is `>=22`. Version `0.0.0`; release-please takes over in the
  `publish` change.
- Alternative considered: a single package at the repository root. Rejected
  because the demo app is already planned as a second workspace member, and
  moving the package later would churn every path.

### Envelope stays internal

The package root exports `QrcastError`, the error and details types,
`CodecDescriptor`, `PayloadMeta` and `ReceivedPayload`. `wrapEnvelope`,
`unwrapEnvelope` and `prepareTransfer` are imported by later modules through
relative paths but are not exported from the package.

- Why: callers never handle the envelope (design notes, section 3), and every
  export is API surface that must stay stable. Exporting them later is a
  non-breaking addition; un-exporting is breaking.
- Alternative considered: export them for Node users who want to decode an
  envelope captured some other way. No such user exists yet.

### Public shapes

```ts
interface PayloadMeta { size: number; type?: string; name?: string }
interface ReceivedPayload { kind: 'qrcast'; meta: PayloadMeta; bytes: Uint8Array }
interface CodecDescriptor {
  readonly name: string;
  readonly maxPayloadSize: number; // bytes of the complete envelope
  readonly compress: boolean;      // compress the envelope body for this codec
}
```

- The API uses readable names (`size`, `type`, `name`); the wire uses the
  one-letter keys `s`, `t`, `n` to save bytes on every transfer.
- `kind` is there from the start so that `{ kind: 'raw', ... }` (plain cimbar
  files, design notes section 8) can be added later without a breaking change.
- `CodecDescriptor` is a structural interface, so the codec changes can extend
  it into the full codec type.

### Async wrap and unwrap

`wrapEnvelope(body, { type, name, compress })` and `unwrapEnvelope(bytes)`
return promises, also when nothing is compressed. `CompressionStream` is
stream based and has no synchronous form, and one signature is simpler than a
sync path plus an async path. `prepareTransfer(body, hints, codec)` validates
the codec, calls `wrapEnvelope` with `compress: codec.compress`, then runs the
size check.

### Parsing order and error mapping

`unwrapEnvelope` reads the fields in order and stops at the first failure,
which keeps the reported error predictable (spec: Check order):

| Step | Failure | Error |
|---|---|---|
| magic (6 B) | short or different | `unsupported-format` / `magic` |
| version | not `0x01`, or missing | `unsupported-format` / `version`, or `malformed-envelope` / `truncated` |
| flags | reserved bit set, or missing | `unsupported-format` / `flags`, or `malformed-envelope` / `truncated` |
| meta length | truncated / non-minimal / > 4096 | `malformed-envelope` / `truncated` or `meta-length`, or `unsupported-format` / `meta-length` |
| meta | short, bad UTF-8, bad JSON, bad fields | `malformed-envelope` / `truncated` or `meta` |
| body | corrupt deflate, size differs from `s` | `malformed-envelope` / `compressed-body` or `body-size` |

- The varint reader accepts at most 8 bytes (56 bits, exact in a JS number,
  computed with multiplication rather than 32-bit bit operators). A longer
  varint is `malformed-envelope` / `meta-length`.
- Meta is decoded with `TextDecoder('utf-8', { fatal: true })` and `JSON.parse`;
  `s` must pass `Number.isSafeInteger` and be `>= 0`.

### Bounded decompression

The compressed body is written into a `DecompressionStream('deflate-raw')` and
the output is read chunk by chunk. The reader keeps a running total and
cancels the stream as soon as the total exceeds `s`. Output chunks are
collected in a list and copied into one `Uint8Array` at the end.

- The buffer is not preallocated from `s`: `s` comes from untrusted input, so
  preallocating would turn a forged meta into a large allocation.
- Writer and reader errors after a cancel are caught, so that a rejected
  stream never surfaces as an unhandled rejection.
- Any decompressor error (corrupt data, a stream that ends early) maps to
  `malformed-envelope` / `compressed-body`, with the platform error as
  `cause`.
- Bytes after the end of the DEFLATE stream are platform dependent: browsers
  follow the Compression Streams standard and throw (mapped to
  `compressed-body`), while Node ignores them. Detecting them everywhere would
  need a hand-written inflater, which is not worth it: the trailing bytes never
  reach the output, and the output must still match `s` exactly.

### Compression on send

`CompressionStream('deflate-raw')` with its default level, and the result is
kept only when strictly smaller than the body. Data that is already
compressed (PMTiles, GeoParquet, ZIP) is therefore sent as is without any
special case. No dependency such as fflate: `CompressionStream` exists in all
current browsers and in Node.

### Error type

`QrcastError` extends `Error`, sets `name = 'QrcastError'`, and carries `code`
and `details`; `cause` uses the standard `Error` options. A map type
`ErrorDetails` ties each code to its details shape, and the exported error
type is the union over all codes, so that `error.code === '...'` narrows
`details`. If `instanceof QrcastError` cannot be made to narrow to that union
in TypeScript, an `isQrcastError(value)` type guard is exported as the
supported way to get it. Type-level tests (`expectTypeOf`) check the
narrowing.

Outcome: `instanceof` narrows as intended. The class value is typed through a
constructor interface whose `prototype` is the union, so no type guard is
exported. The package `test` script runs `tsc --noEmit` before Vitest, so
the `expectTypeOf` assertions are enforced by `pnpm test`.

### Testing

- Golden vectors: hex fixtures for uncompressed envelopes (with and without
  type and name, empty body) are compared byte for byte with the output of
  `wrapEnvelope`.
- Compressed output is not compared byte for byte, because DEFLATE output may
  differ between implementations. Instead, a fixed compressed fixture produced
  once with Node's zlib is decoded, and round trips check the flag and size.
- The decompression bomb fixture is made in the test with
  `zlib.deflateRawSync` of a large zero buffer and paired with a small `s`.
- Every error scenario in the specs gets a test that checks `code` and
  `details`.

## Risks / Trade-offs

- [DEFLATE output differs between browsers and Node] → Only decoding is
  pinned by fixtures; the wire format fixes the algorithm (raw DEFLATE), not
  the exact compressed bytes.
- [TypeScript 7 declaration emit or editor tooling has gaps] → The first task
  builds the empty package and checks the emitted `.d.ts`; if it fails, fall
  back to the latest TypeScript 5.x for this change and note it.
- [The codec descriptor turns out too small or wrongly named once a real
  codec exists] → It is a minimal structural interface and pre-1.0 releases
  bump the minor version for breaking changes, so `cimbar-codec` can reshape
  it.
- [The 4096-byte meta cap is too low for a future meta key] → It applies only
  to v1 envelopes; raising it is a receiver change that should travel with a
  new envelope version.
- [Async API for small uncompressed payloads costs a microtask] → Negligible
  next to camera frame timing.

## Migration Plan

None. This is the first code in the repository.

## Open Questions

- The package license (and the `license` field in `package.json`). It does
  not affect this change's code; it must be settled before the `publish`
  change.
