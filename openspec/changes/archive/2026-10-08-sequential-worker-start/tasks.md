# Tasks

## 1. Reproduce offline in WebKit

- [x] 1.1 Add `smoke/shared/check-offline.mjs`: write a test service worker into the build output that caches every output file on install, claims clients and answers from the cache; open the page, register it and wait until it is active; stop the server (closing open connections) and reload; then wait for `window.__smoke`. Extend `smoke/shared/serve.mjs` to close open connections; verify by reading the code that the package itself still registers no service worker
- [x] 1.2 In `smoke/run.mjs`, run the offline check for the `vite` project in Chromium, and also in WebKit when `--webkit` is passed; add a root script `smoke:webkit` (`node smoke/run.mjs vite --webkit`); verify `pnpm smoke` passes in Chromium with the current code
- [x] 1.3 Run `pnpm build && pnpm smoke:webkit` against the current code; verify the WebKit offline check fails with `codec-init-failed` (the bug from issue #7), and record the output for the PR

## 2. Start workers one at a time

- [x] 2.1 Add unit tests for `CodecWorker.start` with fake workers through `workerFactory` (in `packages/qrcast/test/internal.test.ts` or a new `worker.test.ts`): the second worker is created only after the first answers `ready`; a failure message, an `error` event, a timeout (fake timers) and a throwing factory each let the next worker be created; the timeout counts from creation, not from the call; verify they fail before 2.2
- [x] 2.2 In `packages/qrcast/src/internal/worker.ts`, add a module-level start queue so each start waits for the previous one to settle, and start the timeout at creation; verify the tests of 2.1 pass
- [x] 2.3 Add an optional `AbortSignal` to `CodecWorker.start`: aborted while waiting creates no worker and gives up its place; aborted while starting terminates the worker and passes the turn on; both reject. Add unit tests for both; verify they pass
- [x] 2.4 Give the cimbar receiver, QR receiver and cimbar sender drivers an `AbortController` aborted in `dispose()`, pass its signal to every start, and return quietly from `load()`/`start()` when disposed; verify the existing unit and browser tests still pass
- [x] 2.5 In `packages/qrcast/src/codecs/cimbar/receiver-driver.ts`, start the extract workers and then the assembler in a loop instead of `Promise.allSettled`, terminating the started ones and rethrowing on the first failure; add a unit or browser test where the first cimbar worker fails and no other is created; verify it passes
- [x] 2.6 Add a browser test in `packages/qrcast/test/browser/receiver.test.ts`: a receiver with `[cimbar(), qr()]` whose factories wrap real workers and record, at each creation, whether every earlier worker has answered its first message; verify that holds for all five workers and log the preload time
- [x] 2.7 Add a browser test where a receiver with `[cimbar(), qr()]` is stopped while its workers are starting; verify no worker is created after `stop()` and the created ones are terminated
- [x] 2.8 Add a browser test that runs a cimbar loopback transfer through a `workerFactory` returning a wrapper that forwards only `onmessage`, `onerror`, `onmessageerror`, `postMessage` and `terminate`; verify the transfer completes byte for byte
- [x] 2.9 Run `pnpm build && pnpm smoke:webkit`; verify the WebKit offline check now passes, and `pnpm smoke` still passes

## 3. Docs

- [x] 3.1 In `README.md` (the build copies it to `packages/qrcast/README.md`), extend the offline section: apps must cache the worker scripts, glue scripts and wasm files, and qrcast starts its workers one at a time because WebKit lets only the first of several workers created together use the page's service worker; under the `workerFactory` notes, list the five `Worker` members qrcast uses; verify `pnpm build` leaves both READMEs identical
- [x] 3.2 In `docs/design-notes.md` section 14, note that workers now start one by one and that falling back to fewer cimbar workers is still open; verify the Decided items are unchanged

## 4. Checks

- [x] 4.1 Run `pnpm typecheck`, `pnpm test`, `pnpm test:browser` and `pnpm smoke` at the repo root, and `openspec validate sequential-worker-start --strict`; verify all pass
