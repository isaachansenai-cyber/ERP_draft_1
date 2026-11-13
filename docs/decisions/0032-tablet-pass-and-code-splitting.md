# 0032 Automated tablet pass and route-level code splitting (AC32)

- The tablet, keyboard and scanner pass is automated with Playwright and axe-core 4.14.0 (dev dependency only). It fails on any serious or critical WCAG 2.1 A/AA finding on every manager and employee screen, on any control under 44 × 44 px, on sideways scrolling at 820 px portrait, and on a POS flow that cannot be completed with the keyboard and keyboard-wedge input alone.
- Moderate and minor axe findings are not gating. Colour contrast is checked by axe as part of the AA rules.
- Physical devices (the actual tablets and barcode scanners) cannot be tested from the build machine. They are a go-live checklist step at each location.
- Screens are now loaded per route with `React.lazy` behind a Suspense fallback. Login and the overview stay in the main bundle, which drops from 743 kB to 463 kB (135 kB gzipped). A slow chunk load shows "Loading screen…", and a failed one falls into the existing error boundary.
