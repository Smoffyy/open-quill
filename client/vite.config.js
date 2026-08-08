import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isLocaleChunk = (id) => typeof id === 'string' && id.includes('/locales/');

export default defineConfig({
  plugins: [react()],
  build: {
    modulePreload: {
      resolveDependencies: (_file, deps) => deps.filter(d => !d.includes('/locale-')),
    },
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (!isLocaleChunk(id)) return undefined;
          const name = id.split('/').pop().replace(/\.json$/, '');
          return 'locale-' + name;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true }
    }
  }
});
