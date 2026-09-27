# Performance notes

Measured 2026-09-12 on Windows, Node v24.6.0 and Next 15.5.25, using the checked-in OSM network
(10 main carriageways, 10 ramps, 9 modelled bypasses). These are local development-machine results,
not guarantees for other devices. CI pins Node 22; its timing has not been measured.

## CPU measurements

Run `yarn tsx scripts/perf.ts`: 10,000 stationary two-wheelers across the main carriageways,
300 steps with 50 warm-ups, then 100 snapshot/layer constructions with 10 warm-ups. Final vehicle
count is 9,884. This artificial dense workload supplements normal demand runs.

| Measurement                      | Latest result |
| -------------------------------- | ------------: |
| Mean simulation step             |       2.02 ms |
| p99 simulation step              |       6.29 ms |
| Mean snapshot construction       |       0.99 ms |
| Mean layer construction, zoom 16 |       0.37 ms |

The mean step meets the 3 ms target; p99 does not. Layer construction excludes GPU uploads, drawing,
MapLibre, and compositing. The **8 ms frame target and sustained 60 fps at 10,000 vehicles remain
unverified on a hardware GPU**. Raw results are written to ignored `artifacts/perf.json`.

`yarn bench` runs the full 45-minute Monday preset, now at the calibrated 13,000 veh/h and 50 km/h (see
Calibration in `implementation-notes.md`). On 2026-09-27, measured back to back on the same (heavily loaded)
machine, the pre-calibration defaults took 40.7–43.0 s (3,956 completed trips, 5,038 active, 80 waiting to
enter) and the calibrated defaults 40.4–44.7 s (3,842 completed, 5,734 active, 128 waiting): about the same,
at most a few percent slower. Earlier the same day, on a lighter load, the pre-calibration run took 18.2 s;
v0.1 took 14–32 s depending on load; no reliable faster bound is claimed.

Peak queues in the 45-minute bench: Silk Board 350 m, Agara 765 m, Iblur 273 m, Bellandur 222 m,
Kadubeesanahalli 822 m, Marathahalli 102 m (was 352, 672, 420, 266, 685 and 80 m).

Uncensored trip times (`yarn trips`: every vehicle generated in the 45-minute window, run on until it
finishes): Silk Board → Marathahalli median 31.7 min (mean 34.8, p90 56.2); Marathahalli → Silk Board median
42.7 min (mean 46.8, p90 79.0); free flow 13.2 min; side-road entry wait median 0.1 min. Before calibration
they were 18.5 (mean 23.1, p90 39.2) and 41.3 (mean 43.6, p90 74.6) with free flow 11.0 min. The in-app
report averages only trips completed inside the run, which biases it low. Signal timings remain assumptions;
demand and free speed are tuned to inferred, not measured, trip times.

A CPU profile attributes most work to the vehicle step, constraints, lane changes, and neighbour
searches. Reproduce with `node --cpu-prof --cpu-prof-dir=artifacts --import tsx scripts/bench.ts`,
then `yarn tsx scripts/read-profile.ts` (or pass a profile filename).

## Client and rendering

Next's production build reports approximately **145 kB** first-load JS for `/` and **170 kB** for
`/sim`, below the 600 kB initial-JS budget. MapLibre/deck.gl and charts are dynamically loaded;
their deferred chunks are additional downloads. These figures are build output, not a measurement
of all chunks or total network transfer.

Rendering uses binary typed-array attributes, recycled transferable snapshots, and reusable Float64
position buffers (Float32 lon/lat quantises to ~0.8 m, visible as jitter up close). `VehicleFrame`
matches vehicles by uid and interpolates each one from where it was drawn to its latest snapshot
pose over one measured snapshot interval, so rendering trails the simulation by ~50 ms. Colour,
size and icon attributes keep their identity between snapshots; only positions and angles are
re-uploaded per frame, and nothing is re-submitted once every vehicle has settled. Road, lane,
label and obstacle geometry is built once per network/config (layer instances are recreated per
update, because deck.gl cannot re-add a finalized layer). The overlay is non-interleaved. Bypasses
share the final 700 m of the associated OSM carriageway; their deck is drawn above ground vehicles.

`yarn tsx scripts/perf.ts` on 2026-09-27 (10k synthetic vehicles, loaded machine): step 3.36 ms mean,
snapshot 1.54 ms, per-snapshot layer + frame preparation 1.80 ms, per-animation-frame vehicle
interpolation and layer construction 0.40 ms. `yarn bench` took 18.5 s.

Worker pacing yields after a 12 ms playback work budget or 40 ms while skipping; an individual step
may overrun that budget. Snapshots are capped at 20 Hz and stats at every 5 seconds, plus immediate
reports for live edits. CPU results alone do not prove sustained 32x playback on every device.

Development and production use separate `.next-dev` and `.next-production` directories to prevent
dev artifacts contaminating production checks. Data and sprites use a one-day cache plus a week of
stale-while-revalidate, since their URLs are not content-hashed.

## Verification

Lint, strict typechecking, 39 unit/integration tests, and production build pass. Seven Chromium
production browser tests cover loading, reports, sharing, expert edits, malformed links, mobile
width, exact early live-weather replay, and map/keyboard controls. Rebuilding corridor data preserves
SHA-256 hashes of both generated files and both public copies.

Vercel deployment, DNS, GA DebugView, external social-card validation, and hardware-GPU performance
remain unverified. See `implementation-notes.md` for model choices and contract extensions.
