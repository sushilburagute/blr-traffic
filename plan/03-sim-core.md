> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 03 — Sim core: network, vehicles, IDM, MOBIL, lane discipline, squeeze, filtering

**Goal:** A deterministic engine that moves vehicles along the corridor with realistic car-following and
lane-changing, with the *lane-discipline vs cutting* and *3→4 squeeze* phenomena as first-class features.
No signals/obstacles yet (stubs return "free").

Files: `src/sim/rng.ts`, `src/sim/vehicles.ts` (SoA store, spawn/despawn, per-lane sorted index),
`src/sim/models/idm.ts`, `models/mobil.ts`, `models/squeeze.ts`, `models/filtering.ts`,
`src/sim/params.ts` (default `VehicleTypeParams` and `BehaviourParams` tables), `src/sim/engine.ts` (step loop).

Defaults (tune, but start here):

| Type | length | width | vMax km/h | a | b | T | s0 | filter | virtual lane |
|---|---|---|---|---|---|---|---|---|---|
| twoWheeler | 2.0 | 0.8 | 60 | 2.5 | 3.0 | 0.8 | 1.0 | yes | yes |
| auto | 2.6 | 1.4 | 45 | 1.2 | 2.5 | 1.2 | 1.5 | no | yes |
| car | 4.3 | 1.8 | 70 | 1.5 | 2.5 | 1.2 | 2.0 | no | yes |
| cab | 4.3 | 1.8 | 70 | 1.8 | 3.0 | 1.0 | 1.5 | no | yes |
| bus | 11.5 | 2.6 | 50 | 0.8 | 2.0 | 1.6 | 3.0 | no | no |
| truck | 9.0 | 2.5 | 45 | 0.6 | 2.0 | 1.8 | 3.0 | no | no |

| Profile | politeness | bSafe | aThr | lcCooldown s | gapFactor | filterProb | amberRun | redRun | reaction s |
|---|---|---|---|---|---|---|---|---|---|
| disciplined | 0.5 | 2.0 | 0.3 | 8 | 1.0 | 0.1 | 0.1 | 0.0 | 1.0 |
| opportunist | 0.2 | 3.0 | 0.15 | 3 | 0.7 | 0.6 | 0.5 | 0.05 | 0.8 |
| aggressive | 0.0 | 4.0 | 0.05 | 1 | 0.45 | 0.9 | 0.9 | 0.2 | 0.6 |

Steps:
1. `rng.ts`: mulberry32 with `next()`, `range(a,b)`, `pick(weights)`, `poisson(lambda)`, `fork(label)` for
   independent streams (spawn vs behaviour vs obstacles) so toggling one doesn't reshuffle the others.
2. `vehicles.ts`: capacity 16k; free-list; fields per contract; `laneIndex[segment][lane]` = Int32Array of
   vehicle ids sorted by `s`; `leader(id)`/`follower(id)` in own and adjacent lanes; `rebuildIndex()` with
   insertion sort. Segment transitions: when `s > length`, move to `nextSegment` preserving lane (clamp).
3. `idm.ts`: standard IDM acceleration `a(s, v, Δv)` with per-vehicle reaction time implemented as a
   delayed-perception buffer (store leader gap sampled `reactionTime` ago, ring buffer of 1 s @ 0.1 s).
   Speed limit = min(vMax, segment limit, obstacle cap, rain factor).
4. `mobil.ts`: incentive criterion with politeness, safety criterion with `bSafe`, `gapFactor` scales the
   accepted gap. Mandatory lane changes for route (ramp exit, flyover choice) override incentive with a
   pressure that increases as the decision point nears. Cooldown per vehicle.
5. `squeeze.ts`: per segment per step compute density (veh/km summed over lanes). If `config.squeeze.enabled`
   and density > threshold and share of non-disciplined vehicles > 0.3: `effectiveLanes = lanes + 1`,
   `laneWidth = W/(lanes+1)`, all lanes get `speedFactor = 0.85`, the virtual lane has the configured cap and
   only vehicles with `canUseVirtualLane` and profile ≠ disciplined may enter. When density falls below
   0.7 × threshold the virtual lane closes: vehicles in it get a mandatory change with high pressure.
6. `filtering.ts`: 2W with `canFilter`, leader gap < 3 m and leader v < 2 m/s, roll `filterProb`: enter
   filter state (flag bit1), advance at min(15 km/h, gap-limited) along lane boundary until queue head or
   stop line, then reinsert into whichever adjacent lane has the largest gap. Counts as a lane change ×2 for
   stats; adds a small friction penalty to the two neighbouring lanes' leaders (they brake by 0.3 m/s²).
7. `engine.ts`: `createEngine(network, config)`, `step()` (dt 0.1 s), `run(nSteps)`, hooks for signals/
   obstacles/demand/stats (chunks 04/05) as injectable modules with no-op defaults. Spawn at sources with
   Poisson arrivals at a constant rate for now (chunk 04 replaces with demand profiles).
8. Tests (`tests/sim/*.test.ts`): IDM approaches equilibrium gap; platoon stays stable; MOBIL aggressive
   changes lanes more than disciplined on same seed; squeeze opens/closes at thresholds; filtering 2W reaches
   stop line before cars; determinism: two engines with same seed produce identical arrays after 5k steps;
   throughput sanity: a 3-lane segment saturates at ~1800–2200 veh/h/lane equivalent (PCU).

**Done when:** tests pass and a headless 30-min run of 6000 veh/h completes in < 10 s in Node.
