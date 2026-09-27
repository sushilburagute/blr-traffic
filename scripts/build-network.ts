import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { NetworkData, LonLat, Segment, Direction } from '../src/sim/types';
import { JUNCTION_IDS } from '../src/sim/types';
import { cumulative, distance, METRES_PER_DEGREE } from '../src/sim/network/index';
import { defaultSignals } from '../src/lib/schema';
// Junction centres on the ORR centreline, read off OSM (signal clusters / grade-separation midpoints):
// Silk Board (Hosur Rd), Agara (Koramangala–Sarjapur Rd), Iblur (Sarjapur Rd), Bellandur (Bellandur Main Rd),
// Kadubeesanahalli (Panathur Main Rd), Marathahalli (Varthur Rd / Old Airport Rd).
const anchors: LonLat[] = [
  [77.6228, 12.9174],
  [77.6502, 12.9245],
  [77.6656, 12.921],
  [77.6782, 12.9269],
  [77.6946, 12.9389],
  [77.7011, 12.9569],
];
/** Length of each grade-separated bypass: approach ramp + deck + exit ramp (ORR flyovers run 600–900 m). */
const FLYOVER_M = 700;
/** On-ramp geometry: length along the carriageway and how far outside the kerb lane it starts. */
const RAMP_M = 30,
  RAMP_SLEW_M = 6;
const names = [
  'Central Silk Board',
  'Agara',
  'Iblur',
  'Bellandur',
  'Kadubeesanahalli',
  'Marathahalli',
];
type Element = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
};
let elements: Element[] = [];
try {
  elements = (
    JSON.parse(await readFile('src/data/corridor/raw-overpass.json', 'utf8')) as {
      elements: Element[];
    }
  ).elements;
} catch {
  console.warn('No raw Overpass data: using the explicitly labelled anchor-based fallback.');
}
const nodes = new Map(
  elements
    .filter((e) => e.type === 'node' && e.lon !== undefined)
    .map((e) => [e.id, [e.lon!, e.lat!] as LonLat]),
);
const ways = elements.filter(
  (e) =>
    e.type === 'way' &&
    e.nodes &&
    // ORR carriageways, plus the NH44/NH48-tagged underpasses that carry a local name (e.g. "Marathahalli Underpass").
    (/Outer Ring|ORR|National Highway 44/i.test(e.tags?.name ?? '') ||
      /NH ?4[48]/.test(e.tags?.ref ?? '')),
);
const graph = new Map<number, { to: number; cost: number; way: number }[]>();
for (const way of ways) {
  const ids = way.tags?.oneway === '-1' ? [...way.nodes!].reverse() : way.nodes!;
  for (let i = 1; i < ids.length; i++) {
    const a = ids[i - 1],
      b = ids[i];
    if (!nodes.has(a) || !nodes.has(b)) continue;
    const cost = distance(nodes.get(a)!, nodes.get(b)!);
    graph.set(a, [...(graph.get(a) ?? []), { to: b, cost, way: way.id }]);
    if (way.tags?.oneway !== 'yes' && way.tags?.oneway !== '-1')
      graph.set(b, [...(graph.get(b) ?? []), { to: a, cost, way: way.id }]);
  }
}
interface Route {
  polyline: LonLat[];
  wayIds: number[];
  endNode: number;
}
/**
 * Shortest directed path between two junction anchors. `from` pins the first node (the previous link's last
 * node) so consecutive links of a carriageway share their joint instead of each snapping to its own
 * "nearest node" to the anchor, which left a 41 m hole at Kadubeesanahalli.
 */
