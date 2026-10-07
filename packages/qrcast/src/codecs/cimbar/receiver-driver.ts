import { QrcastError } from '../../errors.js';
import type { ReceiverDriver, ReceiverHooks } from '../../internal/codec.js';
import { AUTO_MODES } from './options.js';
import type { ResolvedCimbarOptions } from './options.js';
import { CimbarWorker, type WorkerReply } from './runtime.js';

/** Frames one extract worker may hold at once; more are skipped. */
const MAX_IN_FLIGHT = 2;
/** Pixel formats libcimbar reads directly; others are converted to RGBA. */
const NATIVE_FORMATS: readonly string[] = ['NV12', 'I420'];

interface Extractor {
  worker: CimbarWorker;
  inFlight: number;
}

function extractWorkerCount(): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 2;
  return Math.min(3, Math.max(1, cores - 1));
}

async function copyPixels(frame: VideoFrame) {
  const { width, height } = frame.visibleRect ?? { width: frame.codedWidth, height: frame.codedHeight };
  const native = frame.format !== null && NATIVE_FORMATS.includes(frame.format);
  const options: VideoFrameCopyToOptions = native ? {} : { format: 'RGBA' };
  const pixels = new Uint8Array(frame.allocationSize(options));
  await frame.copyTo(pixels, options);
  return { pixels, format: native ? frame.format! : 'RGBA', width, height };
}

/**
 * Decodes one transfer: N extract workers find the code in each frame and
 * return its fountain bytes, and one assembler worker rebuilds the file.
 */
export function createCimbarReceiver(options: ResolvedCimbarOptions, hooks: ReceiverHooks): ReceiverDriver {
  const extractors: Extractor[] = [];
  let assembler: CimbarWorker | null = null;
  /** The fixed mode, or the first mode that decoded. */
  let mode = options.receiveMode;
  let rotation = 0;
  let nextExtractor = 0;
  let progress: number | null = null;
  let sawData = false;
  let finished = false;
  let disposed = false;

  const workers = () => [...extractors.map(({ worker }) => worker), ...(assembler ? [assembler] : [])];

  const stop = () => {
    finished = true;
    for (const worker of workers()) worker.terminate();
  };

  const onAbort = (reason: unknown) => {
    if (finished || disposed) return;
    stop();
    hooks.onFailure(
      new QrcastError(
        'codec-aborted',
        { codec: 'cimbar', role: 'receiver', progress },
        `A cimbar decoder aborted: ${String(reason)}`,
        { cause: reason },
      ),
    );
  };

  const onExtracted = (extractor: Extractor, reply: WorkerReply) => {
    if (reply.type !== 'extracted') return;
    extractor.inFlight--;
    if (finished || reply.bytes.length === 0) return;
    // Detection: the first mode that yields bytes is used from now on.
    mode ??= reply.mode;
    if (reply.mode !== mode) return;
    if (!sawData) {
      sawData = true;
      hooks.onData();
    }
    assembler?.post({ type: 'assemble', bytes: reply.bytes, mode }, [reply.bytes.buffer]);
  };

  const onAssembled = (reply: WorkerReply) => {
    if (finished) return;
    if (reply.type === 'progress') {
      if (reply.progress !== null && reply.progress !== progress) {
        progress = reply.progress;
        hooks.onProgress(reply.progress);
      }
    } else if (reply.type === 'file') {
      stop();
      hooks.onFile(reply.bytes, reply.name);
    }
  };

  return {
    async load() {
      const initialMode = mode ?? AUTO_MODES[0]!;
      const starts = Array.from({ length: extractWorkerCount() }, () =>
        CimbarWorker.start(options, 'extract', initialMode),
      );
      starts.push(CimbarWorker.start(options, 'assemble', initialMode));
      const results = await Promise.allSettled(starts);
      const started = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure || disposed) {
        for (const worker of started) worker.terminate();
        if (failure) throw failure.reason;
        return;
      }
      assembler = started.pop()!;
      assembler.onMessage = onAssembled;
      assembler.onAbort = onAbort;
      for (const worker of started) {
        const extractor: Extractor = { worker, inFlight: 0 };
        worker.onMessage = (reply) => onExtracted(extractor, reply);
        worker.onAbort = onAbort;
        extractors.push(extractor);
      }
    },

    canAccept() {
      return !finished && !disposed && extractors.some(({ inFlight }) => inFlight < MAX_IN_FLIGHT);
    },

    push(frame) {
      let extractor: Extractor | undefined;
      for (let i = 0; i < extractors.length && !extractor; i++) {
        const candidate = extractors[(nextExtractor + i) % extractors.length]!;
        if (candidate.inFlight < MAX_IN_FLIGHT) {
          extractor = candidate;
          nextExtractor = (nextExtractor + i + 1) % extractors.length;
        }
      }
      if (!extractor || finished || disposed) {
        frame.close();
        return;
      }
      const target = extractor;
      const frameMode = mode ?? AUTO_MODES[rotation++ % AUTO_MODES.length]!;
      // Counted until the worker replies, or until the frame is dropped here.
      target.inFlight++;
      copyPixels(frame)
        .then(
          ({ pixels, format, width, height }) => {
            if (finished || disposed) {
              target.inFlight--;
              return;
            }
            target.worker.post({ type: 'extract', pixels, format, width, height, mode: frameMode }, [
              pixels.buffer,
            ]);
          },
          () => {
            target.inFlight--;
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
