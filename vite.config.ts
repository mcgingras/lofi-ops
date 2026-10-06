import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/client'),
  // assets/textures/*.jpg is served at /textures/*.jpg (dev) and copied into dist/client/textures (build).
  publicDir: resolve(import.meta.dirname, 'assets'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      '/api': { target: `http://localhost:${SERVER_PORT}` },
    },
  },
});
