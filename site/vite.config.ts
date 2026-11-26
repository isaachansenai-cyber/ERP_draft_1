import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The public website is a separate Vite app rooted in /site (CLAUDE.md D12).
// It is served under its own GitHub Pages path, set by VITE_SITE_BASE_PATH.
const siteRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Content-Security-Policy for the built site (ADR 0045). GitHub Pages cannot
 * send headers, so it goes in a <meta> tag: scripts, styles, fonts and images
 * from the site itself only, and network calls to the ERP's API only. The dev
 * server needs inline scripts for hot reload, so there the tag is left out.
 */
export function sitePolicy(supabaseUrl: string | undefined): string {
  const api = supabaseUrl ? new URL(supabaseUrl).origin : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${api ? ` ${api}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'site-content-security-policy',
    transformIndexHtml(html, ctx) {
      return ctx.server
        ? html.replace(/^\s*<meta http-equiv="Content-Security-Policy"[^>]*>\n/m, '')
        : html.replace('%SITE_CSP%', sitePolicy(supabaseUrl));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_SITE_BASE_PATH || '/';
  return {
    root: siteRoot,
    base: base.endsWith('/') ? base : `${base}/`,
    plugins: [react(), contentSecurityPolicy(env.VITE_SUPABASE_URL)],
    envDir: process.cwd(),
    envPrefix: 'VITE_',
    build: { sourcemap: false, outDir: 'dist', emptyOutDir: true },
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
    preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  };
});
