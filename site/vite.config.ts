import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The public website is a separate Vite app rooted in /site (CLAUDE.md D12).
// It is served under its own GitHub Pages path, set by VITE_SITE_BASE_PATH.
const siteRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_SITE_BASE_PATH || '/';
  return {
    root: siteRoot,
    base: base.endsWith('/') ? base : `${base}/`,
    plugins: [react()],
    envDir: process.cwd(),
    envPrefix: 'VITE_',
    build: { sourcemap: false, outDir: 'dist', emptyOutDir: true },
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
    preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  };
});
