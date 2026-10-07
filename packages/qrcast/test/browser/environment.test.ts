import { expect, test } from 'vitest';

test('a worker can create a WebGL2 context on an OffscreenCanvas', async () => {
  const worker = new Worker(new URL('./fixtures/webgl-worker.js', import.meta.url));
  try {
    const result = await new Promise<{ webgl2: boolean }>((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message));
    });
    expect(result.webgl2).toBe(true);
  } finally {
    worker.terminate();
  }
});
