# Public pickup website: build plan

Status: **W0, W1 (static site) and W2 (ERP database) complete. W3 not started.** W1 scaffold choices: [ADR 0041](../decisions/0041-site-scaffold.md). W2 decisions: [ADR 0042](../decisions/0042-web-ordering-database.md). Decision record: [ADR 0040](../decisions/0040-public-pickup-website.md). Drafts for owner review: [content drafts](content-drafts.md) and [allergen notes](allergen-notes-draft.md).

This plan adds a public website for Meats Around the World. Customers can browse it, see live availability, and order dishes or retail sauces **for pickup only**. Every order goes straight into the ERP, which handles reservations, the kitchen queue, sales and the accounting effects with the same rules as a POS order.

---

## 1. Decisions (operator, 2026-11-25 and 2026-11-26)

| Topic | Decision |
|---|---|
| Scope | Customer self-ordering for pickup is now in scope (it was PRD §19). Customer logins, delivery, tips and real payments stay out. |
| Payment | **Simulated only, no real cards and no card fields.** In demo mode the order gets a `SIMULATED` tender at checkout. In the pilot, checkout says **"Pay at pickup"** and staff record the real payment at handover (`MANUAL_EXTERNAL`), because a pretend payment would put a false payment record on a real order. |
| Receipt | On screen only: a confirmation page with a printable receipt. No e-mail. |
| Locations | The customer picks Provo, Spanish Fork or Salt Lake City first. Menu, price, tax, stock and pickup times come from that location. |
| ERP target | Demo ERP first. The pilot only after its setup gates are confirmed. |
| Pickup times | 15-minute slots, earliest slot set by the slowest dish in the cart (see §4). Up to 7 days ahead. |
| Hours | **12:00 to 20:00 America/Denver, every day, all three locations.** The last pickup slot is 19:45. Closed days come from the ERP's `location_closures`. |
| Capacity | **At most 4 web orders per 15-minute slot** per location. |
| Menu | Everything the ERP marks sellable at that location: 5 dishes and 2 retail sauces today. New sellable items appear automatically once they have website content. |
| Stock display | "Available" or "Sold out — back soon" only. The cart is capped at what the ERP can actually reserve, with a fixed maximum of 10 per line, so exact counts stay private. |
| Customer cancellation | **None online.** Customers call the store. |
| No-shows | **Cancelled by a manager at end of day** (see §5.4). |
| Allergens | An auto-drafted note per dish for **dairy, nuts and wheat**, derived from recipe ingredient names. The owner must review it before launch ([draft](allergen-notes-draft.md)). |
| Copy | Drafted around a **cultural exploration and inclusion** theme, for owner review ([drafts](content-drafts.md)). |
| Logo | Supplied: `site/public/brand/logo.webp`. |
| Domain | The GitHub Pages address for now. |
| Code location | Same repo, separate app under `/site`, sharing the ERP's Supabase project and migrations. |

---

## 2. Architecture

```
Browser (public site, /site)          Supabase (same project as the ERP)
  React + Vite, HashRouter     ──▶    Auth: anonymous sign-in (+ captcha)
  anon key + URL only                 public.web_* functions (security definer)
  polls menu every 30 s                 └─▶ private.accept_order_core (shared with POS)
                                            └─▶ reservations, order lines, tax snapshot,
                                                tender (demo), audit, request_log
Staff ERP (/src) ◀── same tables ──   kitchen queue, POS, dashboards, planning
```

- **Visitors** get a Supabase **anonymous sign-in** with Supabase's built-in captcha. That gives each browser a real identity for idempotency and rate limits without customer accounts. Anonymous users have no membership, so every existing staff function already rejects them with `unauthorized`.
- **Access is narrow.** Visitors can call only the `web_*` functions below. They read no tables. A test suite proves this for every public table and every staff function (§7).
- **One acceptance path.** The body of `accept_order` moves into `private.accept_order_core(actor, channel, ...)`. The POS keeps calling `accept_order`, and the site calls `web_place_order`. Both share the BOM explosion, FEFO reservation, tax and discount rules, pickup-code generation and audit. Web orders are accepted by a system employee, **"Online ordering"** (no Auth login), and marked `channel = 'web'`.
- **Typed contracts from day one.** Each `web_*` function has a Zod-checked result type in the site, following the RPC-contract recommendation from the 2026-11-25 code review.

### 2.1 Public functions

