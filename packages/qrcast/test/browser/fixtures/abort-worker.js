// Stands in for cimbar-worker.js and aborts partway through, like a wasm
// instance running out of memory.
'use strict';

let frames = 0;

self.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      self.postMessage({ type: 'ready' });
      break;
    case 'encode':
      self.postMessage({ type: 'encoded' });
      break;
    case 'frame': {
      frames++;
      if (frames > 3) {
        self.postMessage({ type: 'aborted', reason: 'Aborted(OOM)' });
        break;
      }
      const canvas = new OffscreenCanvas(64, 64);
      const context = canvas.getContext('2d');
      context.fillStyle = `rgb(${frames * 60}, 0, 0)`;
      context.fillRect(0, 0, 64, 64);
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ type: 'frame', bitmap }, [bitmap]);
      break;
    }
    case 'extract': {
      const bytes = Uint8Array.of(1, 2, 3);
      self.postMessage({ type: 'extracted', bytes, mode: message.mode }, [bytes.buffer]);
      break;
    }
    case 'assemble':
      self.postMessage({ type: 'progress', progress: 0.4 });
      setTimeout(() => self.postMessage({ type: 'aborted', reason: 'Aborted(OOM)' }), 50);
      break;
  }
};
