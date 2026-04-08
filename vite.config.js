import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

function getBackendPort() {
  try {
    return parseInt(readFileSync('/tmp/cc-viewer-port', 'utf-8').trim(), 10);
  } catch {
    return 7008;
  }
}

export default defineConfig(() => {
  const port = getBackendPort();
  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
    },
    server: {
      proxy: {
        '/events': `http://127.0.0.1:${port}`,
        '/api': `http://127.0.0.1:${port}`,
        '/ws/terminal': { target: `ws://127.0.0.1:${port}`, ws: true },
      },
    },
  };
});
