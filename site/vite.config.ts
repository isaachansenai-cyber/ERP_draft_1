import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The public website is a separate Vite app rooted in /site (CLAUDE.md D12),
// hosted on Vercel at the domain root (ADR 0047). VITE_SITE_BASE_PATH can still
// serve it under a sub-path.
const siteRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Content-Security-Policy for the built site (ADR 0045), in a <meta> tag so it
 * travels with the HTML on any host: scripts, styles, fonts and images
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

/** Browser-only pages Vercel serves from the app shell (vercel.json rewrites). */
export const APP_SHELL_ROUTES = /^\/(cart|checkout|order\/[^/]+)\/?$/;

/**
 * `vite preview` answers like Vercel does (vercel.json, ADR 0047): /menu from
 * menu.html, browser-only pages from app.html, anything else the 404 page
 * with a 404 status. Tests then see the same routing as the live site.
 */
function vercelLikePreview(): Plugin {
  return {
    name: 'site-vercel-like-preview',
    configurePreviewServer(server) {
      const outDir = fileURLToPath(new URL('./dist/', import.meta.url));
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/' || /\.[a-z0-9]+$/i.test(path)) return next();
        // A plain `vite build` (no pre-render): let Vite serve the app for every page.
        if (!existsSync(`${outDir}app.html`)) return next();
        const clean = path.replace(/\/$/, '');
        if (APP_SHELL_ROUTES.test(clean)) {
          req.url = '/app.html';
        } else if (existsSync(`${outDir}${clean.slice(1)}.html`)) {
          req.url = `${clean}.html`;
        } else {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(readFileSync(`${outDir}404.html`));
          return;
        }
        next();
      });
    },
  };
}

/**
 * A hosted build (Vercel sets VERCEL=1) must know which ERP it talks to.
 * Without these values the site would go live unable to show prices or take
 * orders, so the build stops instead (ADR 0046).
 */
export function missingHostedConfig(env: Record<string, string | undefined>): string[] {
  if (!env.VERCEL) return [];
  return ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k]?.trim());
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build') {
    const missing = missingHostedConfig({ ...env, VERCEL: process.env.VERCEL });
    if (missing.length) {
      throw new Error(
        `The website build needs ${missing.join(' and ')} (Vercel → Settings → Environment Variables, ` +
          'ticked for this environment). Nothing was deployed.',
      );
    }
  }
  const base = env.VITE_SITE_BASE_PATH || '/';
  return {
    root: siteRoot,
    base: base.endsWith('/') ? base : `${base}/`,
    plugins: [react(), contentSecurityPolicy(env.VITE_SUPABASE_URL), vercelLikePreview()],
    envDir: process.cwd(),
    envPrefix: 'VITE_',
    build: { sourcemap: false, outDir: 'dist', emptyOutDir: true },
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
    preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  };
});
