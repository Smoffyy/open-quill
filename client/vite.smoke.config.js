import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    ssr: 'scripts/smoke.jsx',
    outDir: 'node_modules/.smoke',
    emptyOutDir: true,
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/server'] },
  },
});
