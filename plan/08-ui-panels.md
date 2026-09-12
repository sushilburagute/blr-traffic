> Read `plan/00-overview.md` first — it holds the shared contracts and conventions this chunk must follow.

# Chunk 08 — UI: loading + commute picker, presets, expert panel, playback, live charts

**Goal:** The complete interaction flow from landing to running sim.

Files: `src/app/page.tsx`, `src/components/loading/*`, `panels/PresetPicker.tsx`, `panels/ExpertPanel/*`,
`panels/CommutePicker.tsx`, `panels/PlaybackBar.tsx`, `panels/LiveCharts.tsx`, `panels/HUD.tsx`,
`src/app/sim/page.tsx`, `src/app/s/[code]/page.tsx`, `src/lib/assetLoader.ts`.

Steps:
1. **Landing / loading screen** (`/`): full-screen split — left: progress list of assets being fetched
   (`assetLoader.ts` tracks: map style JSON, corridor tiles for zoom 13–15 (prefetch via `fetch` + browser
   cache), `network.json`, sprite atlas, worker script warm-up = create worker + `init` + `ready`), with a real
   percentage; right: **CommutePicker** — choose vehicle type (6 cards with icons) and behaviour
   (3 cards: "I follow my lane", "I take gaps when I see them", "Every gap is mine"). "Start" enables when
   assets are ready and both chosen. Skip-able if already cached (instant).
2. **Preset picker** (bottom sheet / sidebar on `/sim`): grid of preset cards with tagline + tags; selecting
   applies config and re-inits the worker. "Expert mode" toggle switches to the ExpertPanel.
3. **ExpertPanel** (accordion sections mirroring `ScenarioConfig`): Demand (veh/h slider, profile select,
   custom curve mini-editor, vehicle mix sliders that sum to 100, behaviour mix, through-share, pulses list),
   Infrastructure (lanes per segment, speed limit, bus lane, flyovers per junction, u-turns, encroachment
   list, bus stops list, signal plans per junction: cycle + green split sliders), Disruptions (list with add
   dialog: type, junction/segment, start, duration, lanes), Environment (rain toggle + intensity, potholes,
   breakers, pin obstacle by clicking the map), Behaviour (per-profile parameter sliders), Squeeze, Seed +
   Duration + Start clock. All bound to `scenarioStore.patch`. "Apply & restart" button; live-applicable
   fields (rain, add disruption) apply immediately via worker messages.
4. **PlaybackBar**: play/pause, speed chips 1/2/4/8/16/32×, sim clock, progress bar, "Skip to end",
   "Finish now" (→ `/report`), rain toggle with icon, colour-mode select, layer toggles.
5. **HUD**: junction chips (fly-to + queue badge with BTP class), corridor mean speed, vehicles on road,
   throughput, unserved demand; user's cohort highlighted stat ("your cohort avg speed so far").
6. **LiveCharts** (collapsible right drawer, Recharts): corridor mean speed vs time; queue length per
   approach (stacked small multiples); cohort mean speed lines. Updated on `stats` messages (every 5 s), not
   per frame.
7. `/s/[code]`: decode → set store → redirect to `/sim` (client) with a toast "Loaded shared scenario".
   Share button in PlaybackBar copies `${origin}/s/${encode(config)}`.
8. Save/load scenarios dialog (localStorage list from `scenarioStore`).
9. **Guide / how to use** — three layers, all fed from one content module `src/content/guide.ts`
   (array of sections with title, body (markdown-ish JSX), optional image/gif from `public/guide/`):
   - `/guide` page (`src/app/guide/page.tsx`): "What this is", "Pick your commute", "Presets vs Expert mode",
     "Reading the map" (vehicle colours, signal icons, potholes/breakers, squeeze lane, queue colours with the
     BTP thresholds table), "Playback controls & shortcuts", "Understanding the report" (each stat defined,
     how hours-lost is extrapolated, what the TomTom line means), "How the model works" (IDM/MOBIL/squeeze/
     filtering in plain English), "Sharing scenarios", "Data sources & limits". Linked from the header, footer
     and landing page.
   - In-app **Help sheet** (`?` button in the PlaybackBar, shortcut `?`): same sections in a right-side
     `Sheet` with a table of contents so the user never leaves the running sim. Tracks `guide_opened`.
   - **First-run hints**: on the first visit (localStorage flag) show 3 dismissible coach-mark tooltips in
     sequence — commute picker → preset grid → playback bar/overview button. "Don't show again" link.
10. Accessibility: keyboard for playback (space, [ ] for speed, `?` help, `Esc` overview), labels on all
    controls; mobile: panels become sheets, map full-bleed.

**Done when:** load → pick commute → pick preset or tweak expert → run → live HUD/charts all work; sharing
a URL reproduces the run exactly (same seed).
