import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri drives the dev server, so the port is fixed and failures must be loud
// rather than silently sliding to another port the Rust side isn't watching.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    watch: {
      // Rust artefacts churn constantly during `tauri dev`; watching them
      // would trigger endless HMR reloads.
      ignored: ['**/src-tauri/**', '**/data/**'],
    },
  },
  build: {
    target: 'safari17',
    minify: 'esbuild',
    sourcemap: false,
  },
});
