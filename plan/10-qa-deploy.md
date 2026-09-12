> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 10 — QA, performance, deploy

Steps:
1. Playwright smoke: (a) landing loads, assets reach 100 %, commute picker enables Start; (b) pick
   "Sunday morning", run at 32× with 5-min duration (via `?dur=5` test hook), reach report with non-zero
   trips; (c) share URL round-trip opens sim with the preset name shown; (d) expert panel patch marks preset
   as Custom. Run against `yarn build && yarn start`.
2. Perf budget: worker step ≤ 3 ms at 10k vehicles; frame ≤ 8 ms; initial JS ≤ 600 kB gz (deck.gl + maplibre
   dominate — code-split the map behind the loading screen). Record in `plan/notes-perf.md`.
3. Vercel: `vercel.json` not needed; set `Cache-Control: public, max-age=31536000, immutable` on
   `/data/corridor/*` and sprites via `next.config.ts` headers. Add custom domain `blr-traffic.sush.dev`
   (CNAME → `cname.vercel-dns.com`) and set `NEXT_PUBLIC_GA_MEASUREMENT_ID` + `NEXT_PUBLIC_SITE_URL` in
   Vercel env. Confirm the only external calls are OpenFreeMap tiles/fonts and GA (privacy note in README).
   Validate metadata with an OG/Twitter card checker and `curl -s https://blr-traffic.sush.dev | grep og:`;
   confirm `/sitemap.xml` and `/robots.txt` resolve.
4. README: what it is, model description (IDM/MOBIL/squeeze/filtering), data sources & licences (OSM ODbL,
   OpenFreeMap, BTP thresholds, TomTom index), how to add a preset, how to run scripts.
5. Licence: MIT for code; data attribution file.
