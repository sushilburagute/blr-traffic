import type { NetworkData, Segment, LonLat } from '../types';
export const METRES_PER_DEGREE = 111195;
export function distance(a: LonLat, b: LonLat) {
  const lat = ((a[1] + b[1]) * Math.PI) / 360;
  return Math.hypot((b[0] - a[0]) * Math.cos(lat), b[1] - a[1]) * METRES_PER_DEGREE;
}
export function cumulative(polyline: LonLat[]) {
  const out = [0];
  for (let i = 1; i < polyline.length; i++)
    out.push(out[i - 1] + distance(polyline[i - 1], polyline[i]));
  return out;
}
export function laneOffset(segment: Segment, lane: number, lanes = segment.lanes) {
  return ((lanes - 1) / 2 - lane) * (segment.widthM / lanes);
}
export function projectSegment(
  segment: Segment,
  lane: number,
  s: number,
  lanes = segment.lanes,
): [number, number, number] {
  s = Math.max(0, Math.min(s, segment.lengthM));
  let lo = 0,
    hi = segment.cumulativeS.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (segment.cumulativeS[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = segment.polyline[lo],
    b = segment.polyline[hi];
  const t =
    (s - segment.cumulativeS[lo]) /
    Math.max(0.001, segment.cumulativeS[hi] - segment.cumulativeS[lo]);
  const lat = a[1] + t * (b[1] - a[1]);
  const cos = Math.cos((lat * Math.PI) / 180);
  const dx = (b[0] - a[0]) * cos,
    dy = b[1] - a[1];
  const mag = Math.hypot(dx, dy) || 1;
  const offset = laneOffset(segment, lane, lanes);
  return [
    a[0] + t * (b[0] - a[0]) + ((dy / mag) * offset) / (METRES_PER_DEGREE * cos),
    lat - ((dx / mag) * offset) / METRES_PER_DEGREE,
    (Math.atan2(dx, dy) * 180) / Math.PI,
  ];
}
export function loadNetwork(data: NetworkData) {
  const byId = new Map(data.segments.map((s, i) => [s.id, i]));
  for (const s of data.segments) {
    if (
      s.polyline.length < 2 ||
      s.cumulativeS.length !== s.polyline.length ||
      s.lengthM <= 0 ||
      Math.abs(s.cumulativeS.at(-1)! - s.lengthM) > 0.1
    )
      throw new Error(`Invalid geometry: ${s.id}`);
  }
  return {
    data,
    byId,
    project(id: string | number, lane: number, s: number) {
      const index = typeof id === 'number' ? id : byId.get(id);
      if (index === undefined) throw new Error('Unknown segment');
      return projectSegment(data.segments[index], lane, s);
    },
    nextSegments(id: string) {
      const s = data.segments[byId.get(id)!];
      return data.segments
        .filter(
          (n) =>
            n.direction === s.direction && n.fromJunction === s.toJunction && n.kind === 'main',
        )
        .map((n) => n.id);
    },
    approachOf(id: string | number) {
      const s = data.segments[typeof id === 'number' ? id : byId.get(id)!];
      return (
        data.junctions.findIndex((j) => j.id === s.toJunction) * 2 +
        (s.direction === 'toSilkBoard' ? 1 : 0)
      );
    },
  };
}
