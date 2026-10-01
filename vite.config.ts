import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from the repository subpath.
export default defineConfig({
  plugins: [react()],
  base: '/Network-Protocol-Visual-Lab/',
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
