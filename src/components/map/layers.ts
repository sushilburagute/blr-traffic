import { PathLayer, ScatterplotLayer, IconLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { NetworkData, Snapshot, ScenarioConfig, Segment, LonLat } from '@/sim/types';
import { speedColor } from '@/lib/colors';
import { BODY_MAPPING, DETAIL_MAPPING, detailIcon } from '@/lib/vehicleSprites';
import { createObstacles } from '@/sim/obstacles';
import { projectSegment } from '@/sim/network';
import { isActive, affects, disruptionSection } from '@/sim/disruptions';
import type { ColorMode } from '@/store/uiStore';
import { CUE_BRAKE, CUE_LEFT, CUE_RIGHT, type VehicleGroup } from './vehicleFrame';

export interface LayerOptions {
  colorMode: ColorMode;
  heat: boolean;
  queues: boolean;
  zoom: number;
}
/** From this zoom vehicles are drawn as true-scale top-down sprites instead of dots. */
export const ICON_ZOOM = 16;
/** Stop lines sit this far before the end of an approach (the engine's stop position). */
const STOP_LINE_M = 2;
const SIGNAL_COLORS: [number, number, number][] = [
  [242, 109, 100],
  [245, 195, 98],
  [151, 226, 166],
];

const flat = (p: [number, number, number]) => [p[0], p[1]] as LonLat;
const offsetPath = (s: Segment, lane: number) =>
  s.cumulativeS.map((pos) => flat(projectSegment(s, lane, pos)));

/**
 * Geometry that only depends on the network, built once per network. Layer instances are created
 * per call because deck.gl cannot re-add a layer once it has been removed; reusing the same data
 * arrays keeps them from being re-uploaded.
 */
interface Static {
  ground: Segment[];
  flyovers: Segment[];
  main: Segment[];
  lanes: { path: LonLat[] }[];
  flyoverLanes: { path: LonLat[] }[];
  edges: { path: LonLat[]; segment: number }[];
  centres: { path: LonLat[]; segment: number }[];
  approach: number[];
  stopLines: { path: LonLat[]; approach: number }[];
  signals: { position: LonLat; approach: number }[];
  layers: () => { roads: Layer[]; lanes: Layer; deck: Layer[]; labels: Layer };
}
const statics = new WeakMap<NetworkData, Static>();
function staticFor(network: NetworkData): Static {
  const cached = statics.get(network);
  if (cached) return cached;
  const ground = network.segments.filter((s) => s.kind !== 'flyover'),
    flyovers = network.segments.filter((s) => s.kind === 'flyover'),
    main = network.segments.filter((s) => s.kind === 'main');
  const laneLines = (segments: Segment[]) =>
    segments.flatMap((s) =>
      Array.from({ length: s.lanes - 1 }, (_, lane) => ({ path: offsetPath(s, lane + 0.5) })),
    );
  const approach = network.segments.map(
    (s) =>
      network.junctions.findIndex((j) => j.id === s.toJunction) * 2 +
      (s.direction === 'toSilkBoard' ? 1 : 0),
  );
  const stopAt = (s: Segment) => s.lengthM - STOP_LINE_M;
  const stopLines = main.map((s) => ({
    approach: approach[network.segments.indexOf(s)],
    path: [
      flat(projectSegment(s, -0.5, stopAt(s))),
      flat(projectSegment(s, s.lanes - 0.5, stopAt(s))),
    ],
  }));
  const signals = main.map((s) => ({
    approach: approach[network.segments.indexOf(s)],
    position: flat(projectSegment(s, s.lanes + 0.4, stopAt(s))),
  }));
  const lanes = laneLines(main),
    flyoverLanes = laneLines(flyovers),
    edges = main.flatMap((s) => [
      { path: offsetPath(s, -0.5), segment: network.segments.indexOf(s) },
      { path: offsetPath(s, s.lanes - 0.5), segment: network.segments.indexOf(s) },
    ]),
    centres = main.map((s) => ({ path: s.polyline, segment: network.segments.indexOf(s) })),
    markings = [...lanes, ...edges];
  const result: Static = {
    ground,
    flyovers,
    main,
    lanes,
    flyoverLanes,
    edges,
    centres,
    approach,
    stopLines,
    signals,
    layers: () => ({
      roads: [
        new PathLayer<Segment>({
          id: 'roads',
          data: ground,
          getPath: (s) => s.polyline,
          getWidth: (s) => s.widthM + 2,
          getColor: (s) => (s.kind === 'ramp' ? [74, 92, 83, 170] : [86, 106, 96, 160]),
          widthUnits: 'meters',
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
          pickable: true,
        }),
        new PathLayer<Segment>({
          id: 'road-centres',
          data: main,
          getPath: (s) => s.polyline,
          getWidth: 1,
          getColor: [156, 173, 158, 120],
          widthUnits: 'pixels',
        }),
      ],
      lanes: new PathLayer<{ path: LonLat[] }>({
        id: 'lanes',
        data: markings,
        getPath: (d) => d.path,
        getColor: [215, 223, 203, 110],
        getWidth: 0.15,
        widthUnits: 'meters',
        widthMinPixels: 1,
      }),
      deck: [
        // A soft shadow and a lighter deck read as a structure above the at-grade road.
        new PathLayer<Segment>({
          id: 'flyover-shadow',
          data: flyovers,
          getPath: (s) => s.polyline,
          getWidth: (s) => s.widthM + 5,
          getColor: [6, 10, 8, 110],
          widthUnits: 'meters',
          widthMinPixels: 3,
        }),
        new PathLayer<Segment>({
          id: 'flyover-deck',
          data: flyovers,
          getPath: (s) => s.polyline,
          getWidth: (s) => s.widthM + 1.5,
          getColor: [118, 136, 127, 235],
          widthUnits: 'meters',
          widthMinPixels: 2,
          pickable: true,
        }),
        new PathLayer<{ path: LonLat[] }>({
          id: 'flyover-lanes',
          data: flyoverLanes,
          getPath: (d) => d.path,
          getColor: [228, 234, 220, 130],
          getWidth: 0.15,
          widthUnits: 'meters',
          widthMinPixels: 1,
        }),
      ],
      labels: new TextLayer({
        id: 'junction-labels',
        data: network.junctions,
        getPosition: (j) => j.lonlat,
        getText: (j) => (j.name === 'Central Silk Board' ? 'Silk Board' : j.name),
        getSize: 12,
        getColor: [229, 235, 223],
        getPixelOffset: [0, -22],
        fontFamily: 'Arial',
        fontWeight: 600,
        fontSettings: { sdf: true },
        outlineWidth: 5,
        outlineColor: [17, 23, 22],
        billboard: true,
        pickable: true,
      }),
    }),
  };
  statics.set(network, result);
  return result;
}

const shoulders = new WeakMap<Segment, { centre: LonLat[]; edge: LonLat[] }>();
function shoulder(s: Segment) {
  let paths = shoulders.get(s);
  if (!paths) {
    paths = { centre: offsetPath(s, s.lanes), edge: offsetPath(s, s.lanes + 0.5) };
    shoulders.set(s, paths);
  }
  return paths;
}

type ObstacleMark = { position: [number, number, number]; text: string; label: string };
const obstacleData = new WeakMap<ScenarioConfig, ObstacleMark[]>();
function obstaclesFor(network: NetworkData, config: ScenarioConfig) {
  let data = obstacleData.get(config);
  if (!data) {
    data = createObstacles(network, config).map((o) => {
      const segment = network.segments.find((s) => s.id === o.segmentId)!;
      return {
        position: projectSegment(segment, o.lanes[0], o.s),
        text: o.type === 'pothole' ? '●' : '≡',
        label: o.type,
      };
    });
    obstacleData.set(config, data);
  }
  return new TextLayer<ObstacleMark>({
    id: 'obstacles',
    data,
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    characterSet: ['●', '≡'],
    getColor: [245, 195, 98],
    getSize: 14,
    pickable: true,
  });
}

export interface Scene {
  /** Road surface, overlays and ground-level markings, drawn below ground vehicles. */
  under: Layer[];
  /** Flyover decks, drawn above ground vehicles and below flyover vehicles. */
  deck: Layer[];
  /** Signals, incidents and labels on top of everything. */
  over: Layer[];
}

export function sceneLayers(
  network: NetworkData,
  config: ScenarioConfig,
  snapshot: Snapshot | null,
  options: LayerOptions,
): Scene {
  const st = staticFor(network),
    fixed = st.layers();
  const { zoom, heat, queues } = options,
    close = zoom >= ICON_ZOOM;
  const under: Layer[] = [...fixed.roads];
  if (snapshot && heat)
    under.push(
      new PathLayer<{ path: LonLat[]; segment: number }>({
        id: 'heat',
        data: close ? st.edges : st.centres,
        getPath: (d) => d.path,
        getColor: (d) => [...speedColor(snapshot.segmentSpeed[d.segment]), close ? 150 : 110],
        // Up close the speed tint becomes a kerb stripe so lanes and vehicles read clearly.
        getWidth: close ? 0.4 : 20,
        widthUnits: 'meters',
        widthMinPixels: close ? 1 : 3,
        updateTriggers: { getColor: snapshot.segmentSpeed },
      }),
    );
  if (zoom >= 15) under.push(fixed.lanes);
  if (snapshot && queues) {
    const queuePaths = st.main
      .map((s) => {
        const length = snapshot.queues[st.approach[network.segments.indexOf(s)]];
        return {
          length,
          path: Array.from({ length: 12 }, (_, i) =>
            // Along the median edge so the bar doesn't sit under queued vehicles.
            flat(projectSegment(s, close ? -0.62 : 0, s.lengthM - length + (i / 11) * length)),
          ),
        };
      })
      .filter((q) => q.length > 5);
    under.push(
      new PathLayer({
        id: 'queues',
        data: queuePaths,
        getPath: (q) => q.path,
        getWidth: close ? 0.9 : 5,
        widthUnits: 'meters',
        widthMinPixels: 3,
        getColor: (q) =>
          q.length < 250
            ? [151, 226, 166, 180]
            : q.length < 500
              ? [245, 195, 98, 220]
              : q.length <= 750
                ? [239, 151, 84, 220]
                : [242, 109, 100, 230],
      }),
    );
  }
  if (snapshot && zoom >= 15)
    under.push(
      new PathLayer({
        id: 'stop-lines',
        data: st.stopLines,
        getPath: (d) => d.path,
        getColor: (d) => SIGNAL_COLORS[snapshot.signals[d.approach] ?? 0],
        getWidth: 0.6,
        widthUnits: 'meters',
        widthMinPixels: 2,
        updateTriggers: { getColor: snapshot.signals },
      }),
    );
  under.push(obstaclesFor(network, config));
  if (snapshot && zoom >= 15) {
    const virtual = st.main.filter(
      (s) =>
        snapshot.effectiveLanes[network.segments.indexOf(s)] >
        (config.infra.lanesOverride?.[s.id] ?? s.lanes),
    );
    if (virtual.length) {
      // The squeeze lane sits beyond the kerb lane, on the shoulder: pave it while it is in use
      // (under the markings and vehicles) and mark its outer edge.
      under.splice(
        fixed.roads.length,
        0,
        new PathLayer<Segment>({
          id: 'squeeze-surface',
          data: virtual,
          getPath: (s) => shoulder(s).centre,
          getWidth: (s) => s.widthM / s.lanes,
          getColor: [104, 104, 82, 170],
          widthUnits: 'meters',
          widthMinPixels: 1,
        }),
      );
      under.push(
        new PathLayer<Segment>({
          id: 'squeeze',
          data: virtual,
          getPath: (s) => shoulder(s).edge,
          getWidth: 0.4,
          widthMinPixels: 1,
          getColor: [245, 195, 98, 190],
        }),
      );
    }
  }

  const over: Layer[] = [
    new ScatterplotLayer<{ position: LonLat; approach: number }>({
      id: 'signals',
      data: st.signals,
      getPosition: (d) => d.position,
      getFillColor: (d) => SIGNAL_COLORS[snapshot?.signals[d.approach] ?? 0],
      getRadius: 1.2,
      radiusUnits: 'meters',
      radiusMinPixels: 3,
      radiusMaxPixels: 9,
      stroked: true,
      getLineColor: [16, 24, 19],
      lineWidthMinPixels: 1,
      updateTriggers: { getFillColor: snapshot?.signals },
    }),
  ];
  const incidents = [
    ...config.disruptions,
    ...(config.liveEvents ?? []).flatMap((e) =>
      e.kind === 'disruption' && e.tick <= (snapshot?.simTime ?? 0) * 10 ? [e.disruption] : [],
    ),
  ]
    .filter((d) => isActive(d, snapshot?.simTime ?? 0))
    .flatMap((d) =>
      st.main
        .filter((s) => affects(d, s))
        .map((s) => ({
          position: projectSegment(s, 1, disruptionSection(d, s).start),
          text: d.type === 'waterlogging' ? '≈' : '▲',
          label: d.type,
        })),
    );
  over.push(
    new TextLayer({
      id: 'incidents',
      data: incidents,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 22,
      characterSet: ['≈', '▲'],
      getColor: [244, 137, 93],
      pickable: true,
    }),
    fixed.labels,
  );
  return { under, deck: fixed.deck, over };
}

/**
 * Vehicles for one render group. Far out they are dots; from ICON_ZOOM they are top-down sprites
 * at true scale (exaggerated just past the threshold so they stay legible), with a masked body
 * tinted by the colour mode, a detail overlay carrying brake lights and blinking indicators, and
 * a ring marking notable behaviour (red-light runs, squeeze lane, filtering, your cohort).
 */
export function vehicleLayers(
  group: VehicleGroup,
  tag: 'ground' | 'flyover',
  zoom: number,
  blinkOn: boolean,
  version: number,
): Layer[] {
  if (!group.length) return [];
  const position = { value: group.positions, size: 2 };
  if (zoom < ICON_ZOOM)
    return [
      new ScatterplotLayer({
        id: `vehicles-${tag}`,
        data: {
          length: group.length,
          attributes: {
            getPosition: position,
            getFillColor: { value: group.colors, size: 4, normalized: true },
            getRadius: { value: group.radii, size: 1 },
            getLineColor: { value: group.cohort, size: 4, normalized: true },
          },
        },
        radiusUnits: 'meters',
        radiusMinPixels: 1.5,
        radiusMaxPixels: 5,
        stroked: true,
        getLineWidth: 0.4,
        lineWidthMinPixels: 1,
        pickable: true,
      }),
    ];
  const scale = Math.max(1, 2 ** (17 - zoom));
  const common = {
    sizeUnits: 'meters' as const,
    sizeScale: scale,
    billboard: false,
    pickable: true,
  };
  const attributes = {
    getPosition: position,
    getAngle: { value: group.angles, size: 1 },
    getSize: { value: group.sizes, size: 1 },
  };
  const { types, cues } = group;
  return [
    new ScatterplotLayer({
      id: `vehicle-halos-${tag}`,
      data: {
        length: group.length,
        attributes: {
          getPosition: position,
          getRadius: { value: group.haloRadii, size: 1 },
          getLineColor: { value: group.halos, size: 4, normalized: true },
        },
      },
      radiusUnits: 'meters',
      radiusScale: scale,
      filled: false,
      stroked: true,
      lineWidthUnits: 'meters',
      getLineWidth: 0.35 * scale,
      lineWidthMinPixels: 1.5,
    }),
    new IconLayer({
      id: `vehicle-bodies-${tag}`,
      data: {
        length: group.length,
        attributes: { ...attributes, getColor: { value: group.colors, size: 4, normalized: true } },
      },
      iconAtlas: '/sprites/vehicles.png',
      iconMapping: BODY_MAPPING,
      getIcon: (_: unknown, { index }: { index: number }) => `b${types[index]}`,
      updateTriggers: { getIcon: version },
      ...common,
    }),
    new IconLayer({
      id: `vehicle-details-${tag}`,
      data: { length: group.length, attributes },
      iconAtlas: '/sprites/vehicle-details.png',
      iconMapping: DETAIL_MAPPING,
      getIcon: (_: unknown, { index }: { index: number }) => {
        const cue = cues[index];
        return detailIcon(
          types[index],
          Boolean(cue & CUE_BRAKE),
          !blinkOn ? 0 : cue & CUE_LEFT ? -1 : cue & CUE_RIGHT ? 1 : 0,
        );
      },
      updateTriggers: { getIcon: [version, blinkOn] },
      ...common,
      pickable: false,
    }),
  ];
}
