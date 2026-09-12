# Plan index

Master plan for the Bengaluru ORR traffic simulator, split into chunks that can each be handed to a subagent.
Every agent reads `00-overview.md` first (shared types, conventions, dependency graph), then its own chunk.

| File                                                       | Chunk                                                           | Depends on |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ---------- |
| [00-overview.md](00-overview.md)                           | Context, architecture, shared contracts, verification           | —          |
| [01-scaffold.md](01-scaffold.md)                           | Next.js scaffold, toolchain, metadata, GA4, footer              | —          |
| [02-corridor-data.md](02-corridor-data.md)                 | OSM fetch → network.json / corridor.geojson                     | 01         |
| [03-sim-core.md](03-sim-core.md)                           | Vehicles, IDM, MOBIL, squeeze, filtering, engine                | 01         |
| [04-sim-features.md](04-sim-features.md)                   | Signals, obstacles, rain, disruptions, demand, infra            | 03         |
| [05-stats-worker.md](05-stats-worker.md)                   | Stats, queue classes, worker, protocol                          | 04         |
| [06-config-presets-stores.md](06-config-presets-stores.md) | zod schema, presets, share codes, zustand stores                | 01         |
| [07-map-rendering.md](07-map-rendering.md)                 | MapLibre + deck.gl, camera modes, minimap                       | 02, 05, 06 |
| [08-ui-panels.md](08-ui-panels.md)                         | Loading, commute picker, presets, expert panel, playback, guide | 05, 06     |
| [09-report.md](09-report.md)                               | End-of-run report, comparison, verdicts                         | 07, 08     |
| [10-qa-deploy.md](10-qa-deploy.md)                         | Playwright, perf budget, Vercel + domain, README                | 09         |

Parallelisable: 02 ‖ 03 ‖ 06 after 01; 07 ‖ 08 after 05 + 06.
