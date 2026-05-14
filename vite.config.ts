import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // No proxy needed — in dev mode Vite runs as Express middleware
  // on the same port as the API (see src/server.ts).
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
