# Tasks

## 1. Workspace scaffold

- [x] 1.1 Create the root `package.json` (private, `packageManager` pnpm 10, scripts `build`, `test`, `typecheck` that run in every package) and `pnpm-workspace.yaml` with `packages/*`; verify `pnpm install` succeeds
- [x] 1.2 Create `tsconfig.base.json` with the strict options from design.md (NodeNext, ES2022, `verbatimModuleSyntax`, `lib` with DOM) and `packages/qrcast/{package.json,tsconfig.json,tsconfig.build.json}` (name `qrcast`, version `0.0.0`, `type: module`, `exports` for `.` with `types` and `default`, `files: ["dist"]`, `sideEffects: false`, `engines.node >=22`); add TypeScript 7 and Vitest as dev dependencies; verify `pnpm install` succeeds
- [x] 1.3 Add a placeholder `src/index.ts` and one trivial Vitest test; verify `pnpm build` emits `dist/index.js` and `dist/index.d.ts` (and no test files), and `pnpm test` and `pnpm typecheck` pass. If TypeScript 7 fails to emit declarations, switch to the latest 5.x and record why in design.md

## 2. Error model

- [x] 2.1 Implement `QrcastError`, the `ErrorDetails` map for `payload-too-large`, `unsupported-format`, `malformed-envelope` and `invalid-input`, and the union error type in `src/errors.ts`, with TSDoc on each code; verify unit tests for `instanceof Error`, `name`, `code`, `details` and `cause`
- [x] 2.2 Make `error.code === '...'` narrow `details` (through `instanceof QrcastError` if TypeScript allows it, otherwise an exported `isQrcastError` guard, recorded in design.md); verify with `expectTypeOf` type tests that run in `pnpm test`

## 3. Envelope building blocks

- [x] 3.1 Implement minimal unsigned LEB128 encode and decode (at most 8 bytes, reports truncated, non-minimal and too-long input) in `src/envelope/varint.ts`; verify tests for 0, 127, 128, 200 (`C8 01`), 4096, non-minimal `87 00`, truncated and over-long input
- [x] 3.2 Implement meta encoding (key order `s`, `t`, `n`, absent keys omitted, 4096-byte cap raising `invalid-input` / `meta-too-large` with `size` and `limit`) and meta validation (strict UTF-8, JSON object, `s` a non-negative safe integer, `t` and `n` strings, unknown keys dropped) in `src/envelope/meta.ts`; verify tests for each case in the envelope spec's meta requirements
- [x] 3.3 Implement raw DEFLATE compression and bounded streamed decompression (stop and cancel once output exceeds `s`, no preallocation from `s`, platform errors mapped to `malformed-envelope` / `compressed-body` with `cause`, no unhandled rejections) in `src/envelope/deflate.ts`; verify tests for a round trip, a corrupt stream, a truncated stream, and a zlib-made bomb (large zero buffer, small `s`) that fails with `body-size`

## 4. Envelope

- [x] 4.1 Implement `wrapEnvelope(body, { type, name, compress })` in `src/envelope/envelope.ts` (input validation, keep-only-when-smaller compression, flags, layout); verify golden hex fixtures for `01 02 03` without hints, with type and name, and for an empty body, plus the compressible, incompressible and compression-off scenarios
- [x] 4.2 Implement `unwrapEnvelope(bytes)` following the check order table in design.md and returning `{ kind: 'qrcast', meta, bytes }`; verify a test for every receive-side scenario in `specs/envelope/spec.md` (magic, short input, version, flags, check order, meta length cap, non-minimal length, each malformed case, unknown keys) asserting `code` and `details`
- [x] 4.3 Add a fixed compressed fixture (made once with Node's zlib and stored as hex) and round-trip tests over several sizes and hint combinations; verify the fixture decodes to its known body and every round trip returns identical bytes and meta

## 5. Codec contract

- [x] 5.1 Define `CodecDescriptor` and implement `prepareTransfer(body, hints, codec)` in `src/codec.ts` (descriptor validation with `invalid-input` / `codec`, compression from `codec.compress`, size check after compression raising `payload-too-large` with `size`, `limit`, `codec`); verify a test for every scenario in `specs/codec-contract/spec.md`, using a test codec that records whether it was called
- [x] 5.2 Export the public types and `QrcastError` (and `isQrcastError` if added) from `src/index.ts`, without exporting the envelope functions or `prepareTransfer`; verify with a test that imports the built `dist/index.js` and checks the exact set of runtime exports

## 6. Integration and notes

- [x] 6.1 Run `pnpm build`, `pnpm typecheck` and `pnpm test` from a clean checkout (`rm -rf node_modules packages/*/dist`, then `pnpm install`); verify all pass and `dist/` contains only the compiled `src` files and their declarations
- [x] 6.2 Remove from `docs/design-notes.md` what this change's specs and design now hold (section 3, the envelope rules of section 4, the size check of section 7, section 9's codes defined here, and the answered questions in section 14), keeping codec-specific and later-change content; verify no decided fact is lost by comparing the removed text against the specs and design.md
