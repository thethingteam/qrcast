// Reports which WebGL contexts an OffscreenCanvas can create inside a worker.
const canvas = new OffscreenCanvas(1, 1);
self.postMessage({
  webgl2: canvas.getContext('webgl2') !== null,
});
