import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app under /<repo-name>/; HashRouter keeps deep links
// and refreshes working without a server rewrite (PRD §15).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || '/';
  return {
    base: base.endsWith('/') ? base : `${base}/`,
    plugins: [react()],
    // Only VITE_* variables are ever exposed to the bundle.
    envPrefix: 'VITE_',
    build: { sourcemap: false, outDir: 'dist' },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
