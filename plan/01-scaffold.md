> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 01 — Project scaffold

**Goal:** A running Next.js app with the full toolchain, empty shell pages, and CI-able scripts.

Steps:
1. `yarn create next-app blr-traffic` equivalent in-place (TS, App Router, Tailwind, ESLint, `src/`, `@/` alias).
   Because the dir is non-empty (`.git`), scaffold into a temp dir and move files, or use `--yes` flags.
2. Add deps: `maplibre-gl @deck.gl/core @deck.gl/layers @deck.gl/mapbox zustand recharts zod lz-string`.
   Dev: `vitest @vitest/coverage-v8 jsdom @playwright/test prettier eslint-plugin-* tsx`.
3. `npx shadcn@latest init` (Tailwind v4, neutral theme, dark mode default) and add: button, card, dialog,
   select, slider, switch, tabs, tooltip, progress, badge, separator, sheet, form, input, label, accordion.
4. `vitest.config.ts` (node env for `src/sim`, jsdom for components), `playwright.config.ts` (chromium only,
   baseURL localhost:3000, `webServer` runs `yarn dev`).
5. ESLint rule: `no-restricted-imports` for `react|next|@deck.gl|maplibre-gl` inside `src/sim/**`.
6. Shell routes: `src/app/page.tsx` (landing), `src/app/sim/page.tsx`, `src/app/report/page.tsx`,
   `src/app/s/[code]/page.tsx` — each renders a placeholder heading. `layout.tsx` with dark theme, font, and a
   top nav (`components/ui/AppShell.tsx`).
7. `next.config.ts`: `webpack`/turbopack config not needed for workers — use `new Worker(new URL('../sim/worker.ts', import.meta.url))`
   which Next 15 supports natively. Add `transpilePackages` only if deck.gl complains.
8. `.gitignore`, `README.md` (stack, scripts, how to run), `.nvmrc` (Node 20 LTS), `.prettierrc`.
9. **Site metadata** (`src/app/layout.tsx` via the Next Metadata API, constants in `src/lib/site.ts`):
   `metadataBase: new URL('https://blr-traffic.sush.dev')`, title template `%s · BLR Traffic Sim`,
   description, keywords, `alternates.canonical`, `openGraph` (type website, locale en_IN, siteName, image
   `/og.png` 1200×630 — generate with `src/app/opengraph-image.tsx`), `twitter` (summary_large_image),
   `robots` (index, follow), `authors: [{ name: 'sush.dev', url: 'https://sush.dev' }]`, `creator`,
   `themeColor`, icons (`/icon.svg`, `/apple-icon.png`), `manifest`. Add `src/app/sitemap.ts` (/, /sim,
   /guide) and `src/app/robots.ts`. Add JSON-LD `WebApplication` schema in the layout. `/s/[code]` pages get
   `generateMetadata` with the preset/scenario name in the title so shared links unfurl nicely.
10. **Google Analytics 4**: `yarn add @next/third-parties`; in `layout.tsx` render
    `<GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />` only when the env var is set
    (so local dev sends nothing). Files: `.env.example` (`NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX`,
    `NEXT_PUBLIC_SITE_URL=https://blr-traffic.sush.dev`), `.env.local` git-ignored, `src/lib/env.ts` (zod-
    validated `process.env` access), `src/lib/analytics.ts` with a typed `track(event, params)` wrapper
    around `sendGAEvent` — events: `sim_start {preset, cohort}`, `sim_finish {preset, cohort, durationMin}`,
    `preset_selected`, `expert_mode_toggled`, `rain_toggled`, `share_copied`, `report_viewed`,
    `guide_opened`. README documents where to set the ID on Vercel (Project → Settings → Environment Variables).
11. **AppShell footer** (`components/ui/AppShell.tsx`): "Built by [sush.dev](https://sush.dev)" · "Data ©
    OpenStreetMap contributors · Tiles OpenFreeMap" · links to Guide, GitHub repo, and a version string from
    `package.json`. Footer is a slim bar on `/`, `/report`, `/guide`; on `/sim` it collapses into the HUD's
    corner badge so the map stays full-bleed.
12. Commit `chore: scaffold`.

**Done when:** `yarn dev` shows the shell; `yarn lint && yarn typecheck && yarn test && yarn build` all pass.