function route(start: LonLat, end: LonLat, from?: number): Route | null {
  const nearest = (point: LonLat) =>
    [...graph.keys()]
      .sort((a, b) => distance(point, nodes.get(a)!) - distance(point, nodes.get(b)!))
      .slice(0, 8);
  const starts = from !== undefined && graph.has(from) ? [from] : nearest(start),
    ends = nearest(end);
  if (!starts.length) return null;
  const costs = new Map<number, number>(),
    previous = new Map<number, { id: number; way: number }>(),
    open = new Set<number>();
  for (const id of starts) {
    costs.set(id, distance(start, nodes.get(id)!) * 3);
    open.add(id);
  }
  // Settle every candidate end node, then pick the one that best balances path cost and anchor proximity;
  // stopping at the first settled candidate can leave the segment a couple of hundred metres short.
  const settled = new Set<number>();
  while (open.size) {
    let best = -1,
      min = Infinity;
    for (const id of open) {
      const cost = costs.get(id)!;
      if (cost < min) {
        best = id;
        min = cost;
      }
    }
    open.delete(best);
    settled.add(best);
    if (ends.every((id) => settled.has(id))) break;
    for (const edge of graph.get(best) ?? []) {
      const cost = min + edge.cost;
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost);
        previous.set(edge.to, { id: best, way: edge.way });
        open.add(edge.to);
      }
    }
  }
  const reached = ends.filter((id) => settled.has(id));
  if (!reached.length) return null;
  const target = reached.reduce((a, b) =>
    costs.get(a)! + distance(end, nodes.get(a)!) * 3 <=
    costs.get(b)! + distance(end, nodes.get(b)!) * 3
      ? a
      : b,
  );
  const path = [target],
    wayIds = new Set<number>();
  while (previous.has(path[0])) {
    const p = previous.get(path[0])!;
    path.unshift(p.id);
    wayIds.add(p.way);
  }
  const polyline = path.map((id) => nodes.get(id)!);
  return polyline.length > 1
    ? { polyline, wayIds: [...wayIds].sort((a, b) => a - b), endNode: target }
    : null;
}
const fallbackBends: LonLat[][] = [
  [
    [77.626, 12.9161],
    [77.63, 12.9148],
    [77.634, 12.916],
    [77.6374, 12.9196],
  ],
  [
    [77.645, 12.924],
    [77.651, 12.925],
    [77.656, 12.9254],
  ],
  [
    [77.665, 12.927],
    [77.671, 12.928],
  ],
  [
    [77.683, 12.9312],
    [77.688, 12.9345],
    [77.692, 12.937],
  ],
  [
    [77.699, 12.943],
    [77.7, 12.948],
    [77.7003, 12.952],
  ],
];
function fallback(i: number, reverse: boolean) {
  const points = [anchors[i], ...fallbackBends[i], anchors[i + 1]];
  const dense: LonLat[] = [];
  for (let k = 1; k < points.length; k++)
    for (let j = 0; j < 8; j++) {
      const t = j / 8;
      dense.push([
        points[k - 1][0] * (1 - t) + points[k][0] * t,
        points[k - 1][1] * (1 - t) + points[k][1] * t,
      ]);
    }
  dense.push(points.at(-1)!);
  return reverse ? dense.reverse() : dense;
}
const network: NetworkData = {
  junctions: [],
  segments: [],
  sources: [],
  sinks: [],
  meta: { source: 'osm', attribution: '© OpenStreetMap contributors, ODbL 1.0', notes: [] },
};
let s = 0,
  usedFallback = false;
