import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig({
  // HTTPS with a self-signed certificate, so phones on the LAN may open the camera.
  plugins: [basicSsl()],
  server: { host: true },
  // Pre-bundling would move qrcast's code away from its wasm and worker files.
  optimizeDeps: { exclude: ['qrcast'] },
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        send: 'send.html',
        receive: 'receive.html',
      },
    },
  },
});
