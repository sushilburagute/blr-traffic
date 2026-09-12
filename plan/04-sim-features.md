> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 04 — Sim features: signals, obstacles, rain, disruptions, demand/OD, infra options

**Goal:** All the configurable Bengaluru-specific phenomena, plugged into the engine hooks from chunk 03.

Files: `src/sim/signals.ts`, `obstacles.ts`, `environment.ts` (rain), `disruptions.ts`, `demand.ts`,
`infra.ts` (bus lane, flyovers, u-turns, encroachment, bus stops).

Steps:
1. **Signals**: `SignalPlan { cycleS, phases: {approaches: number[], greenS, amberS}[], offsetS }`.
   Per approach state each step. Vehicles treat a red/amber stop line as a virtual standing leader at
   `s = stopLine` unless they roll amber/red-run (per profile, once per approach). `brokenSignal` disruption
   → approach becomes "all-way contested": a gate that admits vehicles alternately from conflicting
   approaches with a random 2–6 s service time (models the traffic-cop-less mess). Signal state in Snapshot.
2. **Obstacles**: at init, place `potholes` and `speedBreakers` from `rng.fork('obstacles')` uniformly along
   main segments (not on flyovers), plus any `pinnedObstacles`. Pothole: one random lane, cap 5 km/h within
   ±8 m, and triggers a discretionary lane change with elevated incentive when within 60 m. Speed breaker:
   all lanes, cap 10 km/h within ±5 m. Vehicles that don't see it in time (reactionTime × v > distance) get a
   hard brake (flag bit0). Rain reduces pothole visibility (see 3).
3. **Rain** (live-toggleable via worker message): multipliers on speed, T, a, obstacle caps; potholes become
   "invisible" with 50 % probability per encounter (hard brake). `rainIntensity 2` also enables waterlogging
   spots from config or 2 random low points (blocks kerb lane for the run). Demand ×1.1 when rain (people
   who'd walk/2W switch to cabs — implement as mix shift: 2W −10 pts, cab +10 pts).
4. **Disruptions** (each has `startMin`, `durationMin`, `junctionId|segmentId`, `sOffset`, params):
   - `accident` / `breakdown`: block N lanes for a length of 20 m; rubbernecking: adjacent lanes cap 25 km/h
     within 100 m upstream.
   - `construction` (metro): reduce lanes by 1 on a segment section for the whole run; width reduced.
   - `waterlogging`: kerb lane blocked, all lanes cap 20 km/h over the section.
   - `illegalParking`: kerb lane blocked over 30–80 m at bus stops/junction approaches.
   - `brokenSignal`: see 1.
   - `event`: demand pulse — extra vehicles/h from a given source over a window.
   - `closure`/`diversion`: a segment closed; vehicles must exit at the previous junction (mandatory lane
     change to ramp). `routeChangeProb` per profile also lets vehicles bail to a sink early when the queue
     ahead > 500 m (they "take the service road").
5. **Demand/OD**: `demand.ts` builds per-minute arrival rates per source from `vehPerHour`, `profile` curve
   (morning: ramp 07:30→09:30 peak; evening: 17:30→20:00 peak; flat; custom 60-point curve), `throughShare`
   (fraction that traverses end-to-end) and optional OD matrix over the 8 sources/sinks. Vehicle type &
   behaviour drawn from `mix`/`behaviourMix`; `userCohort` share is forced to ≥ 8 % so stats are meaningful.
   Sources have a spawn queue — if the entry lane is blocked, vehicles wait and "unserved demand" is counted.
6. **Infra**: `busLane` reserves lane `lanes-1` (kerb) for buses; other vehicles enter it only with
   `busLaneViolationProb`. `flyovers[j]` toggles the bypass segment; when off, through-traffic uses the
   signalled approach. `uTurns[j]` adds a sink+source pair at the junction with a merge friction.
   `encroachment` reduces width on a section (feeds squeeze math). `busStops` = 20 s dwell for buses in the
   kerb lane at `s`.
7. Tests: signal phase timing; red light creates a queue that clears on green with ~2 s saturation headway;
   speed breaker causes a speed dip; accident halves segment throughput; demand profile integrates to
   vehPerHour; rain toggle lowers mean speed; bus lane stays bus-only for disciplined profile.

**Done when:** all hooks wired into `engine.ts`, tests pass, and a preset run (chunk 06 "Monday 9 AM")
produces plausible queues (250–750 m at Silk Board / Iblur / Marathahalli approaches at peak).
