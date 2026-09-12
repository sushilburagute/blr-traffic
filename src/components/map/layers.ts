import { PathLayer, ScatterplotLayer, IconLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { NetworkData, Snapshot, ScenarioConfig, Segment, LonLat } from '@/sim/types';
import { TYPE_COLORS, PROFILE_COLORS, speedColor } from '@/lib/colors';
import { createObstacles } from '@/sim/obstacles';
import { projectSegment } from '@/sim/network';
import { isActive, affects, disruptionSection } from '@/sim/disruptions';
import type { ColorMode } from '@/store/uiStore';
export interface LayerOptions {
  colorMode: ColorMode;
  heat: boolean;
  queues: boolean;
  zoom: number;
}
const iconMapping = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [
    `v${i}`,
    { x: i * 64, y: 0, width: 64, height: 64, mask: true, anchorX: 32, anchorY: 32 },
  ]),
);
export function roadLayers(network: NetworkData) {
  const main = network.segments.filter((s) => s.kind !== 'ramp');
  return [
    new PathLayer<Segment>({
      id: 'roads',
      data: main,
      getPath: (s) => s.polyline,
      getWidth: (s) => s.widthM + 2,
      getColor: (s) => (s.kind === 'flyover' ? [115, 133, 124, 180] : [86, 106, 96, 160]),
      widthUnits: 'meters',
      widthMinPixels: 2,
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
  ];
}
export function laneLayers(network: NetworkData) {
  return network.segments
    .filter((s) => s.kind === 'main')
    .flatMap((s) =>
      Array.from({ length: s.lanes - 1 }, (_, lane) => ({
        id: `${s.id}-${lane}`,
        path: s.cumulativeS.map((pos) => projectSegment(s, lane + 0.5, pos).slice(0, 2) as LonLat),
      })),
    );
}
export function makeLayers(
  network: NetworkData,
  config: ScenarioConfig,
  snapshot: Snapshot | null,
  options: LayerOptions,
): Layer[] {
  const layers: Layer[] = [...roadLayers(network)];
  const { zoom, heat, queues, colorMode } = options;
  if (zoom >= 15)
    layers.push(
      new PathLayer({
        id: 'lanes',
        data: laneLayers(network),
        getPath: (d) => d.path,
        getColor: [215, 223, 203, 100],
        getWidth: 0.15,
        widthUnits: 'meters',
        widthMinPixels: 1,
      }),
    );
  if (snapshot && heat)
    layers.push(
      new PathLayer<Segment>({
        id: 'heat',
        data: network.segments.filter((s) => s.kind === 'main'),
        getPath: (s) => s.polyline,
        getColor: (s) => [...speedColor(snapshot.segmentSpeed[network.segments.indexOf(s)]), 110],
        getWidth: 20,
        widthUnits: 'meters',
        widthMinPixels: 3,
      }),
    );
  const markers = network.junctions.flatMap((j, i) =>
    [0, 1].map((a) => ({
      position: [j.lonlat[0] + (a ? -0.00008 : 0.00008), j.lonlat[1]],
      state: snapshot?.signals[i * 2 + a] ?? 0,
    })),
  );
  layers.push(
    new ScatterplotLayer({
      id: 'signals',
      data: markers,
      getPosition: (d) => d.position as [number, number],
      getFillColor: (d) =>
        d.state === 2 ? [151, 226, 166] : d.state === 1 ? [245, 195, 98] : [242, 109, 100],
      getRadius: 4,
      radiusMinPixels: 3,
      radiusMaxPixels: 7,
      stroked: true,
      getLineColor: [16, 24, 19],
      lineWidthMinPixels: 1,
    }),
  );
  layers.push(
    new TextLayer({
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
  );
  const obstacles = createObstacles(network, config).map((o) => {
    const segment = network.segments.find((s) => s.id === o.segmentId)!;
    return {
      position: projectSegment(segment, o.lanes[0], o.s),
      text: o.type === 'pothole' ? '●' : '≡',
      label: o.type,
    };
  });
  layers.push(
    new TextLayer({
      id: 'obstacles',
      data: obstacles,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      characterSet: ['●', '≡'],
      getColor: [245, 195, 98],
      getSize: 14,
      pickable: true,
    }),
  );
  const incidents = [
    ...config.disruptions,
    ...(config.liveEvents ?? []).flatMap((e) =>
      e.kind === 'disruption' && e.tick <= (snapshot?.simTime ?? 0) * 10 ? [e.disruption] : [],
    ),
  ]
    .filter((d) => isActive(d, snapshot?.simTime ?? 0))
    .flatMap((d) =>
      network.segments
        .filter((s) => s.kind === 'main' && affects(d, s))
        .map((s) => ({
          position: projectSegment(s, 1, disruptionSection(d, s).start),
          text: d.type === 'waterlogging' ? '≈' : '▲',
          label: d.type,
        })),
    );
  layers.push(
    new TextLayer({
      id: 'incidents',
      data: incidents,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 22,
      getColor: [244, 137, 93],
      pickable: true,
    }),
  );
  if (snapshot && queues) {
    const queuePaths = network.segments
      .filter((s) => s.kind === 'main')
      .map((s) => {
        const approach =
            network.junctions.findIndex((j) => j.id === s.toJunction) * 2 +
            (s.direction === 'toSilkBoard' ? 1 : 0),
          length = snapshot.queues[approach];
        return {
          length,
          path: Array.from(
            { length: 12 },
            (_, i) =>
              projectSegment(s, 0, s.lengthM - length + (i / 11) * length).slice(0, 2) as LonLat,
          ),
        };
      })
      .filter((q) => q.length > 5);
    layers.push(
      new PathLayer({
        id: 'queues',
        data: queuePaths,
        getPath: (q) => q.path,
        getWidth: 5,
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
  if (snapshot && snapshot.count) {
    const n = snapshot.count,
      colors = new Uint8Array(n * 4),
      radii = new Float32Array(n),
      lines = new Uint8Array(n * 4),
      angles = new Float32Array(n),
      sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let color = TYPE_COLORS[snapshot.type[i]];
      if (colorMode === 'behaviour') color = PROFILE_COLORS[snapshot.profile[i]];
      if (colorMode === 'speed') color = speedColor(snapshot.speed[i] * 3.6);
      if (colorMode === 'cohort') color = snapshot.flags[i] & 8 ? [192, 244, 200] : [88, 105, 95];
      const offset = i * 4;
      colors[offset] = color[0];
      colors[offset + 1] = color[1];
      colors[offset + 2] = color[2];
      colors[offset + 3] = 255;
      if (snapshot.flags[i] & 8) {
        lines[offset] = 235;
        lines[offset + 1] = 255;
        lines[offset + 2] = 225;
        lines[offset + 3] = 255;
      }
      radii[i] = snapshot.type[i] >= 4 ? 2 : 1.3;
      angles[i] = -snapshot.heading[i];
      sizes[i] = snapshot.type[i] >= 4 ? 13 : 7;
    }
    const attributes = {
      getPosition: { value: snapshot.pos, size: 2 },
      getFillColor: { value: colors, size: 4 },
      getRadius: { value: radii, size: 1 },
      getLineColor: { value: lines, size: 4 },
    };
    layers.push(
      new ScatterplotLayer({
        id: 'vehicles',
        data: { length: n, attributes },
        radiusUnits: 'meters',
        radiusMinPixels: zoom >= 16 ? 1 : 1.5,
        radiusMaxPixels: 5,
        stroked: true,
        getLineWidth: 0.4,
        lineWidthMinPixels: 1,
        opacity: zoom >= 16 ? 0.4 : 1,
        pickable: true,
      }),
    );
    if (zoom >= 16)
      layers.push(
        new IconLayer({
          id: 'vehicle-icons',
          data: {
            length: n,
            attributes: {
              getPosition: { value: snapshot.pos, size: 2 },
              getColor: { value: colors, size: 4 },
              getAngle: { value: angles, size: 1 },
              getSize: { value: sizes, size: 1 },
            },
          },
          iconAtlas: '/sprites/vehicles.png',
          iconMapping,
          getIcon: (_, info) => `v${snapshot.type[info.index]}`,
          sizeUnits: 'meters',
          sizeMinPixels: 7,
          sizeMaxPixels: 40,
          billboard: false,
          pickable: true,
        }),
      );
    const virtual = network.segments.filter(
      (s, index) =>
        s.kind === 'main' &&
        snapshot.effectiveLanes[index] > (config.infra.lanesOverride?.[s.id] ?? s.lanes),
    );
    if (virtual.length && zoom >= 15)
      layers.push(
        new PathLayer<Segment>({
          id: 'squeeze',
          data: virtual,
          getPath: (s) =>
            s.cumulativeS.map(
              (pos) => projectSegment(s, s.lanes, pos, s.lanes + 1).slice(0, 2) as LonLat,
            ),
          getWidth: 0.4,
          widthMinPixels: 1,
          getColor: [245, 195, 98, 190],
        }),
      );
  }
  return layers;
}
