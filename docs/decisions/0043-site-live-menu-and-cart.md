# 0043 Website live menu and cart (W3)

Operator request (session, 2026-11-26): start W3. Choices not settled by ADRs 0040–0042:

- **Typed contracts.** `site/src/lib/webApi.ts` checks every `web_*` response with Zod before a page sees it. A response of the wrong shape is an error (`unexpected_response`), never silently shown. The site has its own contracts and does not import the staff app's generated types.
- **Refresh.** TanStack Query refetches the menu every 30 s and when the tab regains focus. Polling, not Realtime (ADR 0040). The menu says when its prices and availability were last read.
- **Location and cart in the browser.** The chosen location and one cart per location live in `localStorage` (`matw.location.v1`, `matw.cart.v1.<location>`), each read with a fallback when storage is unavailable. Switching location never mixes carts. The cart page says "Not ordered yet" and is always re-priced from the latest menu; lines that are sold out, over the limit or gone are flagged and the subtotal leaves them out.
- **Limits.** Quantities are whole numbers from 1 to the item's `max_orderable` (at most 10), minus what is already in the cart.
- **No backend configured** (a build without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`): content pages still work, and the menu and cart say the site is not connected. Nothing pretends to take orders.
- **Closed or paused location**: prices are shown, nothing can be added, and the reason is given in plain words.
- **Tests.** `playwright.site.config.ts` covers the site with no backend. `playwright.site-live.config.ts` resets the local database to demo, builds the site against it and drives the menu and cart, including a sold-out change made in the database that the page must pick up on its own refresh.
