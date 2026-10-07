import { QrcastError } from '../../errors.js';
import type { ResolvedCimbarOptions } from './options.js';

// Literal references, so that bundlers copy these files into the app's build.
// The worker URL stays in a variable rather than inside `new Worker(...)`, so
// bundlers emit the classic script as is instead of bundling it as a module.
const WORKER_URL = new URL('./cimbar-worker.js', import.meta.url);
const GLUE_URL = new URL('./cimbar_js.2026-08-21T2336.js', import.meta.url);
const WASM_URL = new URL('./cimbar_js.2026-08-21T2336.wasm', import.meta.url);

/** How long a worker may take to load the glue and the wasm. */
const INIT_TIMEOUT_MS = 30_000;

export type WorkerRole = 'encode' | 'extract' | 'assemble';

/** Messages a worker posts after `ready`. */
export type WorkerReply =
  | { type: 'encoded' }
  | { type: 'frame'; bitmap: ImageBitmap }
  | { type: 'extracted'; bytes: Uint8Array; mode: number }
  | { type: 'progress'; progress: number | null }
  | { type: 'file'; name: string; bytes: Uint8Array };

/** An override URL, resolved against the page (the worker would resolve it against itself). */
function pageUrl(url: string): string {
  return new URL(url, globalThis.document?.baseURI ?? globalThis.location?.href).href;
}

function initFailed(message: string, cause?: unknown): QrcastError {
  return new QrcastError(
    'codec-init-failed',
    { codec: 'cimbar' },
    `cimbar could not start: ${message}`,
    cause === undefined ? undefined : { cause },
  );
}

/** One libcimbar instance in its own worker. */
export class CimbarWorker {
  /** Called for each message after `ready`. */
  onMessage: (reply: WorkerReply) => void = () => {};
  /** Called once when the instance aborts or throws after `ready`. */
  onAbort: (reason: unknown) => void = () => {};

  readonly #worker: Worker;
  #closed = false;

  private constructor(worker: Worker) {
    this.#worker = worker;
  }

  /**
   * Starts a worker in `role` and waits until libcimbar is loaded. Rejects
   * with `codec-init-failed`.
   */
  static start(options: ResolvedCimbarOptions, role: WorkerRole, mode: number): Promise<CimbarWorker> {
    let worker: Worker;
    try {
      worker = options.workerFactory ? options.workerFactory(WORKER_URL) : new Worker(WORKER_URL);
    } catch (error) {
      return Promise.reject(initFailed('the worker could not be created.', error));
    }
    const instance = new CimbarWorker(worker);
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        instance.terminate();
        reject(initFailed(`libcimbar did not load within ${INIT_TIMEOUT_MS / 1000} s.`));
      }, INIT_TIMEOUT_MS);
      const failBeforeReady = (message: string, cause?: unknown) => {
        clearTimeout(timer);
        instance.terminate();
        reject(initFailed(message, cause));
      };
      const abort = (reason: unknown) => {
        if (instance.#closed) return;
        instance.terminate();
        instance.onAbort(reason);
      };
      worker.onmessage = (event: MessageEvent) => {
        if (instance.#closed) return;
        const data = event.data as { type: string; reason?: string };
        if (!ready) {
          if (data.type === 'ready') {
            ready = true;
            clearTimeout(timer);
            resolve(instance);
          } else {
            failBeforeReady(data.reason ?? 'the worker failed.', data.reason);
          }
        } else if (data.type === 'aborted') {
          abort(data.reason);
        } else {
          instance.onMessage(data as WorkerReply);
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (ready) abort(event.message);
        else failBeforeReady(event.message || 'the worker script could not be loaded.', event.message);
      };
      worker.onmessageerror = () => {
        if (ready) abort('a message could not be read.');
        else failBeforeReady('a message could not be read.');
      };
      worker.postMessage({
        type: 'init',
        role,
        mode,
        glueUrl: options.glueUrl === null ? GLUE_URL.href : pageUrl(options.glueUrl),
        wasmUrl: options.wasmUrl === null ? WASM_URL.href : pageUrl(options.wasmUrl),
      });
    });
  }

  post(message: object, transfer: Transferable[] = []): void {
    if (!this.#closed) this.#worker.postMessage(message, transfer);
  }

  /** Ends the worker and its wasm instance. Later messages are dropped. */
  terminate(): void {
    this.#closed = true;
    this.#worker.terminate();
  }
}
