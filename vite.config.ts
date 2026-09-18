import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
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
