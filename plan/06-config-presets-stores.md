> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 06 — Scenario config: schema, presets, expert mode model, sharing, stores

**Goal:** One validated source of truth for scenario configuration, a preset library, URL sharing, local
saves, and Zustand stores the UI binds to.

Files: `src/lib/schema.ts` (zod for `ScenarioConfig` with defaults), `src/lib/presets.ts`,
`src/lib/share.ts`, `src/store/scenarioStore.ts`, `src/store/simStore.ts`, `src/store/uiStore.ts`.

Steps:
1. `schema.ts`: `scenarioConfigSchema` with `.default()` on every field so `parse({})` yields a valid
   baseline; `mergeConfig(base, patch)`; `migrate(v)` stub for future versions.
2. `presets.ts` — each `{ id, name, tagline, icon, config: DeepPartial<ScenarioConfig>, tags }`:
   - **Monday 9 AM** — morning profile, 7000 veh/h, mix 2W 40/car 25/cab 12/auto 10/bus 8/truck 5 (percent-ish),
     behaviour disciplined 25/opportunist 50/aggressive 25, squeeze on, 6 potholes, 3 breakers.
   - **Friday evening rain** — evening profile, rain intensity 2, waterlogging at Iblur & Bellandur.
   - **Silk Board pile-up** — Monday + accident at Silk Board approach blocking 2 lanes from min 10 for 25 min.
   - **Metro construction** — construction on Agara→Iblur and Bellandur→Kadubeesanahalli (lanes −1), flyovers on.
   - **Signal down at Marathahalli** — brokenSignal at Marathahalli from min 5.
   - **Office exit pulse** — flat demand + event pulses at Bellandur & Kadubeesanahalli 18:00–18:30.
   - **Sunday morning** — 2000 veh/h flat, no disruptions.
   - **Utopia** — Monday demand but 100 % disciplined, squeeze off, no potholes, bus lane on.
   - **Free-for-all** — Monday demand, 100 % aggressive, squeeze on, 12 potholes.
3. `share.ts`: `encode(config) → string` = lz-string `compressToEncodedURIComponent(JSON of diff-vs-default)`;
   `decode(code)`; guard length (< 2 kB) and validate with schema. Route `/s/[code]` (chunk 08) decodes and
   opens the sim with that config.
4. `scenarioStore`: `{ config, presetId|null, setPreset, patch(path, value), reset, userCohort }` — patches
   mark `presetId = 'custom'`. Persist the last config + saved scenarios (`savedScenarios: {name, code}[]`)
   to `localStorage` via zustand `persist` (skip SSR).
5. `simStore`: `{ status: 'idle'|'loading'|'ready'|'running'|'paused'|'finished', speed, simTime, progress,
   latestSnapshot (ref, not reactive), latestStats, rain, cameraTarget: JunctionId|null }`. Snapshot goes into
   a mutable ref + a `version` counter to avoid re-rendering React per frame.
6. `uiStore`: `{ mode: 'presets'|'expert', panelOpen, selectedJunction, legendVisible, chartsVisible }`.
7. Tests: schema defaults produce a valid config; every preset parses; encode/decode round-trip; diff-vs-default
   keeps codes short (< 600 chars for all presets).
