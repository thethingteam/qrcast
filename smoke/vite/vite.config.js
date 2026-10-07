import { defineConfig } from 'vite';

// The setting the README tells Vite users to add.
export default defineConfig({ optimizeDeps: { exclude: ['qrcast'] } });
