# BLR Traffic Sim

A browser-based traffic simulator for Bengaluru's Outer Ring Road between **Central Silk Board and
Marathahalli** (Silk Board → Agara → Iblur → Bellandur → Kadubeesanahalli → Marathahalli, ~11 km each way).

Pick how you commute (vehicle type × driving style), choose a scenario, watch the corridor on a real map,
and get an end-of-run report that compares your cohort against every other one — _two-wheeler lane-cutter
vs. car lane-follower_, with and without rain, and so on.

Deployment target: **https://blr-traffic.sush.dev**. Deployment and DNS still require verification.

Everything runs in the browser. The simulation lives in a Web Worker; there is no backend and nothing is
stored server-side. Share links carry the whole scenario (config + seed) in the URL.

## Running it

Requires Node ≥ 20.19 and Yarn 1 (`.nvmrc` pins Node 22).

```sh
yarn                # install
yarn dev            # http://localhost:3000
yarn build && yarn start
```

| Script            | What it does                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `yarn lint`       | ESLint (`src/sim/**` is forbidden from importing React, Next, deck.gl, MapLibre)                              |
| `yarn typecheck`  | `tsc --noEmit`                                                                                                |
| `yarn test`       | Vitest unit tests for the simulation core (`tests/`)                                                          |
| `yarn test:e2e`   | Playwright smoke tests against `yarn start` (run `yarn build` first)                                          |
| `yarn bench`      | Headless 45-minute run of a preset, prints cohort and junction-queue tables: `yarn bench --preset monday-9am` |
| `yarn data:fetch` | Downloads the raw OSM extract for the corridor from Overpass                                                  |
| `yarn data:build` | Builds `network.json` / `corridor.geojson` from the raw extract                                               |

Environment (see `.env.example`):

- `NEXT_PUBLIC_GA_MEASUREMENT_ID` — Google Analytics 4 id. Unset ⇒ no analytics script is loaded at all.
- `NEXT_PUBLIC_SITE_URL` — canonical origin used for metadata (defaults to the production domain).

## How the model works

The corridor is a small directed network: ten main carriageway segments (five per direction), a short
on-ramp at every junction, and flyover/underpass bypass segments where OSM shows grade separation.
Vehicles move in one dimension along a segment (`segment, lane, s, v`); geometry is only used for rendering.

- **Car-following — IDM** (Intelligent Driver Model) with per-vehicle-type parameters (length, desired
  speed, acceleration, comfortable braking, headway, minimum gap).
- **Lane changing — MOBIL** (politeness, safe-braking limit, advantage threshold), with a lane-change
  cooldown and gap acceptance that depend on the driver's behaviour profile: _disciplined_, _opportunist_,
  _aggressive_.
- **Squeeze.** When density passes a threshold, a virtual extra lane opens for small vehicles at a capped
  speed and every lane pays a side-friction penalty. Buses and trucks never use it.
- **Two-wheeler filtering.** A two-wheeler behind a queue may slip into a filter lane at ≤ 15 km/h and
  re-enter at the head of the queue or the stop line.
- **Signals.** Fixed-time four-phase plans per junction. Amber/red running is a per-profile probability.
  Silk Board and Marathahalli use longer assumed cycles with a smaller ORR green share.
- **Grade separation.** Through traffic climbs onto a flyover (or drops into an underpass) ~700 m before a
  junction and skips the signal; if the ramp is blocked it stays at grade and queues with everyone else.
- **Obstacles, rain, disruptions.** Potholes and speed breakers cap speed locally; rain scales speed,
  headway, acceleration and obstacle caps and can be toggled mid-run; disruptions (accident, breakdown,
  construction, waterlogging, illegal parking, broken signal, event surge, closure) block lanes or reshape
  demand for a window of time.
- **Determinism.** Fixed 0.1 s step, seeded PRNG (mulberry32) for every random decision, no wall clock in
  the simulation engine. The worker uses wall time only to schedule work. The same config + seed reproduces the same run exactly, which is what makes the A/B
  comparisons in the report meaningful.

Vehicle state lives in structure-of-arrays typed arrays; per-lane sorted indices are rebuilt incrementally
each step. See `plan/notes-perf.md` for measured costs.

## Data sources & licences

