import { QrcastError } from '../../errors.js';
import type { ReceiverDriver, ReceiverHooks } from '../../internal/codec.js';
import { Assembler } from './assembler.js';
import type { ResolvedQrOptions } from './options.js';
import { QrWorker, type WorkerReply } from './runtime.js';

/** Bitmaps the decode worker may hold at once; more captures are skipped. */
const MAX_IN_FLIGHT = 2;

/**
 * Decodes one transfer: one worker reads the QR codes of each capture, and
 * the assembler on the main thread rebuilds the file from their texts.
 */
export function createQrReceiver(options: ResolvedQrOptions, hooks: ReceiverHooks): ReceiverDriver {
  let worker: QrWorker | null = null;
  let inFlight = 0;
  let progress: number | null = null;
  let finished = false;
  let disposed = false;

  const stop = () => {
    finished = true;
    worker?.terminate();
  };

  const assembler = new Assembler({
    onData: () => hooks.onData(),
    onProgress(value) {
      progress = value;
      hooks.onProgress(value);
    },
    onFile(bytes) {
      stop();
      hooks.onFile(bytes, '');
    },
  });

  const onAbort = (reason: unknown) => {
    if (finished || disposed) return;
    stop();
    hooks.onFailure(
      new QrcastError(
        'codec-aborted',
        { codec: 'qr', role: 'receiver', progress },
        `The QR decoder aborted: ${String(reason)}`,
        { cause: reason },
      ),
    );
  };

  const onMessage = (reply: WorkerReply) => {
    if (reply.type !== 'decoded') return;
    inFlight--;
    if (finished) return;
    for (const text of reply.texts) assembler.push(text);
  };

  return {
    async load() {
      const started = await QrWorker.start(options);
      if (disposed) {
        started.terminate();
        return;
      }
      worker = started;
      worker.onMessage = onMessage;
      worker.onAbort = onAbort;
    },

    canAccept() {
      return !finished && !disposed && worker !== null && inFlight < MAX_IN_FLIGHT;
    },

    push(frame) {
      if (!worker || finished || disposed || inFlight >= MAX_IN_FLIGHT) {
        frame.close();
        return;
      }
      const target = worker;
      // Counted until the worker replies, or until the capture is dropped here.
      inFlight++;
      // The central square, cropped before any copy so the transfer stays small.
      const side = Math.min(frame.displayWidth, frame.displayHeight);
      const sx = Math.floor((frame.displayWidth - side) / 2);
      const sy = Math.floor((frame.displayHeight - side) / 2);
      createImageBitmap(frame, sx, sy, side, side)
        .then(
          (bitmap) => {
            if (finished || disposed) {
              inFlight--;
              bitmap.close();
              return;
            }
            target.post({ type: 'decode', bitmap }, [bitmap]);
          },
          () => {
            inFlight--;
          },
        )
        .finally(() => frame.close());
    },

    dispose() {
      disposed = true;
      stop();
    },
  };
}