for (let i = 0; i < 6; i++) {
  if (i) s += cumulative(fallback(i - 1, false)).at(-1)!;
  // Grade separation for the ORR through movement: an ORR-tagged bridge or tunnel passing the junction.
  const bridge = ways.some(
    (w) =>
      (w.tags?.bridge === 'yes' || w.tags?.tunnel === 'yes') &&
      w.nodes?.some((n) => nodes.has(n) && distance(nodes.get(n)!, anchors[i]) < 250),
  );
  network.junctions.push({
    id: JUNCTION_IDS[i],
    name: names[i],
    lonlat: anchors[i],
    sOnCorridor: s,
    hasFlyover: bridge,
    signalDefault: { ...defaultSignals[JUNCTION_IDS[i]], offsetS: i * 11 },
    crossRoadNames: [
      ['Hosur Road'],
      ['Sarjapur Road (Koramangala side)', 'HSR Layout'],
      ['Sarjapur Road'],
      ['Bellandur Main Road'],
      ['Panathur Main Road'],
      ['Varthur Road', 'Old Airport Road'],
    ][i],
  });
}
/** Links are routed in travel order so each one can start exactly where the previous one ended. */
const routed = new Map<string, { found: Route | null; polyline: LonLat[] }>();
for (const direction of ['toMarathahalli', 'toSilkBoard'] as Direction[]) {
  const reverse = direction === 'toSilkBoard';
  let previous: { found: Route | null; polyline: LonLat[] } | undefined;
  for (let k = 0; k < 5; k++) {
    const i = reverse ? 4 - k : k,
      from = reverse ? i + 1 : i,
      to = reverse ? i : i + 1;
    const found =
      route(anchors[from], anchors[to], previous?.found?.endNode) ??
      route(anchors[from], anchors[to]);
    if (!found) usedFallback = true;
    let polyline = found?.polyline ?? fallback(i, reverse);
    // Separate synthetic carriageway centrelines by 12 m; OSM paths retain their surveyed coordinates.
    if (!found)
      polyline = polyline.map((p, k) => {
        const a = polyline[Math.max(0, k - 1)],
          b = polyline[Math.min(polyline.length - 1, k + 1)],
          dx = (b[0] - a[0]) * 0.974,
          dy = b[1] - a[1],
          m = Math.hypot(dx, dy) || 1;
        return [p[0] - ((dy / m) * 6) / 108300, p[1] + ((dx / m) * 6) / 111195];
      });
    // Last resort (fallback geometry, or a pinned start the router could not use): bridge to the previous end.
    const joint = previous?.polyline.at(-1);
    if (joint && distance(joint, polyline[0]) > 0.01)
      polyline =
        distance(joint, polyline[0]) < 1 ? [joint, ...polyline.slice(1)] : [joint, ...polyline];
    previous = { found, polyline };
    routed.set(`${direction}-${i}`, previous);
  }
}
for (const direction of ['toMarathahalli', 'toSilkBoard'] as Direction[]) {
  const reverse = direction === 'toSilkBoard';
  for (let i = 0; i < 5; i++) {
    const from = reverse ? i + 1 : i,
      to = reverse ? i : i + 1;
    const { found, polyline } = routed.get(`${direction}-${i}`)!;
    const cumulativeS = cumulative(polyline);
    const segment: Segment = {
      id: `${direction}-${JUNCTION_IDS[from]}-${JUNCTION_IDS[to]}`,
      direction,
      fromJunction: JUNCTION_IDS[from],
      toJunction: JUNCTION_IDS[to],
      lanes: 3,
      widthM: 10.5,
      lengthM: cumulativeS.at(-1)!,
      speedLimitKmh: 60,
      polyline,
      cumulativeS,
      kind: 'main',
      osmWayIds: found?.wayIds,
    };
    network.segments.push(segment);
    if (found && network.junctions[to].hasFlyover) {
      // The flyover only covers the final stretch of the link (ramp up, deck, ramp down); upstream of the split
      // every vehicle shares the at-grade lanes, so the bypass must not duplicate the whole carriageway.
      const flyoverM = Math.min(FLYOVER_M, segment.lengthM * 0.5),
        splitS = segment.lengthM - flyoverM;
      const k = cumulativeS.findIndex((c) => c > splitS),
        a = polyline[k - 1],
        b = polyline[k],
        t = (splitS - cumulativeS[k - 1]) / (cumulativeS[k] - cumulativeS[k - 1]);
      const flyoverLine: LonLat[] = [
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        ...polyline.slice(k),
      ];
      const flyoverS = cumulative(flyoverLine);
      network.segments.push({
        ...segment,
        id: segment.id + '-flyover',
        kind: 'flyover',
        lanes: 2,
        widthM: 7,
        polyline: flyoverLine,
        cumulativeS: flyoverS,
        lengthM: flyoverS.at(-1)!,
        bypassFor: segment.id,
      });
    }
    network.sources.push({
      id: `source-${direction}-${JUNCTION_IDS[from]}`,
      segmentId: (reverse ? i === 4 : i === 0) ? segment.id : segment.id + '-ramp',
      junctionId: JUNCTION_IDS[from],
      weight: (reverse ? i === 4 : i === 0) ? 3 : 1,
      endToEnd: reverse ? i === 4 : i === 0,
    });
    network.sinks.push({
      id: `sink-${direction}-${JUNCTION_IDS[to]}`,
      segmentId: segment.id,
      junctionId: JUNCTION_IDS[to],
    });
    // Local traffic joins from the kerb side (left in left-hand traffic): the slip road runs in at a shallow
    // angle and ends on the centre of the kerb lane, so its single lane lines up with the lane it feeds.
    const p = polyline[0],
      q = polyline[1],
      cos = Math.cos((p[1] * Math.PI) / 180),
      tx = (q[0] - p[0]) * cos,
      ty = q[1] - p[1],
      tm = Math.hypot(tx, ty) || 1,
      ux = tx / tm,
      uy = ty / tm,
      // Unit normal pointing to the right of travel (positive lane offsets); the kerb is on the negative side.
      nx = uy,
      ny = -ux;
    const kerbLane = -((segment.lanes - 1) / 2) * (segment.widthM / segment.lanes);
    const at = (along: number, across: number): LonLat => [
      p[0] + (ux * along + nx * across) / (METRES_PER_DEGREE * cos),
      p[1] + (uy * along + ny * across) / METRES_PER_DEGREE,
    ];
    const rampLine: LonLat[] = [at(-RAMP_M, kerbLane - RAMP_SLEW_M), at(0, kerbLane)],
      rampS = cumulative(rampLine);
    network.segments.push({
      ...segment,
      id: segment.id + '-ramp',
      kind: 'ramp',
      toJunction: segment.fromJunction,
      lanes: 1,
      widthM: 3.5,
      polyline: rampLine,
      cumulativeS: rampS,
      lengthM: rampS.at(-1)!,
      speedLimitKmh: 25,
    });
  }
}
{
  let s = 0;
  for (const segment of network.segments)
    if (segment.direction === 'toMarathahalli' && segment.kind === 'main') {
      s += segment.lengthM;
      network.junctions.find((j) => j.id === segment.toJunction)!.sOnCorridor = s;
    }
}
if (usedFallback) {
  network.meta!.source = ways.length ? 'mixed-osm-and-hand-traced' : 'hand-traced';
  network.meta!.notes.push(
    'Approximate geometry from plan anchors and manually specified bends. NOT surveyed OSM alignment; do not use for navigation. Flyovers default off without OSM evidence.',
  );
}
// Corridor chainage follows the generated main carriageway, rather than the fallback anchor distances.
let chainage = 0;
for (let i = 0; i < network.junctions.length; i++) {
  if (i) {
    const previous = network.segments.find(
      (s) =>
        s.kind === 'main' &&
        s.direction === 'toMarathahalli' &&
        s.fromJunction === JUNCTION_IDS[i - 1] &&
        s.toJunction === JUNCTION_IDS[i],
    );
    chainage += previous?.lengthM ?? 0;
  }
  network.junctions[i].sOnCorridor = chainage;
}
const geojson = {
  type: 'FeatureCollection',
  features: [
    ...network.segments.map((s) => ({
      type: 'Feature',
      properties: { id: s.id, kind: s.kind, lanes: s.lanes },
      geometry: { type: 'LineString', coordinates: s.polyline },
    })),
    ...network.junctions.map((j) => ({
      type: 'Feature',
      properties: { id: j.id, name: j.name },
      geometry: { type: 'Point', coordinates: j.lonlat },
    })),
    ...network.sources.map((s) => ({
      type: 'Feature',
      properties: { id: s.id, kind: 'source' },
      geometry: {
        type: 'Point',
        coordinates: network.segments.find((g) => g.id === s.segmentId)!.polyline[0],
      },
    })),
    ...network.sinks.map((s) => ({
      type: 'Feature',
      properties: { id: s.id, kind: 'sink' },
      geometry: {
        type: 'Point',
        coordinates: network.segments.find((g) => g.id === s.segmentId)!.polyline.at(-1),
      },
    })),
  ],
};
for (const dir of ['src/data/corridor', 'public/data/corridor']) {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/network.json`, JSON.stringify(network, null, 2) + '\n');
  await writeFile(`${dir}/corridor.geojson`, JSON.stringify(geojson) + '\n');
}
const lengths = ['toMarathahalli', 'toSilkBoard']
  .map(
    (d) =>
      `${d}: ${(network.segments.filter((s) => s.direction === d && s.kind === 'main').reduce((a, s) => a + s.lengthM, 0) / 1000).toFixed(3)} km`,
  )
  .join('\n');
await writeFile(
  'src/data/corridor/README.md',
  `# Corridor data\n\nSource: **${network.meta!.source}**.\n\n${network.meta!.notes.join('\n')}\n\n${lengths}\n\n${network.segments.length} segments. Verified flyovers: ${
    network.junctions
      .filter((j) => j.hasFlyover)
      .map((j) => j.name)
      .join(', ') || 'none (OSM unavailable)'
  }.\n\nRun yarn data:fetch, then yarn data:build to regenerate from OSM. The builder selects named ORR / NH 44 ways and follows directed topology; disconnected sections use the flagged fallback. Review alignment before treating data as surveyed. Ramps and signal timings are modelling assumptions.\n`,
);
console.log(lengths, `\n${network.segments.length} segments; source: ${network.meta!.source}`);
