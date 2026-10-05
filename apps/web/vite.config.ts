import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any folder on GitHub Pages.
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  server: { port: 5183, strictPort: true },
  preview: { port: 5183, strictPort: true },
});
