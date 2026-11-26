// Build-time pre-render (ADR 0047): renders each public page to HTML so search
// engines and link previews see the real content. Only scripts/site/prerender.mjs
// uses this; live data (prices, availability) still loads in the browser.
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { AppProviders, AppRoutes } from './App';

export { appShellFile, indexedPages, notFoundPage, SITE_URL, SOCIAL_IMAGE, structuredData } from './seo/meta';

export function render(path: string): string {
  return renderToString(
    <StrictMode>
      <AppProviders>
        <StaticRouter location={path}>
          <AppRoutes />
        </StaticRouter>
      </AppProviders>
    </StrictMode>,
  );
}
