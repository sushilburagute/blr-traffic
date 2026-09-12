> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 07 — Map & rendering (MapLibre + deck.gl)

**Goal:** Real-map visualisation of the corridor with GPU-rendered vehicles, signals, obstacles, congestion
heat, and camera controls — smooth at 10k vehicles.

Files: `src/components/map/MapCanvas.tsx`, `layers/*.ts`, `useDeckOverlay.ts`, `useSnapshotFrame.ts`,
`src/lib/mapStyle.ts`.

Steps:
1. `MapCanvas`: client component; MapLibre map with style `https://tiles.openfreemap.org/styles/dark`
   (fallback `liberty`), centred on the corridor, `maxBounds` = corridor bbox + padding, pitch 0.
   Attribution: OpenFreeMap + OpenStreetMap (required by licence). `dynamic(..., { ssr: false })`.
2. `useDeckOverlay`: `new MapboxOverlay({ interleaved: true })` added as a map control; `setProps({ layers })`
   on each frame. Layers (all in `layers/`):
   - `roadLayer` — PathLayer per segment from `corridor.geojson`, width by lane count, dim colour; flyovers
     slightly brighter and offset; closed/construction sections tinted.
   - `laneLayer` — thin dashed PathLayers per lane boundary at zoom ≥ 15 (precomputed offset polylines);
     virtual/squeeze lane drawn in amber when active.
   - `vehicleLayer` — `ScatterplotLayer` (fast) with `radiusUnits:'meters'`, radius by type, colour by
     `uiStore.colorMode` ∈ type | behaviour | speed | cohort-highlight; user's cohort gets a ring outline
     (second layer, filtered by flag bit3). Data = typed arrays via `data: {length, attributes: {getPosition: {value: pos, size:2}, …}}` — no per-vehicle JS objects.
     At zoom ≥ 16 swap to `IconLayer` with a small sprite atlas (2W/auto/car/bus/truck top-down, rotated by
     heading). Atlas is one PNG in `public/sprites/` (generated SVG → PNG in this chunk; simple shapes are fine).
   - `signalLayer` — IconLayer per approach, colour by state.
   - `obstacleLayer` — IconLayer for potholes/breakers/accidents/waterlogging/construction.
   - `heatLayer` — PathLayer over segments coloured by `segmentSpeed` (green→red), toggleable; plus
     `queueLayer` drawing queue extents from stop lines in BTP colours (Moderate amber / High orange / Severe red).
   - `labelLayer` — TextLayer for junction names and queue-length badges.
3. `useSnapshotFrame`: `requestAnimationFrame` loop reads `simStore` snapshot ref; interpolates positions
   between the last two snapshots by `speed × dt` along heading for smoothness at high multipliers; calls
   `overlay.setProps`. Never sets React state per frame.
4. Camera (`src/components/map/camera.ts`): three modes in `uiStore.cameraMode`:
   - **Overview (default)** — top-down (`pitch: 0, bearing` rotated so the corridor runs left→right),
     `fitBounds` to the corridor with padding for panels; this is the "watch the whole area" view where all
     six junctions, queues and heat are visible at once. Vehicles render as the fast ScatterplotLayer here.
   - **Junction** — `flyToJunction(id)` zoom 16, still top-down; junction chips in the HUD call this.
   - **Free** — user has panned/zoomed; an "⟲ Overview" button (and `Esc`) returns to Overview.
   Plus a **minimap** (`Minimap.tsx`, bottom-left, ~220×90 px): a static SVG of the corridor polylines with
   junction dots, live-tinted per segment by `segmentSpeed`, queue bars at approaches in BTP colours, and a
   rectangle showing the main map's current viewport; clicking it jumps the camera there.
   Clicking a vehicle shows a tooltip (type, profile, speed, lane, flags). Clicking a junction opens its
   signal/queue mini-card.
5. Rain visual: subtle overlay tint + a CSS rain shader/canvas on top when `rain` is on (cheap, cosmetic).
6. Performance: verify 60 fps at 10k vehicles with Chrome DevTools; snapshot→GPU path must not allocate
   per frame. Document numbers in `plan/notes-perf.md`.

**Done when:** vehicles move on the real ORR alignment, lanes visibly line up with the road at zoom 16,
signals blink, queues colour by BTP class, and frame time stays < 8 ms at 10k vehicles.
