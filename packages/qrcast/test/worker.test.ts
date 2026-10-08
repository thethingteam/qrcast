import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CodecWorker as CodecWorkerType, WorkerStart } from '../src/internal/worker.js';
import { flush } from './fakes.js';

/** Stands in for a dedicated worker; the test plays the worker's side. */
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: unknown): void {
    this.onmessage?.({ data });
  }

  fail(message: string): void {
    this.onerror?.({ message, preventDefault() {} });
  }
}

let CodecWorker: typeof CodecWorkerType;
let created: FakeWorker[];

function options(overrides: Partial<WorkerStart> = {}): WorkerStart {
  return {
    codec: 'fake',
    engine: 'fake-engine',
    workerUrl: new URL('https://example.invalid/worker.js'),
    workerFactory: () => {
      const worker = new FakeWorker();
      created.push(worker);
      return worker as unknown as Worker;
    },
    init: { type: 'init' },
    ...overrides,
  };
}

/** Starts a worker and keeps its outcome, so a rejection is never unhandled. */
function start(overrides?: Partial<WorkerStart>, signal?: AbortSignal) {
  const outcome: { value?: CodecWorkerType<unknown>; error?: unknown; settled: boolean } = { settled: false };
  const promise = CodecWorker.start<unknown>(options(overrides), signal).then(
    (value) => Object.assign(outcome, { value, settled: true }),
    (error: unknown) => Object.assign(outcome, { error, settled: true }),
  );
  return { outcome, promise };
}

beforeEach(async () => {
  // A fresh module per test, so each test gets an empty start queue.
  vi.resetModules();
  ({ CodecWorker } = await import('../src/internal/worker.js'));
  created = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CodecWorker.start, one worker at a time', () => {
  test('creates the next worker only after the previous one is ready', async () => {
    const first = start();
    const second = start();
    await flush();
    expect(created).toHaveLength(1);
    expect(created[0]!.posted).toEqual([{ type: 'init' }]);

    created[0]!.reply({ type: 'ready' });
    await flush();
    expect(first.outcome.value).toBeDefined();
    expect(created).toHaveLength(2);

    created[1]!.reply({ type: 'ready' });
    await second.promise;
    expect(second.outcome.value).toBeDefined();
  });

  test('passes the turn on when a worker answers with a failure', async () => {
    const first = start();
    const second = start();
    await flush();
    created[0]!.reply({ type: 'init-failed', reason: 'NetworkError: Load failed' });
    await flush();
    expect(first.outcome.error).toMatchObject({ code: 'codec-init-failed', details: { codec: 'fake' } });
    expect(created[0]!.terminated).toBe(true);
    expect(created).toHaveLength(2);
    created[1]!.reply({ type: 'ready' });
    await second.promise;
    expect(second.outcome.value).toBeDefined();
  });

  test('passes the turn on when a worker script fails to load', async () => {
    const first = start();
    start();
    await flush();
    created[0]!.fail('Load failed');
    await flush();
    expect(first.outcome.error).toMatchObject({ code: 'codec-init-failed' });
    expect(created).toHaveLength(2);
  });

  test('passes the turn on when a message cannot be read', async () => {
    const first = start();
    start();
    await flush();
    created[0]!.onmessageerror?.();
    await flush();
    expect(first.outcome.error).toMatchObject({ code: 'codec-init-failed' });
    expect(created).toHaveLength(2);
  });

  test('passes the turn on when the factory throws', async () => {
    const first = start({
      workerFactory: () => {
        throw new Error('blocked');
      },
    });
    start();
    await flush();
    expect(first.outcome.error).toMatchObject({ code: 'codec-init-failed' });
    expect(created).toHaveLength(1);
  });

  test('passes the turn on when a worker times out, and counts the timeout from creation', async () => {
    vi.useFakeTimers();
    const first = start();
    const second = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(1);

    // The second worker waited 29 s in the queue; that time is not counted.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(created).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(first.outcome.error).toMatchObject({ code: 'codec-init-failed' });
    expect(created[0]!.terminated).toBe(true);
    expect(created).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(second.outcome.settled).toBe(false);
    created[1]!.reply({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(second.outcome.value).toBeDefined();
  });

  test('later messages of a ready worker do not affect the queue', async () => {
    const first = start();
    await flush();
    created[0]!.reply({ type: 'ready' });
    await first.promise;
    const second = start();
    await flush();
    expect(created).toHaveLength(2);
    created[0]!.reply({ type: 'aborted', reason: 'late' });
    const third = start();
    await flush();
    expect(created).toHaveLength(2);
    created[1]!.reply({ type: 'ready' });
    await second.promise;
    await flush();
    expect(created).toHaveLength(3);
    expect(third.outcome.settled).toBe(false);
  });
});

describe('CodecWorker.start with an abort signal', () => {
  test('an aborted start that waits creates no worker and gives up its place', async () => {
    const first = start();
    const controller = new AbortController();
    const second = start(undefined, controller.signal);
    const third = start();
    await flush();
    controller.abort();
    await flush();
    expect(second.outcome.error).toBeInstanceOf(DOMException);
    expect((second.outcome.error as DOMException).name).toBe('AbortError');

    created[0]!.reply({ type: 'ready' });
    await first.promise;
    await flush();
    // The third start comes right after the first; the second never created one.
    expect(created).toHaveLength(2);
    created[1]!.reply({ type: 'ready' });
    await third.promise;
    expect(third.outcome.value).toBeDefined();
  });

  test('a start aborted before it is queued creates nothing', async () => {
    const aborted = start(undefined, AbortSignal.abort());
    await flush();
    expect(aborted.outcome.error).toBeInstanceOf(DOMException);
    expect(created).toHaveLength(0);
  });

  test('aborting a starting worker ends it and passes the turn on', async () => {
    const controller = new AbortController();
    const first = start(undefined, controller.signal);
    const second = start();
    await flush();
    expect(created).toHaveLength(1);
    controller.abort();
    await flush();
    expect(first.outcome.error).toBeInstanceOf(DOMException);
    expect(created[0]!.terminated).toBe(true);
    expect(created).toHaveLength(2);
    // A late reply from the ended worker changes nothing.
    created[0]!.reply({ type: 'ready' });
    created[1]!.reply({ type: 'ready' });
    await second.promise;
    expect(second.outcome.value).toBeDefined();
  });

  test('aborting after ready does not end the worker', async () => {
    const controller = new AbortController();
    const first = start(undefined, controller.signal);
    await flush();
    created[0]!.reply({ type: 'ready' });
    await first.promise;
    controller.abort();
    expect(created[0]!.terminated).toBe(false);
  });
});