| Function | Returns / does |
|---|---|
| `web_get_locations()` | Every location with `ordering_open`, a `status_reason` when closed (`posting_disabled`, `setup_incomplete`, `paused`, `no_hours`) and its weekly hours. |
| `web_get_menu(p_location_id)` | Per sellable item that has website content: id, name, type (dish or sauce), country, description, image, allergen note, price, `available` (boolean) and `max_orderable` (0–10). |
| `web_get_pickup_slots(p_location_id, p_lines)` | The 15-minute slots this cart can actually be ready for, with capacity left (as available or full only). |
| `web_place_order(p_request_key, p_location_id, p_lines, p_contact, p_pickup_at, p_note)` | Validates, re-checks slot and capacity, accepts through the shared core (all-or-nothing reservation), records the simulated tender in demo mode, and returns the order number, pickup code, totals and a `web_token`. Retrying with the same key returns the same result. |
| `web_get_order(p_web_token)` | Status (Received, Preparing, Ready, Picked up, Cancelled), pickup time and location, lines, tax, total and payment label. It is found only by a random UUID token, never by the guessable pickup code, and never returns contact details. |
| `web_get_request_result(p_request_key)` | The stored outcome of this visitor's own request, for a placement whose response was lost (AC29). |

Errors use the ERP's stable codes, for example `insufficient_stock` (naming the item), `slot_unavailable`, `setup_gate_closed:web_ordering_enabled` and `validation:<field>`.

---

## 3. ERP database changes (new migrations only)

| Change | Purpose |
|---|---|
| `orders.channel` (`pos`/`web`, default `pos`), `orders.requested_pickup_at`, `orders.web_token` (unique) | Identify web orders, schedule them, and link the confirmation page. |
| Order contact snapshot: name, phone, e-mail on the order (web orders only) | Visible to managers and the owner. Employees see only the pickup name (ADR 0033). |
| `items.prep_minutes` (finishing time on the pickup day) | Turns the text note "~25 min" into a number. It joins the existing `prep_lead_days` and is confirmed by the owner through a setup gate. |
| `location_opening_hours(location_id, weekday, opens_at, closes_at)` | 12:00–20:00 for all days, seeded in demo, owner-confirmed in pilot. |
| `web_ordering_settings(location_id, enabled, slot_minutes 15, orders_per_slot 4, days_ahead 7, max_per_line 10)` | Per-location web controls. |
| `web_menu_content(item_id, country, description, image_path, allergen_note, allergen_reviewed_by/at)` | Website copy per item. An item without reviewed content is hidden from the site. |
| Gate `web_ordering_enabled` (per location) | Blocks `web_place_order` until the owner confirms. The existing gates (prices, tax, recipes, opening counts) still apply through the shared core. |
| System employee `EMP-WEB` "Online ordering" | Actor for web acceptance. It has no Auth user and cannot sign in. |
| Open-order limit (in `web_place_order`) | At most 3 open web orders per visitor, per phone number and per e-mail. Built: W2. An attempts-per-hour counter was dropped, because a refused attempt rolls back its own count; Supabase Auth's captcha and sign-in rate limits cover repeated attempts (W5). |

`prep_minutes` and lead days (owner confirmed 2026-11-26, including both 15-minute finishing times). The demo seed loads them from `data/demo/web_demo_seed.json`; the pilot owner enters them with `set_item_prep_minutes`:

| Dish | `prep_lead_days` | `prep_minutes` (pickup day) | Basis |
|---|---|---|---|
| FG-001 Brazilian Chicken Strogonoff | 0 | 25 | ERP note "Made to order (~25 min)" |
| FG-002 Tacos al Pastor | 1 | 15 | Note "Pork marinates overnight"; 15 min finish confirmed by the owner |
| FG-003 Korean Fried Chicken | 0 | 20 | ERP note "Made to order (~20 min)" |
| FG-004 Beef Bourguignon | 1 | 15 | Note "Braised the day before (~3 hrs)"; 15 min reheat confirmed by the owner |
| FG-005 Mongolian Khorkhog | 0 | 120 | ERP note "Cooked same day (~2 hrs)" |
| RET-001/002 sauces | — | 0 | Retail, handed over as is |

---

## 4. Pickup-slot rule

All times are America/Denver, and slot generation is tested across DST changes.

1. Open slots run from 12:00 to 19:45 on open days, every 15 minutes, for today plus the next 7 days.
2. For each cart line:
   - a dish with `prep_lead_days = 0` is ready at `max(now, 12:00 today) + prep_minutes`;
   - a dish with `prep_lead_days = n` is ready at 12:00 on the n-th following open day, plus `prep_minutes`.
