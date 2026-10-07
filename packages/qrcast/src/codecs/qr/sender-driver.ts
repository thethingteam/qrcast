import type { SenderDriver, SenderHooks } from '../../internal/codec.js';
import { FountainEncoder } from './fountain.js';
import type { ResolvedQrOptions } from './options.js';
import { chooseVersion, renderPicture } from './picture.js';

/**
 * Plays one transfer on the main thread: it needs no worker and no asset. A
 * pixel fill of a picture costs about a millisecond, and the core asks for the
 * next frame as soon as one is shown.
 */
export function createQrSender(options: ResolvedQrOptions, _hooks: SenderHooks): SenderDriver {
  let encoder: FountainEncoder | null = null;
  let version = 0;
  let picture = 0;

  return {
    fps: options.fps,

    async start(envelope) {
      encoder = new FountainEncoder(envelope, options.blockSize);
      version = chooseVersion(encoder);
    },

    nextFrame() {
      if (!encoder) return Promise.reject(new Error('The QR sender has not started.'));
      const { data, width, height } = renderPicture(encoder, version, options.layers, picture++);
      return createImageBitmap(new ImageData(data, width, height));
    },

    dispose() {
      encoder = null;
    },
  };
}
