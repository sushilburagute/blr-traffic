> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 05 — Stats, queue classification, cohorts, worker & protocol

**Goal:** Everything the UI and report need, delivered from a Web Worker at a steady cadence.

Files: `src/sim/stats.ts`, `src/sim/worker.ts`, `src/sim/protocol.ts`, `src/sim/snapshot.ts`.

Steps:
1. **Stats collection** (`stats.ts`), sampled every sim-second, finalised on despawn:
   - Per vehicle (kept in SoA until despawn): spawn time, entry/exit s, distance, time, stops (v<0.5 for >2 s),
     lane changes, filtering events, hard brakes, time in queue (v<5 km/h), red-light runs, virtual-lane time.
   - Per cohort (`Cohort` = type × profile): completed trips, mean/median/p90 travel time for end-to-end
     trips, mean speed, stops/trip, lane changes/trip, hard brakes/trip, queue time share, "near-miss"
     proxy = hard brakes caused by another vehicle's cut-in.
   - Corridor: throughput per direction, mean speed (km/h) time series at 1-min resolution, vehicles present,
     unserved demand, per-approach queue length time series.
   - **Queue length** per approach: from stop line upstream, the contiguous run of vehicles with v < 5 km/h
     and gap < 15 m; classify with Bengaluru Traffic Police thresholds:
     `<250 m Free · 250–500 Moderate · 500–750 High · >750 Severe`.
   - **Congestion level** (TomTom-style) = `(meanTravelTime / freeFlowTravelTime − 1)` corridor-wide, reported
     as % with a note comparing to TomTom's 2025 Bengaluru figure (74.4 %, 13.9 km/h rush-hour). Not a
     calibration target — surfaced as a sanity reference in the report.
   - **Hours lost / year** for the user's cohort: `(cohortTravelTime − freeFlow) × 2 trips × 250 days`.
2. `SimStats` type added to `types.ts` with the above (time series as `Float32Array` + `tStart/tStep`).
3. **Snapshot** (`snapshot.ts`): fill the `Snapshot` typed arrays from the SoA via `project()`; only vehicles on
   segments (not in spawn queues). Transfer buffers (`postMessage(msg, [buffers])`) and reuse a double buffer.
4. **Protocol** (`protocol.ts`) — discriminated unions:
   - UI→Worker: `init {network, config}`, `play`, `pause`, `setSpeed {multiplier}`, `setRain {on, intensity}`,
     `addDisruption {d}`, `skipToEnd`, `requestStats`, `dispose`.
   - Worker→UI: `ready`, `snapshot {Snapshot}` (~20 Hz real time regardless of multiplier), `stats {SimStats}`
     (every 5 s real time and on finish), `progress {simTime, pct}`, `finished {SimStats}`, `error {message}`.
5. `worker.ts`: owns one engine; a `setInterval`/`requestAnimationFrame`-free loop using `setTimeout(0)` +
   time budget: each tick run as many `step()`s as `multiplier × elapsedReal / dt` allows, capped at 16 ms
   of work per tick so message handling stays responsive; `skipToEnd` runs headless in 50 ms slices with
   progress messages.
6. `src/lib/simClient.ts`: typed wrapper around the Worker (`createSimClient()` → `{ init, play, …, on(event) }`),
   the only place the UI touches `postMessage`. Also `createHeadlessRun(config)` → Promise<SimStats> for the
   report's comparison runs (chunk 09).
7. Tests: queue classification thresholds; stats for a hand-built 3-vehicle scenario; protocol round-trip
   using a fake worker; snapshot buffer reuse doesn't leak.

**Done when:** `yarn test` passes; a small Node script (`scripts/bench.ts`) runs a 45-min "Monday 9 AM"
headless in < 15 s and prints cohort tables.
