import { QrcastError } from '../../errors.js';
import type { SenderDriver, SenderHooks } from '../../internal/codec.js';
import type { ResolvedCimbarOptions } from './options.js';
import { CimbarWorker, type WorkerReply } from './runtime.js';

/** Plays one transfer with a fresh encoder instance in its own worker. */
export function createCimbarSender(options: ResolvedCimbarOptions, hooks: SenderHooks): SenderDriver {
  let worker: CimbarWorker | null = null;
  let disposed = false;
  /** Aborted on dispose, so a worker still waiting to start is never created. */
  const loading = new AbortController();
  let size = 0;
  let encoded: (() => void) | null = null;
  const frameRequests: ((bitmap: ImageBitmap) => void)[] = [];

  const onMessage = (reply: WorkerReply) => {
    if (reply.type === 'encoded') {
      encoded?.();
      encoded = null;
    } else if (reply.type === 'frame') {
      const request = frameRequests.shift();
      if (request) request(reply.bitmap);
      else reply.bitmap.close();
    }
  };

  const onAbort = (reason: unknown) => {
    if (disposed) return;
    hooks.onFailure(
      new QrcastError(
        'codec-aborted',
        { codec: 'cimbar', role: 'sender', size },
        `The cimbar encoder aborted: ${String(reason)}`,
        { cause: reason },
      ),
    );
  };

  return {
    fps: options.fps,

    async start(envelope) {
      size = envelope.length;
      let started: CimbarWorker;
      try {
        started = await CimbarWorker.start(options, 'encode', options.sendMode, loading.signal);
      } catch (error) {
        if (disposed) return;
        throw error;
      }
      if (disposed) {
        started.terminate();
        return;
      }
      worker = started;
      worker.onMessage = onMessage;
      worker.onAbort = onAbort;
      await new Promise<void>((resolve) => {
        encoded = resolve;
        started.post({ type: 'encode', bytes: envelope });
      });
    },

    nextFrame() {
      return new Promise((resolve) => {
        frameRequests.push(resolve);
        worker?.post({ type: 'frame' });
      });
    },

    dispose() {
      disposed = true;
      loading.abort();
      worker?.terminate();
      frameRequests.length = 0;
    },
  };
}
