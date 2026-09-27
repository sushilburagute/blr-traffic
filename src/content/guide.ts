export const guideSections = [
  {
    id: 'what',
    title: 'What this is',
    body: 'A small laboratory for a very familiar commute. Watch six junctions on Bengaluru’s Outer Ring Road, from Central Silk Board to Marathahalli, in both directions. The simulation runs entirely in your browser. It is an educational model, not a live traffic forecast.',
  },
  {
    id: 'commute',
    title: 'Pick your commute',
    body: 'Choose a vehicle and a driving behaviour. You are observing a cohort: everyone in that vehicle × behaviour group. You do not control an individual vehicle. At least 8% of generated arrivals are reserved for your cohort; this can slightly change a preset’s requested mix, including Utopia and Free-for-all.',
  },
  {
    id: 'scenarios',
    title: 'Presets vs Expert mode',
    body: 'Presets are starting points: rush hour, a rainy Friday, construction, or a quiet Sunday. Expert mode edits demand, signal plans, infrastructure, disruptions, driver behaviour, and the random seed. Apply & restart uses all edits. Live rain and added disruptions take effect during the current run.',
  },
  {
    id: 'map',
    title: 'Reading the map',
    body: 'Vehicle colours identify two-wheelers (green), autos (amber), cars (blue), cabs (purple), buses (coral), and trucks (grey). Your cohort has a light outline. Zoom into a junction to see vehicle shapes and lanes. Red, amber, and green dots show signals. Amber lane markings indicate squeezing. Queue bands used by this simulator are Free below 250 m, Moderate from 250 to below 500 m, High from 500 through 750 m, and Severe above 750 m. These thresholds are model categories; an authoritative BTP citation has not yet been verified.',
  },
  {
    id: 'playback',
    title: 'Playback controls & shortcuts',
    body: 'Space plays or pauses. [ and ] decrease or increase speed from 1× to 32×. ? opens this guide. Esc returns to the top-down overview. Junction chips focus the camera; the minimap shows the current viewport. Skip to end computes the remaining run as fast as the worker can. Finish now reports only the time already simulated.',
  },
  {
    id: 'report',
    title: 'Understanding the report',
    body: 'Travel time, median and p90 use completed end-to-end trips only. A dash means no qualifying trips finished; short runs often have none. Speed and queue share include vehicles still travelling. Stops, lane changes and hard brakes are averaged over completed trips of any length. A stop means below 0.5 m/s for at least two seconds. A hard brake is a deceleration episode above 3.5 m/s²; the cut-in near-miss count is a model proxy, not a measured collision risk. Annual time lost is max(0, mean trip time − free-flow time) × 2 trips × 250 days ÷ 3600. This is an extrapolation, not a prediction.',
  },
  {
    id: 'model',
    title: 'How the model works',
    body: 'IDM adjusts acceleration to the gap and speed of the vehicle ahead. MOBIL weighs the acceleration gain from a lane change against braking imposed on neighbours. Aggressive drivers accept smaller gaps and change more frequently. When density is high, smaller vehicles can squeeze into a virtual lane; everyone slows from side friction. Two-wheelers can filter between queued lanes. Through traffic climbs onto a flyover or drops into an underpass about 700 m before a grade-separated junction and skips its signal; if the ramp is full it stays at grade and queues with everyone else. Signals, potholes, bus stops, blocked lanes and rain modify movement. A fixed 0.1-second step and seeded random streams make a scenario repeatable.',
  },
  {
    id: 'share',
    title: 'Sharing scenarios',
    body: 'Share copies a compressed scenario link containing configuration and seed. No results are stored on a server. A shared result link reruns the scenario to generate the report. Save stores a named scenario in this browser only. Download JSON exports configuration and the measured results.',
  },
  {
    id: 'limits',
    title: 'Data sources & limits',
    body: 'Corridor geometry comes from OpenStreetMap (© OpenStreetMap contributors, ODbL): both carriageways are routed along the surveyed ORR ways, about 11 km each way, and grade separation is taken from OSM bridge and tunnel tags (flyovers at Agara, Iblur and Bellandur; underpasses at Kadubeesanahalli and Marathahalli). Flyover lengths, lane counts, signal timings, demand, driver behaviour and disruption effects are assumptions, not calibrated observations. The Monday 9 AM demand (13,000 vehicles/hour) and 50 km/h free speed are tuned so trip times fall within ranges inferred from TomTom, BMTC and Bengaluru Traffic Police figures, not measured on this corridor. OpenFreeMap provides the basemap from OpenStreetMap. TomTom reports 74.4% citywide congestion and 13.9 km/h rush-hour speed for Bengaluru in 2025; these are context, not a calibration target or a like-for-like corridor comparison. Trips still on the road at the end are excluded from travel-time statistics, so congested or short runs can have completion bias.',
  },
];
export const firstRunHints = [
  'Pick the way you commute. The report follows your whole cohort.',
  'Start with a preset, or open Expert mode to change the experiment.',
  'Play or pause below, and change speed from 1× to 32×. Use junction chips to look closer; Esc restores the overview.',
];
