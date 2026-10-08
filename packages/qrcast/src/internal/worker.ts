import { QrcastError } from '../errors.js';

/** How long a worker may take to load its scripts and wasm, counted from its creation. */
const INIT_TIMEOUT_MS = 30_000;

/**
 * Settles when the last queued start has created its worker and that worker
 * is ready or has failed. When WebKit creates several dedicated workers at
 * the same time, only the first is controlled by the page's service worker,
 * so the others fail offline; qrcast therefore starts its workers one at a
 * time, across all codecs, senders and receivers.
 */
let queue: Promise<void> = Promise.resolve();

export interface WorkerStart {
  /** The codec name, for errors. */
  codec: string;
  /** What the codec calls its engine in error text, such as `libcimbar`. */
  engine: string;
  /** The packaged worker script. */
  workerUrl: URL;
  /** Replaces `new Worker(workerUrl)` when the app provides one. */
  workerFactory: ((url: URL) => Worker) | null;
  /** The first message, which tells the worker to load its engine. */
  init: object;
}

/** An override URL, resolved against the page (a worker would resolve it against itself). */
export function pageUrl(url: string): string {
  return new URL(url, globalThis.document?.baseURI ?? globalThis.location?.href).href;
}

/**
 * One codec engine in its own classic worker. The worker protocol: it gets
 * `init` and answers `ready` or a failure message with a `reason`; later it
 * posts codec replies, or `aborted` with a `reason`.
 */
export class CodecWorker<Reply> {
  /** Called for each message after `ready`. */
  onMessage: (reply: Reply) => void = () => {};
  /** Called once when the worker aborts or throws after `ready`. */
  onAbort: (reason: unknown) => void = () => {};

  readonly #worker: Worker;
  #closed = false;

  private constructor(worker: Worker) {
    this.#worker = worker;
  }

  /**
   * Starts the worker after every earlier start has settled, and waits until
   * it is ready. Rejects with `codec-init-failed`, or with the signal's reason
   * when `signal` aborts first; an aborted start creates no worker, or ends
   * the one it created.
   */
  static start<Reply>(options: WorkerStart, signal?: AbortSignal): Promise<CodecWorker<Reply>> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => reject(signal!.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      queue = queue.then(() => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return;
        return CodecWorker.#create<Reply>(options, signal).then(resolve, reject);
      });
    });
  }

  /** Creates the worker, sends `init` and waits for `ready`. */
  static #create<Reply>(options: WorkerStart, signal: AbortSignal | undefined): Promise<CodecWorker<Reply>> {
    const initFailed = (message: string, cause?: unknown) =>
      new QrcastError(
        'codec-init-failed',
        { codec: options.codec },
        `${options.codec} could not start: ${message}`,
        cause === undefined ? undefined : { cause },
      );

    let worker: Worker;
    try {
      worker = options.workerFactory ? options.workerFactory(options.workerUrl) : new Worker(options.workerUrl);
    } catch (error) {
      return Promise.reject(initFailed('the worker could not be created.', error));
    }
    const instance = new CodecWorker<Reply>(worker);
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        failBeforeReady(`${options.engine} did not load within ${INIT_TIMEOUT_MS / 1000} s.`);
      }, INIT_TIMEOUT_MS);
      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const failBeforeReady = (message: string, cause?: unknown) => {
        settle();
        instance.terminate();
        reject(initFailed(message, cause));
      };
      const onAbort = () => {
        settle();
        instance.terminate();
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
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
            settle();
            resolve(instance);
          } else {
            failBeforeReady(data.reason ?? 'the worker failed.', data.reason);
          }
        } else if (data.type === 'aborted') {
          abort(data.reason);
        } else {
          instance.onMessage(data as Reply);
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
      worker.postMessage(options.init);
    });
  }

  post(message: object, transfer: Transferable[] = []): void {
    if (!this.#closed) this.#worker.postMessage(message, transfer);
  }

  /** Ends the worker and its engine. Later messages are dropped. */
  terminate(): void {
    this.#closed = true;
    this.#worker.terminate();
  }
}
