import { CodecWorker, pageUrl } from '../../internal/worker.js';
import type { ResolvedCimbarOptions } from './options.js';

// Literal references, so that bundlers copy these files into the app's build.
// The worker URL stays in a variable rather than inside `new Worker(...)`, so
// bundlers emit the classic script as is instead of bundling it as a module.
const WORKER_URL = new URL('./cimbar-worker.js', import.meta.url);
const GLUE_URL = new URL('./cimbar_js.2026-08-21T2336.js', import.meta.url);
const WASM_URL = new URL('./cimbar_js.2026-08-21T2336.wasm', import.meta.url);

export type WorkerRole = 'encode' | 'extract' | 'assemble';

/** Messages a worker posts after `ready`. */
export type WorkerReply =
  | { type: 'encoded' }
  | { type: 'frame'; bitmap: ImageBitmap }
  | { type: 'extracted'; bytes: Uint8Array; mode: number }
  | { type: 'progress'; progress: number | null }
  | { type: 'file'; name: string; bytes: Uint8Array };

/** One libcimbar instance in its own worker. */
export type CimbarWorker = CodecWorker<WorkerReply>;

export const CimbarWorker = {
  /**
   * Starts a worker in `role` and waits until libcimbar is loaded. Rejects
   * with `codec-init-failed`.
   */
  start(options: ResolvedCimbarOptions, role: WorkerRole, mode: number): Promise<CimbarWorker> {
    return CodecWorker.start<WorkerReply>({
      codec: 'cimbar',
      engine: 'libcimbar',
      workerUrl: WORKER_URL,
      workerFactory: options.workerFactory,
      init: {
        type: 'init',
        role,
        mode,
        glueUrl: options.glueUrl === null ? GLUE_URL.href : pageUrl(options.glueUrl),
        wasmUrl: options.wasmUrl === null ? WASM_URL.href : pageUrl(options.wasmUrl),
      },
    });
  },
};
