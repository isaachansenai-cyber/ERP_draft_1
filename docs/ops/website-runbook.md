# Public pickup website: pilot runbook

The website (`site/`, CLAUDE.md D12) takes pickup orders straight into the ERP. In the pilot, customers **pay at pickup**: staff record the real payment at the counter, exactly as for till orders. Nothing on the website takes or stores card details.

## 1. Before the first online order (owner)

Do these in the staff app, signed in as the owner. The website stays closed at a location until every step is done.

1. **The ERP itself is live** at that location: menu prices, tax rate, recipes and opening count confirmed, and posting enabled (`pilot-setup.md`).
2. **Settings → Website → Opening hours.** Enter each location's hours (owner decision 2026-11-26: 12:00–20:00 daily). Pickup times are offered only inside them, every 15 minutes, last slot 15 minutes before closing. Add holidays as closures, as for the rest of the ERP.
3. **Settings → Website → Cook times.** Confirm the minutes each dish needs on the pickup day (owner decision 2026-11-26: Strogonoff 25, Tacos al Pastor 15 after overnight marinade, Korean Fried Chicken 20, Bourguignon 15 after the day-before braise, Khorkhog 120). The kitchen starts at opening, so the earliest pickup is opening plus the slowest dish in the order.
4. **Settings → Website → Website text.** For every item to sell online, enter the country and description. Items without text are not shown online. Check each allergen note against the real product labels (`docs/website/allergen-notes-draft.md`), then tick "I have checked…" to publish it. Until then the site says "please ask staff".
5. **Settings → Website → Online ordering by location.** Switch on "Take online orders" and confirm the limits (owner decision: 4 orders per 15-minute slot, up to 7 days ahead, at most 10 of an item).
6. **Settings → Pilot setup → "Website ordering ready"** for that location. The ERP refuses to confirm it until settings, hours, website text and cook times exist.
7. **Publish the site** (operator action; `deployment.md`). Then open `…/site/`, choose the location and check that prices, "Available" and pickup times appear.

## 2. Every day

- **Kitchen.** Website orders show a **Web order** badge, the customer's pickup time and a **start by** time. Orders for a later day wait in **Scheduled for later days**; dishes flagged "Needs prep the day before" must be started (marinade, braise) the day before their pickup.
- **At the counter.** Match the pickup code (for example `SLC-0042`). In the pilot, record the payment, then complete the pickup as for any order.
- **Changes and cancellations** come by phone. Staff use the normal order screens; the customer's receipt page shows the new status within a minute.
- **At closing (managers).** The kitchen page lists website orders whose pickup time has passed. **Cancel uncollected website orders…** cancels them: unstarted orders release their stock, started or ready food is recorded as waste, and any order with a recorded real payment is left for you to handle at the counter.
- **Pause online orders** at any time with the location's switch in Settings → Website. The site then says ordering is paused and takes no orders. Orders already placed stay in the kitchen queue.

## 3. Privacy

- Customers' names, phone numbers and e-mails are stored only for their orders. Managers of that location and the owner can see them; employees see only the pickup name.
- Visitors never sign in. The site's key can only call the website functions, and every other ERP function and table refuses it (tested in `supabase/tests/001`, `009`).
- The site loads no third-party resources: fonts are bundled, and its Content-Security-Policy allows network calls to the ERP only.

## 4. Known limits (accepted for the pilot)

- **No captcha or sign-in.** Someone could place fake orders under made-up phone numbers and e-mails. Each phone number or e-mail can hold at most 3 open orders, and each 15-minute slot at most 4 web orders, which bounds the stock such orders can hold. Staff cancel them like no-shows. If this happens in practice, options are a captcha (needs a server function, which the project rules require the operator to approve) or a lower per-slot limit.
- **No e-mail receipts** (owner decision). The receipt page is the customer's record; it can be bookmarked or printed.
- **Photos are placeholders** and the site's text is a draft until the owner approves `docs/website/content-drafts.md`.

## 5. Measured performance

20 concurrent visitors against the local stack: reads p95 126 ms, order placement p95 165 ms, no unexpected errors, no slot over capacity (`docs/acceptance/evidence/perf-web.md`, `npm run perf:web`, demo databases only). A hosted project will be slower; repeat the measurement against the demo project before launch if wanted (operator direction needed).