3. The cart's earliest slot is the **latest** of those times, rounded up to the next 15-minute mark. Any later open slot is also allowed.
4. A slot with 4 web orders already is shown as full.
5. Example: at 17:00 on a Tuesday, Tacos al Pastor alone can be picked up from **Wednesday 12:15** (next day + 15 min). A cart with Tacos al Pastor **and** Khorkhog is ready from **Wednesday 14:00**: on Wednesday the kitchen starts at noon and Khorkhog takes 2 hours. (An earlier draft said 12:15 for that cart, which was wrong.) Khorkhog alone ordered at 17:00 is ready from 19:00 the same day; ordered at 18:00 it rolls to Wednesday 14:00.
6. The kitchen does not start web orders before opening at 12:00 (owner confirmed, 2026-11-26).

---

## 5. How a web order moves through the ERP

### 5.1 Placement (one transaction)
1. Validate the input: whole quantities from 1 to 10, contact formats, note ≤ 300 characters, slot valid and not full.
2. Shared core: explode the BOM across the whole cart, reserve FEFO all-or-nothing, snapshot prices and tax, generate the order and pickup codes, and write the order state event and audit row.
3. **Demo:** record a `SIMULATED` tender for the full total. **Pilot:** leave the balance due ("Pay at pickup").
4. Store the result in `request_log`, so a retry returns the same order.

### 5.2 Stock and availability
- Reserved ingredients leave walk-in availability immediately, even for a pickup days ahead. This is the "sequestered" inventory.
- Forecasting already nets accepted orders (AC21), so future web orders feed replenishment proposals automatically.
- An item shows **Sold out** when the ERP cannot reserve one portion, or when a manager has switched it off with the existing `set_menu_availability`. When stock is received, or a manager switches it back on, the site shows it again on its next refresh. Nobody edits the website.
- The site refreshes the menu every 30 seconds and on tab focus. Polling is used instead of Realtime, because subscribing anonymous visitors to stock tables would leak data.
- If stock runs out between browsing and checkout, placement fails with `insufficient_stock` naming the item. Nothing is half-placed, and the cart highlights the line.

### 5.3 Kitchen and staff screens (ERP changes)
- Kitchen queue: a **Web** badge, the requested pickup time and a **"Start by"** time (pickup time minus `prep_minutes`, or the previous day for prep-ahead dishes).
- Orders for a later day sit in a new **Scheduled** lane, so cooks see tomorrow's prep-ahead work today.
- Recent orders and dashboards gain a channel filter (POS or Web).
- New **Settings → Website** screen (owner): enable per location, hours, slot capacity, per-item content and allergen review.

### 5.4 Pickup, no-shows and accounting
- **At pickup**, staff match the pickup code. In the pilot they record the real payment, then complete the order as usual. COGS is recorded at kitchen start and the sale at completion, using the existing ERP rules.
- **No-shows** are cancelled by a manager at end of day:
  - Not started: the reservation is released.
  - Already started: the existing manager-PIN cancellation applies, and the issued cost becomes waste.
- In demo mode a cancelled order with a simulated tender also gets a simulated refund through the existing refund path.

---

## 6. Website design

### 6.1 Brand and palette
The palette starts from the supplied logo (charcoal, cream, brick red, flame orange) and adds three international accent colors for the country sections. Contrast is checked in W1.

