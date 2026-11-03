import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    rollupOptions: { output: { manualChunks: {
      'pdf-renderer': ['pdfjs-dist'], 'pdf-export': ['pdf-lib'],
      'font-engine': ['@pdf-lib/fontkit'],
    } } },
  },
});
