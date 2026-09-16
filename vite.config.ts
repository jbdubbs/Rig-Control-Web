import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  worker: {
    format: 'es',
    rollupOptions: {
      // public/ft8-decoder.js is a static runtime asset (see native/ft8-decoder), not
      // something to bundle — keep the worker's dynamic import pointed at it as-is.
      external: ['/ft8-decoder.js'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
