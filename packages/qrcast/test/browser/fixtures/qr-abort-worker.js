// Stands in for qr-worker.js: it reads one valid frame (1 of 4 blocks, so the
// progress is 0.25) and then aborts, like a wasm instance running out of memory.
'use strict';

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    self.postMessage({ type: 'ready' });
  } else if (message.type === 'decode') {
    message.bitmap.close();
    self.postMessage({ type: 'decoded', texts: ['QRCAST1F/ABCDEF/0/4/8/00000000/000'] });
    setTimeout(() => self.postMessage({ type: 'aborted', reason: 'Aborted(OOM)' }), 20);
  }
};
