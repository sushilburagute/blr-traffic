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

`yarn bench` runs the full 45-minute Monday preset at 12,000 veh/h. The latest unprofiled run of the
final implementation took **32.40 seconds**, with 3,355 completed trips, 4,315 active vehicles, and
1,404 waiting to enter. It does **not** meet the plan's 15-second target. Earlier runs varied from
15.7 to 32.4 seconds with machine load; no reliable faster bound is claimed.

Peak queues: Silk Board 349 m, Agara 672 m, Iblur 144 m, Bellandur 166 m, Kadubeesanahalli 757 m,
Marathahalli 63 m. These do not reproduce the plan's proposed congestion at every named junction.
Signal timings and demand remain assumptions requiring observational calibration.

A CPU profile attributes most work to the vehicle step, constraints, lane changes, and neighbour
searches. Reproduce with `node --cpu-prof --cpu-prof-dir=artifacts --import tsx scripts/bench.ts`,
then `yarn tsx scripts/read-profile.ts` (or pass a profile filename).

## Client and rendering

Next's production build reports approximately **145 kB** first-load JS for `/` and **170 kB** for
`/sim`, below the 600 kB initial-JS budget. MapLibre/deck.gl and charts are dynamically loaded;
their deferred chunks are additional downloads. These figures are build output, not a measurement
of all chunks or total network transfer.

Rendering uses binary typed-array attributes, recycled transferable snapshots, and reusable position
buffers. Positions extrapolate for at most 50 ms of wall time between snapshots. Layers are cloned
to update position attributes; zero allocations per frame is not claimed. Static layers rebuild when
snapshots, configuration, or display options change. The overlay is non-interleaved. Bypasses share
the final 700 m of the associated OSM carriageway without separate elevation geometry.

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
