import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const vendorDir = fileURLToPath(new URL('./vendor/cimbar/', import.meta.url));
const zxingDir = fileURLToPath(new URL('./vendor/zxing-wasm/', import.meta.url));

/**
 * Serves the vendored libcimbar files where the codec's source expects them
 * (next to src/codecs/cimbar/runtime.ts), as the build does for dist/.
 */
function vendoredCimbar(): Plugin {
  return {
    name: 'qrcast-vendored-cimbar',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /\/src\/codecs\/cimbar\/(cimbar_js\.[\w.-]+\.(js|wasm))(?:\?.*)?$/.exec(request.url ?? '');
        if (!match) return next();
        response.setHeader('Content-Type', match[2] === 'wasm' ? 'application/wasm' : 'text/javascript');
        createReadStream(vendorDir + match[1]).pipe(response);
      });
    },
  };
}

/**
 * Serves the vendored zxing-wasm files where the QR codec's source expects
 * them (next to src/codecs/qr/runtime.ts), as the build does for dist/.
 */
function vendoredZxing(): Plugin {
  return {
    name: 'qrcast-vendored-zxing',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /\/src\/codecs\/qr\/(zxing_reader\.(js|wasm))(?:\?.*)?$/.exec(request.url ?? '');
        if (!match) return next();
        response.setHeader('Content-Type', match[2] === 'wasm' ? 'application/wasm' : 'text/javascript');
        createReadStream(zxingDir + match[1]).pipe(response);
      });
    },
  };
}

export default defineConfig({
  plugins: [vendoredCimbar(), vendoredZxing()],
  test: {
    include: ['test/browser/**/*.test.ts'],
    testTimeout: 60_000,
    // One file at a time: the sender tests count frames per second, and
    // decoding in the receiver tests of another file slows their timers.
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          // Software WebGL, so OffscreenCanvas WebGL works without a GPU.
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
