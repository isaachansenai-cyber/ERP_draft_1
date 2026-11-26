# ADR 0047: Real page addresses and pre-rendered pages for search

**Status:** accepted (2026-11-26, operator direction: "anyone who looks up Meats Around the World in Google sees our site first")

- The public website moves from hash routes (`/#/menu`) to real addresses (`/menu`). Search engines ignore everything after `#`, so before this the whole site was one page to them. Old `/#/…` links are moved to the matching address on load.
- `npm run site:build` now also renders each public page (home, menu, countries, story, FAQ, 404) to finished HTML (`site/src/entry-server.tsx`, `scripts/site/prerender.mjs`). Crawlers and link previews see the real text without running JavaScript; prices, availability and the cart still load live in the browser. The browser replaces the pre-rendered page instead of hydrating it, because what a visitor sees depends on their saved location and cart.
- One table (`site/src/seo/meta.ts`) gives each page its title, description and canonical address on `https://www.meatsaroundtheworld.site`. It also feeds the sitemap and the browser tab title. The home page carries schema.org data: the Organization, the WebSite (site name) and one Restaurant per location with city, state, daily 12–8 pm hours and cuisines. Street addresses, phone numbers and prices are left out until the owner supplies them (operator decision: city only for now).
- Cart, checkout and order receipts are served from an empty app shell with `noindex` (meta tag and `X-Robots-Tag`) and are disallowed in `robots.txt`. Unknown addresses get a real 404.
- The website is no longer published to GitHub Pages (operator decision), so there is one copy for search engines to find. `vite preview` routes like Vercel so the browser tests see the same addresses.
- While the site runs on the demo database it stays indexable with the demo banner on every page (operator decision). Real visitors can place simulated orders until the pilot database is connected.
