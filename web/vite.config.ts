import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  logLevel: 'error',
  esbuild: {
    logLevel: 'error'
  },
  build: {
    chunkSizeWarningLimit: 2000
  },
  server: {
    port: 5173
  }
});
