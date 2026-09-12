import type { Map } from 'maplibre-gl';
import type { NetworkData, JunctionId } from '@/sim/types';
export function overview(map: Map, network: NetworkData) {
  const points = network.segments.flatMap((s) => s.polyline);
  map.fitBounds(
    [
      [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
      [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
    ],
    {
      padding: { top: 105, bottom: 165, left: 55, right: 55 },
      pitch: 0,
      bearing: -27,
      duration: 900,
    },
  );
}
export function flyToJunction(map: Map, network: NetworkData, id: JunctionId) {
  const j = network.junctions.find((j) => j.id === id);
  if (j) map.flyTo({ center: j.lonlat, zoom: 16, pitch: 0, bearing: 0, duration: 900 });
}
