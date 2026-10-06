import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * What a built page may load and run: its own files and nothing else. The app talks to no server
 * of its own, so anything that tries to (through a bug, or a design from a link that found a hole)
 * is stopped by the browser. Inline styles are allowed because the canvas positions its parts
 * with them. The one address it may call is Anthropic's API, for a review with the visitor's key.
 */
const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.anthropic.com",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Puts the policy in each built page. It is left out while developing, when the dev server needs
 * to inject scripts of its own. A static host cannot be asked to send it as a header.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'loadline:content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: POLICY }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  // Relative asset paths, so the build works from any folder on GitHub Pages.
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  worker: { format: 'es' },
  // Two pages: the app, and the read-only view that other sites put in a frame.
  build: { rollupOptions: { input: { main: 'index.html', embed: 'embed.html' } } },
  server: { port: 5183, strictPort: true },
  preview: { port: 5183, strictPort: true },
});
