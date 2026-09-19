import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Baseline Content Security Policy for the production document. A hosting
 * server should still send the full policy as a header (see
 * deploy/nginx.example.conf, which adds frame-ancestors); this meta tag keeps
 * script injection blocked on hosts that send no headers at all. It is not
 * added in development because the dev server injects inline module scripts.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const cspMeta: Plugin = {
  name: 'clinic-csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  plugins: [react(), cspMeta],
  server: {
    port: 5173,
    strictPort: true,
    https: process.env.CLINIC_HTTPS_PFX
      ? {
          pfx: readFileSync(process.env.CLINIC_HTTPS_PFX),
          passphrase: process.env.CLINIC_HTTPS_PASSWORD,
        }
      : undefined,
  },
  build: { sourcemap: false },
});
