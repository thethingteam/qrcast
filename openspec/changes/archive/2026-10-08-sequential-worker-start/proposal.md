# Proposal

## Why

In WebKit (Safari, and every browser on iOS), a receiver cannot start offline
in an app whose service worker caches qrcast's files (issue #7). The receiver
creates all its workers at once (with `[cimbar(), qr()]`, four cimbar workers
and one QR worker), and when WebKit creates several dedicated workers at the
same time, only the first one is controlled by the page's service worker. The
others load their scripts from the network, so offline they fail and the
receiver rejects with `codec-init-failed`. Online everything works, so the bug
only shows up in the field, where offline use is the point of the library.

## What Changes

- qrcast starts its codec workers one at a time: a worker is created only
  after the previous one has answered its `init` (ready or a failure), timed
  out, or could not be created. This holds across codecs and across senders
  and receivers on the same page, not only inside one codec.
- The cimbar receiver stops creating further workers as soon as one fails or
  the receiver is stopped while loading, instead of creating all of them
  first.
- The README says that apps running offline must cache the worker, glue and
  wasm files (not only the wasm), and lists the `Worker` members qrcast uses,
  so a `workerFactory` may return a wrapper.
- A new offline check in the consumer smoke tests caches the built app with a
  service worker, stops the server and preloads both codecs. It runs in
  Chromium in CI and, on request, in WebKit on a developer machine (the CI
  runner lacks WebKit's system libraries).
- No API change. Start-up gets slower by the sum of the workers' start times
  instead of the slowest one, paid once per load.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codec-contract`: a new requirement that codec workers start one at a time,
  and "Asset location overrides" names the `Worker` members a
  `workerFactory` result must provide.
- `package-distribution`: "Offline and network-free" says the README tells
  consumers to cache the worker and glue scripts too, and a new scenario
  requires the offline smoke check.

## Impact

- Code: `packages/qrcast/src/internal/worker.ts` (a start queue shared by all
  codecs), `packages/qrcast/src/codecs/cimbar/receiver-driver.ts` (load the
  workers in sequence and stop early).
- Tests: unit tests for the queue with fake workers; a browser test that
  checks a `[cimbar(), qr()]` receiver never has two workers starting at
  once; the offline smoke check (`smoke/`), with a WebKit variant run
  locally.
- Docs: README offline section and `workerFactory` notes; the open question
  on starting cimbar workers one by one in `docs/design-notes.md` (section
  14) is partly answered.
- Performance: a receiver with four cimbar workers and one QR worker loads
  its wasm five times in sequence instead of in parallel.
