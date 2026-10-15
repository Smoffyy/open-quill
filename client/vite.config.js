import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { PRESETS, DEFAULT_PRESET } from './src/lib/presets.js';
import { PALETTES, paletteChain } from './src/lib/palettes.js';

const isLocaleChunk = (id) => typeof id === 'string' && id.includes('/locales/');

function bootData() {
  return {
    preset: DEFAULT_PRESET,
    presets: Object.fromEntries(PRESETS.map(p => [p.id, { layout: p.layout, dark: p.palettes.dark, light: p.palettes.light }])),
    palettes: Object.fromEntries(PALETTES.map(p => [p.id, { preset: p.preset, mode: p.mode, chain: paletteChain(p.id).join(' '), bg: p.bg }]))
  };
}

const bootScript = {
  name: 'oq-boot',
  transformIndexHtml: (html) => html.replace('__OQ_BOOT__', JSON.stringify(bootData()))
};

export default defineConfig({
  plugins: [react(), bootScript],
  build: {
    chunkSizeWarningLimit: 800,
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