> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 09 — End-of-simulation report & comparison

**Goal:** The payoff screen: what happened to *your* cohort, versus the alternatives, with charts and a
plain-English verdict.

Files: `src/app/report/page.tsx`, `src/components/report/*`, `src/lib/verdict.ts`, `src/lib/compare.ts`.

Steps:
1. On `finished`, store `SimStats` in `simStore` and navigate to `/report` (also reachable via "Finish now").
2. **Hero**: "You commuted as a **Car · Lane follower** on **Monday 9 AM**" → avg trip time end-to-end,
   avg speed, stops, lane changes, hard brakes, time in queue, versus corridor average; a big BTP-style
   congestion badge for the run and the TomTom sanity line ("City average rush-hour speed 13.9 km/h;
   your corridor run: X km/h").
3. **Comparison runs** (`compare.ts`): using `createHeadlessRun` (chunk 05) run the *same config+seed* with
   `userCohort` swapped to the 2–3 most relevant alternatives (same type/other behaviours; same behaviour/other
   types) — since cohort share is forced ≥ 8 % these cohorts already exist in the main run, so first show the
   main run's cohort table instantly, then optionally "Deep compare" runs an alternative *scenario*
   (e.g. same run with squeeze off / rain off / 100 % disciplined) in a headless worker with a progress bar.
4. **Charts** (Recharts): cohort bar chart (travel time, speed), corridor speed time series with rain/
   disruption markers, queue length per approach over time with BTP bands, distribution (histogram) of
   travel times for user's cohort vs others, throughput per direction.
5. **Verdict** (`verdict.ts`): rule-based sentences, e.g. "Cutting across saved 2W riders 3.4 min but cost
   them 4× more hard brakes", "Lane discipline at 100 % would have raised corridor speed by 18 %",
   "Squeezing 3 lanes into 4 added 9 % throughput at low density but −14 % at peak". Each rule states the
   metric and the delta; only fires when the delta is significant (> 5 %).
6. **Hours lost / year** tile with the extrapolation formula shown.
7. Actions: "Run again", "Change my commute", "Try preset X", "Share this result" (share code + query
   `?result=1` re-runs on open since results aren't stored server-side), "Download JSON" (stats + config).

**Done when:** every stat in the hero has a chart or table backing it; verdicts are correct for the Utopia vs
Free-for-all presets; the page works with a reloaded browser (re-runs from stored config if stats missing).
