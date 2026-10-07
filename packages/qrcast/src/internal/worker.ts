import { QrcastError } from '../errors.js';

/** How long a worker may take to load its scripts and wasm. */
const INIT_TIMEOUT_MS = 30_000;

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

  /** Starts the worker and waits until it is ready. Rejects with `codec-init-failed`. */
  static start<Reply>(options: WorkerStart): Promise<CodecWorker<Reply>> {
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
        instance.terminate();
        reject(initFailed(`${options.engine} did not load within ${INIT_TIMEOUT_MS / 1000} s.`));
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
