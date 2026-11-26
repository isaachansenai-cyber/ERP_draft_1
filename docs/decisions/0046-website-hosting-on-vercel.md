# ADR 0046: The public website is hosted on Vercel; hosted builds must be connected

**Status:** accepted (2026-11-26, operator direction)

- The public pickup website (`site/`) is served by Vercel at `https://www.meatsaroundtheworld.site`; the bare domain redirects there (308). `vercel.json` builds only the site. The staff ERP stays on GitHub Pages.
- Both apps talk to the same Supabase project, so the website and the ERP stay in step through the database alone: menu, prices and availability come from the ERP, and web orders land in the ERP kitchen queue. There is no direct app-to-app call.
- A Vite build normally succeeds without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` and shows "not connected". On Vercel (`VERCEL=1`), `site/vite.config.ts` now stops the build instead, so a site that cannot take orders never replaces a working one. Local and CI builds are unchanged.
- The ERP shows a link to the live site under Settings → Website when `VITE_PUBLIC_SITE_URL` is set at build time (`pages.yml`). The public site deliberately has no link to the staff app.
- Both Vercel variables are public by design (project URL and publishable key). No secret key goes into Vercel.
