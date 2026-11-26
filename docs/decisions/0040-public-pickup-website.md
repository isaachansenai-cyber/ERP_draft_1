# 0040 Public pickup-ordering website

Operator decision (session, 2026-11-25 and 2026-11-26). Changes scope: PRD §19 deferred "customer self-ordering". Full plan: `docs/website/BUILD_PLAN.md`.

- **In scope:** a public website under `/site`, in this repo and on the same Supabase project. Customers browse, see live availability and order dishes or retail sauces **for pickup only**. Still out: customer logins, delivery, tips, real payments, e-mail.
- **Access:** visitors use Supabase anonymous sign-in with captcha. They can call only the new `public.web_*` functions and can read no tables. Staff RPCs keep rejecting them through membership checks.
- **One acceptance path:** `accept_order`'s body becomes `private.accept_order_core`, shared by the POS and `web_place_order`. Web orders are accepted by a system employee `EMP-WEB` (no login) with `channel = 'web'`, so reservation, tax, audit and accounting rules are identical to POS orders.
- **Payment:** no card fields. Demo records a `SIMULATED` tender at checkout. The pilot shows "Pay at pickup", and staff record the real payment as `MANUAL_EXTERNAL`. A pretend payment would be a false record on a real order. The receipt is on screen only.
- **Operations:** customer picks the location; 12:00–20:00 daily; 15-minute slots, at most 4 web orders per slot, up to 7 days ahead; earliest slot set by the slowest dish (`prep_lead_days`, new `prep_minutes`). No online cancellation; a manager cancels no-shows at end of day.
- **Stock shown** as Available or Sold out only, capped at 10 per line. The site polls every 30 s. Realtime is not exposed to anonymous visitors.
- **Pilot safety:** a new gate, `web_ordering_enabled`, per location, plus the existing price, tax, recipe and opening-count gates. Allergen notes (dairy, nuts, wheat) are drafted from ingredient names and stay hidden until the owner reviews them.
