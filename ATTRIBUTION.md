# Data attribution

## OpenStreetMap

The corridor geometry (`src/data/corridor/raw-overpass.json`, `network.json`, `corridor.geojson` and the
copies under `public/data/corridor/`) is derived from OpenStreetMap data obtained through the Overpass API.

© OpenStreetMap contributors. This data is made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Any use of the derived files must carry this attribution, and any adapted database built from them must
be offered under the ODbL as well.

Derivation: `scripts/build-network.ts` selects ORR-tagged ways (`name` matching *Outer Ring Road* or
`ref` NH44/NH48) inside the bounding box 12.90–12.966 N, 77.615–77.712 E, routes each carriageway between
six junction anchors, and records `bridge=yes` / `tunnel=yes` near each junction as grade separation.
Lane counts, speed limits, ramp geometry, flyover lengths and signal plans are modelling assumptions added
by this project, not OSM facts.

## OpenFreeMap

The basemap in the app is served by [OpenFreeMap](https://openfreemap.org) (`tiles.openfreemap.org`),
rendered from OpenStreetMap data. © OpenStreetMap contributors. The app shows the required attribution in
the map's attribution control.

## Contextual figures

The guide quotes the TomTom Traffic Index for Bengaluru as background only; those figures are TomTom's and
are not redistributed as data. Queue-length bands (Free / Moderate / High / Severe) are categories defined
by this project for readability.
