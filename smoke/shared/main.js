// The consumer app every smoke project builds. It imports each public entry
// point, creates a receiver for both codecs and preloads them, which fetches
// the workers, glue scripts and wasm files, then reports the outcome.
import { createReceiver } from 'qrcast/receiver';
import { cimbar } from 'qrcast/cimbar';
import { qr } from 'qrcast/qr';

const receiver = createReceiver({
  codecs: [cimbar(), qr()],
  video: document.createElement('video'),
});
try {
  await receiver.preload();
  window.__smoke = { ok: true };
} catch (error) {
  window.__smoke = { ok: false, code: error?.code, message: String(error?.message ?? error) };
} finally {
  receiver.destroy();
}
