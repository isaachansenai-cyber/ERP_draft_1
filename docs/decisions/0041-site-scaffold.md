# 0041 Public website scaffold (W1)

Operator request (session, 2026-11-26): start W1 with placeholder images. Choices not covered by ADR 0040:

- **One package, two apps.** `site/` has its own Vite config, Tailwind config, tsconfig (`tsconfig.site.json`) and build output (`site/dist`), but shares the root `package.json`, lockfile, ESLint and Prettier. There is no second dependency tree to keep in sync. Scripts: `site:dev`, `site:build`, `site:preview`, `test:site:e2e`.
- **Placeholder images are drawn, not downloaded.** Until licensed photos arrive, `PlaceholderArt` renders an inline SVG in the country's colors, labelled "Placeholder photo" on screen and "Placeholder for a photo of …" for screen readers. No stock photos with unclear licenses are used.
- **Palette in code, checked by a test.** `site/src/theme/palette.ts` feeds Tailwind, and `tests/unit/site-content.test.ts` asserts WCAG AA contrast for every text pair. Flame (`#D4502E`) is 4.1:1 on charcoal, so it is used only for large text and decoration.
- **Content in typed modules** (`site/src/content/`), copied from the owner-review drafts. A test ties every dish to its ERP item ID and checks each "order a day ahead" flag against `prep_lead_days`. The footer shows a preview notice while `CONTENT_STATUS = 'draft'`.
- **Honest pre-ordering state.** While `ORDERING_OPEN = false` (until W3), the Menu and Cart pages say online ordering opens soon and show no prices, availability or cart totals. Those only ever come from the ERP.
- **Web fonts** (Playfair Display, Source Sans 3) loaded from Google Fonts in W1. *(Superseded by ADR 0045: bundled with the site since W5.)*
- **Hash routing** as in the ERP. The skip link is a button that focuses `<main>`, because an in-page `#main` link would change the route.
