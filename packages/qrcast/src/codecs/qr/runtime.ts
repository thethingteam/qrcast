import { CodecWorker, pageUrl } from '../../internal/worker.js';
import type { ResolvedQrOptions } from './options.js';

// Literal references, so that bundlers copy these files into the app's build.
// The worker URL stays in a variable rather than inside `new Worker(...)`, so
// bundlers emit the classic script as is instead of bundling it as a module.
const WORKER_URL = new URL('./qr-worker.js', import.meta.url);
const GLUE_URL = new URL('./zxing_reader.js', import.meta.url);
const WASM_URL = new URL('./zxing_reader.wasm', import.meta.url);

/** Messages the worker posts after `ready`. */
export type WorkerReply = { type: 'decoded'; texts: string[] };

/** One zxing-wasm instance in its own worker. */
export type QrWorker = CodecWorker<WorkerReply>;

export const QrWorker = {
  /** Starts a decode worker and waits until zxing is loaded. Rejects with `codec-init-failed`. */
  start(options: ResolvedQrOptions): Promise<QrWorker> {
    return CodecWorker.start<WorkerReply>({
      codec: 'qr',
      engine: 'zxing-wasm',
      workerUrl: WORKER_URL,
      workerFactory: options.workerFactory,
      init: {
        type: 'init',
        glueUrl: options.glueUrl === null ? GLUE_URL.href : pageUrl(options.glueUrl),
        wasmUrl: options.wasmUrl === null ? WASM_URL.href : pageUrl(options.wasmUrl),
      },
    });
  },
};