| Source                                                                     | Used for                                                                                   | Licence                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [OpenStreetMap](https://www.openstreetmap.org) via the Overpass API        | Corridor geometry, junction positions, bridge/tunnel tags (`src/data/corridor/`)           | © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) |
| [OpenFreeMap](https://openfreemap.org)                                     | Vector basemap tiles and glyphs (`tiles.openfreemap.org`), the only runtime map dependency | Tiles free to use; data © OpenStreetMap contributors                                 |
| TomTom Traffic Index                                                       | The citywide congestion figures quoted in the guide, for context only                      | Cited, not redistributed                                                             |
| Queue bands (Free < 250 m, Moderate < 500 m, High ≤ 750 m, Severe > 750 m) | Junction queue classification                                                              | Model categories; see the guide                                                      |

Signal timings, lane counts, flyover lengths, demand and driver parameters are modelling assumptions,
not measurements. The guide inside the app (`/guide`) spells out the limits. See `ATTRIBUTION.md` for the
full data attribution.

**Privacy.** The only external requests the app makes are to OpenFreeMap (tiles, glyphs, style) and — only
when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set — Google Analytics. Scenarios and results never leave the
browser except when you share or export them; share URLs necessarily contain the encoded scenario and reach the hosting provider when opened. Optional GA records preset and cohort event labels. Local saves use localStorage.

## Regenerating the corridor data

```sh
yarn data:fetch   # Overpass → src/data/corridor/raw-overpass.json
yarn data:build   # → src/data/corridor/{network.json,corridor.geojson,README.md} and public/data/corridor/
```

`scripts/build-network.ts` routes each carriageway along ORR-tagged ways between six junction anchors,
detects grade separation from `bridge=yes` / `tunnel=yes` ORR ways near each anchor, and slices the last
700 m of each link into a two-lane bypass segment. If the raw extract is missing it falls back to a
clearly-labelled hand-traced alignment. Review `src/data/corridor/README.md` after a rebuild.

## Adding a preset

Presets are plain objects in `src/lib/presets.ts`: an id, a name, a tagline, a `lucide-react` icon name,
a couple of tags, and a `DeepPartial<ScenarioConfig>` that is merged over the schema defaults
(`src/lib/schema.ts`). Anything the expert panel can set can go in a preset — demand curve and mix,
behaviour mix, infrastructure toggles, signal plans, disruptions, weather. Run `yarn bench --preset <id>`
to sanity-check it headlessly and `yarn test` to make sure the schema still accepts it.

## Project layout

```
src/app          routes: / (landing + commute picker), /sim, /report, /guide, /s/[code], metadata routes
src/sim          pure TypeScript simulation — no DOM, no React; runs in a Worker; unit-tested
src/lib          schema (zod), presets, share codes, units, colours, analytics
src/store        zustand stores (scenario, sim, ui)
src/components   map (MapLibre + deck.gl), panels, report, loading, ui
src/data         committed corridor data
scripts          data pipeline, sprite build, headless bench
tests / e2e      Vitest and Playwright
plan             the implementation plan this was built from
```

## Licence

Code is released under the [MIT Licence](LICENSE). Map data is © OpenStreetMap contributors (ODbL); see
[ATTRIBUTION.md](ATTRIBUTION.md).

Built by [sush.dev](https://sush.dev).

## Verification and deployment

`yarn build` then `yarn test:e2e` checks the production server, including scenario sharing, early reports,
live-weather replay, report reload, map sizing, keyboard help, and mobile layout. `.github/workflows/ci.yml`
runs lint, typechecking, unit tests, the production build, and Chromium smoke tests on pushes and PRs.
`yarn tsx scripts/perf.ts` measures a synthetic 10,000-vehicle workload and CPU layer construction;
it does not claim to measure GPU frame time. See [performance notes](plan/notes-perf.md).

Import this repository into Vercel as a Next.js project. Use Yarn and Node 22, and add
`blr-traffic.sush.dev` under Project → Settings → Domains. Follow the DNS target Vercel supplies.
Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` in Project → Settings → Environment Variables if analytics is wanted,
then redeploy; leaving it empty loads no GA scripts. Site metadata uses the planned canonical domain.
Verify `/robots.txt`, `/sitemap.xml`, `/opengraph-image`, and a shared scenario after deployment.

Live rain and incident changes are recorded as fixed-tick `liveEvents` in shared configurations.
Reports finished early preserve their endpoint using `until` in result links; replay and deep comparisons
stop at the same simulation time. Expert JSON editors expose less common fields alongside the sliders.

This is an educational simulator. It is not calibrated to measured ORR demand, signal plans, or trip times.
The current default rush-hour demand is 12,000 vehicles/hour, replacing the plan's initial 7,000 starting point.
U-turns add a return trip for an assumed 5% of eligible exiting vehicles plus local merge friction;
turning trajectories and route-choice calibration remain modelling assumptions.
See [implementation notes](plan/implementation-notes.md) for plan deviations and verification status.
