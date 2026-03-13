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
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8888',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/sugarpy/api')
      }
    }
  }
});
