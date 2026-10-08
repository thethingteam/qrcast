# Design

## Context

See proposal.md for the problem. Today every codec worker goes through
`CodecWorker.start` in `packages/qrcast/src/internal/worker.ts`, which creates
the worker at once (with `new Worker(url)` or the app's `workerFactory`),
posts `init`, and resolves on `ready` or rejects with `codec-init-failed` on a
failure message, an `error` event, a `messageerror` event or a 30 s timeout.

Nothing orders these calls:

- The receiver (`receiver/index.ts`, `#load`) loads all codecs with
  `Promise.allSettled`, so the cimbar and QR drivers load in parallel.
- The cimbar receiver driver starts up to three extract workers and one
  assemble worker with `Promise.allSettled`.
- The QR receiver driver and the cimbar sender driver start one worker each.

The issue's measurements show that in WebKit the trigger is creating workers
at the same time. Creating them one after another works, even when all stay
alive, and delaying only `init` does not help.

## Goals / Non-Goals

**Goals:**

- At most one qrcast worker is starting on a page at any moment, whichever
  codec, sender or receiver asks for it.
- Stopping a sender or receiver while workers wait for their turn creates no
  more workers.
- A regression check that reproduces the WebKit failure.

**Non-Goals:**

- Falling back to fewer cimbar workers when a 128 MB instance cannot be
  allocated (design notes, section 14). It stays open.
- Changing the number of cimbar extract workers, or an option for it.
- Running the WebKit check in CI: the runner image lacks WebKit's system
  libraries and the owner chose not to add an apt step or a container job
  (see #8). It runs on a developer machine.

## Decisions

### One start queue for the whole page, in `CodecWorker.start`

`internal/worker.ts` keeps a module-level promise chain. Each call to
`CodecWorker.start` waits for the previous start to settle, then creates its
worker; the turn passes on when the new worker answers its first message,
fails (failure message, `error`, `messageerror`), times out, or when creating
it throws. Later messages do not affect the queue.

Every worker in qrcast already goes through this function, so one change
covers both codecs, senders and receivers, and the drivers keep their
structure. The dist build has one `internal/worker.js` module shared by the
cimbar and QR chunks, so there is one queue per copy of qrcast.

Alternatives considered:

- Serialize in each driver and load codecs one after another in the
  receiver. It needs changes in three places and still lets a sender and a
  receiver on the same page start workers together.
- Delay only the `init` message, or load the glue from a blob URL. The issue
  shows both still fail: the late workers are not controlled at all.
- The issue's stand-in `Worker` that creates the real worker later. It works
  as an app-side workaround but relies on qrcast's internal use of the
  worker; inside qrcast, waiting before creating is simpler.

### The 30 s timeout starts when the worker is created

A worker waiting for its turn has not started loading, so its timer starts at
creation. A receiver's total load time can therefore exceed 30 s only if
several workers each take a long time, which already means something is
wrong; each one still fails on its own timer.

### Cancelling a start that waits

`CodecWorker.start` takes an optional `AbortSignal`. When it is aborted
before the worker is created, the start gives up its place without creating
a worker and rejects with the signal's reason. When it is aborted after
creation but before `ready`, the worker is terminated, the turn passes on,
and the start rejects. Each driver owns an `AbortController`, aborts it in
`dispose()`, and its `load()` (or the sender's `start()`) returns quietly
when it was disposed, as it does today. Without this, a stopped receiver
would still create every queued worker one after another and hold the queue
for a later preload.

### The cimbar receiver starts its workers in a loop

`load()` awaits each `CimbarWorker.start` in turn (the extract workers, then
the assembler) instead of `Promise.allSettled`. A failure ends the loop, the
workers already started are terminated and the failure is rethrown, so no
further worker is created. The global queue alone would order the starts,
but the loop is what stops after a failure. Total start time is the same
either way, since the queue already runs them one by one.

### `workerFactory` members are part of the contract

qrcast sets `onmessage`, `onerror` and `onmessageerror`, and calls
`postMessage` and `terminate`, on the object the factory returns. The spec
and README now name these five, so an app may return a wrapper. A new member
would need a spec change; this is the price of making wrappers supported.

### Tests

- Unit tests (Node, Vitest) for `CodecWorker.start` with fake workers passed
  through `workerFactory`: the second worker is created only after the first
  answers `ready`; a failure message, an `error` event, a timeout (fake
  timers) and a throwing factory each pass the turn on; an abort while
  waiting creates no worker; an abort while starting terminates it; the
  timer starts at creation.
- A browser test (Chromium) preloads a receiver with `[cimbar(), qr()]`
  whose factories wrap real workers and record, at each creation, whether
  every earlier worker has already answered. A second one runs a loopback
  transfer through a factory that returns a wrapper with only the five
  members.
- An offline smoke check, `smoke/shared/check-offline.mjs`, for the Vite
  smoke app: it writes a test service worker into the build output that
  caches every output file on install and serves from the cache, opens the
  page, registers the service worker and waits until it is active, stops
  the server (closing open connections), reloads, and waits for the page's
  preload result. `smoke/run.mjs` runs it in Chromium by default and also in
  WebKit with `--webkit`; a root script `pnpm smoke:webkit` runs the Vite
  project with that flag. The service worker belongs to the test app, not
  to the package, so the "no service worker" rule still holds.

The WebKit check is first run against the current code to confirm it fails
with `codec-init-failed`, then against the fix.

## Risks / Trade-offs

- [Slower start: a `[cimbar(), qr()]` receiver loads five wasm instances in
  sequence] → `preload()` already lets apps pay this before the user starts;
  the browser test logs the load time so the cost is visible in the PR.
- [A worker that never answers holds the queue] → it times out after 30 s
  and passes the turn on, as it fails today.
- [Two copies of qrcast on a page have two queues and can start workers
  together] → unlikely; the README does not promise otherwise.
- [The WebKit check is not in CI, so a regression can merge unnoticed] →
  the Chromium offline check still runs in CI and covers the service worker
  setup; the README and tasks say to run `pnpm smoke:webkit` before a
  release that touches worker start-up.
- [Chromium passes even without the fix, so the CI check does not catch this
  bug] → accepted; it catches offline regressions of other kinds (a missing
  file, a request outside the cache).

## Migration Plan

None. No API change; released as a `fix:` (patch) through release-please.
Apps using the issue's workaround keep working, since the workaround only
delays creation further.