| Token | Hex (draft) | Use |
|---|---|---|
| Charcoal | `#1C1A19` | Navigation bar (muted, like the logo's field), footer, body text |
| Cream | `#F1E5C6` | Section backgrounds, text on charcoal |
| Brick red | `#96301C` | Primary buttons, links, the logo ring |
| Flame | `#D4502E` | Highlights and large decorative accents only (not body text) |
| Saffron | `#E8A317` | Country accent; charcoal text on top |
| Jade | `#0B7A5A` | Country accent; "Available" badge, with text |
| Ultramarine | `#1F4E9C` | Country accent; focus ring |

Type: a sturdy serif for headings, matching the logo's "MEATS" lettering, and a clean sans-serif for body text. Both are Google Fonts, chosen in W1.

### 6.2 Layout
- **Navigation bar (top):** charcoal, semi-transparent over the hero, solid after scrolling.
  - Contents: logo, **Home, Menu, Our Countries, Our Story, FAQ**.
  - **Cart icon** at top right, with a count badge, opening checkout.
  - Below 768 px, the links collapse into a menu button; the cart stays visible.
- **Sections:** full-width horizontal bands alternating image-left/text-right and the reverse, about half and half. On phones they stack, image first.
- **Accessibility:** 44 px touch targets, visible focus rings, status shown as text plus color, and alt text for every photo.

### 6.3 Pages (hash routes for GitHub Pages)

| Route | Content |
|---|---|
| `#/` Home | 1. **Hero, about 90% of the viewport:** full-bleed photos cross-fading every 5 s; logo and "Meats Around the World" small in the lower left with an "Order for pickup" button; a pause/play control (WCAG 2.2.2), and no rotation for reduced-motion users. 2. Our Story teaser. 3. Countries we cover (5 tiles). 4. Menu preview with live availability. 5. How pickup works. 6. Final call to action and footer (locations, hours 12–8, FAQ). |
| `#/menu` | Location picker, then **Dishes** and **Retail sauces**. Item detail panel: description, country, prep note ("order a day ahead"), allergen note and quantity (capped). |
| `#/countries` | One alternating section per country and its dish. |
| `#/story` | Story and mission sections. |
| `#/faq` | Accordion. |
| `#/checkout` | Cart lines, location, slot picker, contact details (name, phone, e-mail), note, totals with tax, **"Simulated payment"** (demo) or **"Pay at pickup"** (pilot), Place order. |
| `#/order/<token>` | Confirmation: order number, **pickup code**, time and location, lines, tax, total, payment label, live status, printable receipt. |

The cart is saved in the browser per location and labelled "Not ordered yet". Prices and availability are always re-checked on the server, and the server's totals are the only ones that count.

### 6.4 Images
No licensed food photos have been supplied yet. W1 uses clearly labelled placeholders, and the hero and item images are swapped through `web_menu_content` and `site/public/images/` when real photos arrive.

---

## 7. Security and testing

**Security**
- Anonymous sign-in with captcha.
- Rate limits and slot capacity enforced on the server.
- Input length and format checks.
- Contact details returned only through the order's own token.
- A strict Content-Security-Policy.
- The secrets scan extended to `site/dist`.

**Tests**

| Layer | Cases |
|---|---|
| pgTAP | Slot rule (lead days, closures, capacity, DST weekends 2026-11-01 and 2027-03-14), price/tax snapshot, idempotent placement, rate limits, the gate. |
| Integration, as a real anonymous user | Can place and view its own order; gets zero rows from every table and `unauthorized` from every staff RPC. A web and a POS order race for the last portion: exactly one wins and nothing is half-allocated. Sold out → receipt → orderable again. |
| Playwright | Browse; hero pause; add to cart; sold-out item blocked; checkout; confirmation; a staff kitchen session sees the order with its badge and start-by time. axe checks on every page and a 390 px phone-width pass. |

---

## 8. Milestones

| # | Milestone | Exit |
|---|---|---|
| **W0** | Decisions | **Done 2026-11-26:** this plan, ADR 0040, CLAUDE.md D12, logo, copy and allergen drafts. |
| W1 | Static site and design system | **Done 2026-11-26** (placeholder images, draft copy). `/site` app, palette, hero rotation, navigation, all content pages from the approved drafts, responsive and accessible. No ERP connection yet. Lint, typecheck, unit tests and axe pass. |
| W2 | ERP database | **Done 2026-11-26** (migration 0027, ADR 0042). §3 migrations, `accept_order_core` refactor (POS tests still green), `web_*` functions, pgTAP and the anonymous-access audit. |
| W3 | Live menu (demo) | Location picker, live availability and caps, 30 s refresh, cart. |
| W4 | Checkout to kitchen (demo) | Slots, placement, simulated tender, confirmation and status; ERP kitchen badge, Scheduled lane, Settings → Website. |
| W5 | Hardening and pilot | Rate limits, performance, full e2e and accessibility, Pages deployment of `/site`, runbook. The pilot opens with "Pay at pickup" once its gates are confirmed. |

---

## 9. Open items for the owner
1. Review and approve the [content drafts](content-drafts.md).
2. Review and approve the [allergen notes](allergen-notes-draft.md). Each note says "please ask staff" until it is approved.
3. ~~Confirm the draft `prep_minutes`~~ and ~~the noon kitchen start~~: confirmed 2026-11-26.
4. Decide whether to keep Supabase Auth sign-ups on for the hosted projects (needed for anonymous website visitors; ADR 0042).
5. Supply licensed food photos (hero rotation plus one per item), or approve the placeholders for the demo.
6. Real retail-sauce products and labels for the pilot. RET-001 and RET-002 are synthetic demo items.
