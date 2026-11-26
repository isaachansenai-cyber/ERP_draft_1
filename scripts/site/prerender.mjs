// Build step after `vite build` (ADR 0047): writes one finished HTML file per
// public page, so search engines and link previews read real content, plus
// robots.txt and sitemap.xml. Live prices and availability still load in the
// browser. Uses the server bundle built from site/src/entry-server.tsx.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteDir = fileURLToPath(new URL('../../site/', import.meta.url));
const dist = `${siteDir}dist/`;
const serverEntry = `${siteDir}dist-server/entry-server.js`;

const ssr = await import(pathToFileURL(serverEntry).href);
const { render, indexedPages, notFoundPage, appShellFile, SITE_URL, SOCIAL_IMAGE, structuredData } = ssr;
const template = await readFile(`${dist}index.html`, 'utf8');

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlFor = (path) => (path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`);

function pageHtml({ meta, body, indexable, jsonLd }) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const head = [
    indexable ? `<link rel="canonical" href="${urlFor(meta.path)}" />` : '<meta name="robots" content="noindex" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Meats Around the World" />',
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    indexable ? `<meta property="og:url" content="${urlFor(meta.path)}" />` : '',
    `<meta property="og:image" content="${SOCIAL_IMAGE}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  const out = template
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${description}$2`)
    .replace('<!--seo-head-->', head)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  if (!out.includes(`<title>${title}</title>`) || !out.includes(head) || !out.includes(`content="${description}"`)) {
    throw new Error(`prerender: site/index.html no longer has the markers this script fills in (${meta.path})`);
  }
  return out;
}

for (const meta of indexedPages) {
  const html = pageHtml({
    meta,
    body: render(meta.path),
    indexable: true,
    jsonLd: meta.path === '/' ? structuredData() : null,
  });
  await writeFile(`${dist}${meta.file}`, html);
}
await writeFile(
  `${dist}${notFoundPage.file}`,
  pageHtml({ meta: notFoundPage, body: render(notFoundPage.path), indexable: false }),
);
// Cart, checkout and receipts: an empty shell the browser fills in; never indexed.
await writeFile(
  `${dist}${appShellFile}`,
  pageHtml({ meta: { ...indexedPages.find((p) => p.path === '/'), path: '/app' }, body: '', indexable: false }),
);

await writeFile(
  `${dist}robots.txt`,
  [
    'User-agent: *',
    'Allow: /',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /order/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n'),
);
await writeFile(
  `${dist}sitemap.xml`,
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...indexedPages.map((p) => `  <url><loc>${urlFor(p.path)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n'),
);
await rm(`${siteDir}dist-server`, { recursive: true, force: true });
console.log(`prerendered ${indexedPages.length} pages, 404, app shell, robots.txt and sitemap.xml for ${SITE_URL}`);
