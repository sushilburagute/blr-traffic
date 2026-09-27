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
/** Largest miter stretch at a vertex (limits offsets at hairpins; 2 = a 120° corner). */
const MAX_MITER = 2;
/** Heading is blended over up to this distance either side of a vertex. */
const HEADING_BLEND_M = 8;
interface Frame {
  /** Offset direction per vertex, metres east/north per metre of offset (miter-scaled unit normal). */
  mx: Float64Array;
  my: Float64Array;
  /** Compass bearing of each piece, degrees clockwise from north. */
  bearing: Float64Array;
  /** Half-width of the heading blend around each vertex, metres. */
  blend: Float64Array;
}
const frames = new WeakMap<Segment, Frame>();
/**
 * Offset geometry with continuous normals: each vertex gets the miter of its two pieces, and offsets
 * interpolate between vertex miters along a piece, so a point at a fixed lateral offset moves
 * continuously through corners (a piece normal would jump sideways by up to 2·offset·sin(θ/2)).
 */
function frameOf(segment: Segment): Frame {
  let f = frames.get(segment);
  if (f) return f;
  const p = segment.polyline,
    n = p.length,
    cs = segment.cumulativeS;
  const tx = new Float64Array(n - 1),
    ty = new Float64Array(n - 1);
  f = {
    mx: new Float64Array(n),
    my: new Float64Array(n),
    bearing: new Float64Array(n - 1),
    blend: new Float64Array(n),
  };
  for (let i = 0; i < n - 1; i++) {
    const cos = Math.cos(((p[i][1] + p[i + 1][1]) * Math.PI) / 360);
    const dx = (p[i + 1][0] - p[i][0]) * cos,
      dy = p[i + 1][1] - p[i][1],
      mag = Math.hypot(dx, dy) || 1;
    tx[i] = dx / mag;
    ty[i] = dy / mag;
    f.bearing[i] = (Math.atan2(dx, dy) * 180) / Math.PI;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1),
      b = Math.min(n - 2, i);
    // Right-hand normals of the adjacent pieces: (ty, -tx).
    let x = ty[a] + ty[b],
      y = -tx[a] - tx[b];
    const mag = Math.hypot(x, y);
    if (mag < 1e-9) {
      x = ty[b];
      y = -tx[b];
    } else {
      x /= mag;
      y /= mag;
    }
    const cosHalf = Math.max(1 / MAX_MITER, x * ty[b] - y * tx[b]);
    f.mx[i] = x / cosHalf;
    f.my[i] = y / cosHalf;
    f.blend[i] =
      i === 0 || i === n - 1
        ? 0
        : Math.min(HEADING_BLEND_M, (cs[i] - cs[i - 1]) / 2, (cs[i + 1] - cs[i]) / 2);
  }
  frames.set(segment, f);
  return f;
}
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
function pieceAt(segment: Segment, s: number) {
  let lo = 0,
    hi = segment.cumulativeS.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (segment.cumulativeS[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}
/**
 * Projects a point `offsetM` metres to the right of the centreline (negative = left) at chainage `s`,
 * with smoothly varying normals and heading. Writes [lon, lat, compass heading°] into `out`.
 */
export function projectOffset(
  segment: Segment,
  offsetM: number,
  s: number,
  out: [number, number, number] | Float64Array = [0, 0, 0],
) {
  s = Math.max(0, Math.min(s, segment.lengthM));
  const f = frameOf(segment),
    cs = segment.cumulativeS;
  const lo = pieceAt(segment, s),
    hi = lo + 1;
  const a = segment.polyline[lo],
    b = segment.polyline[hi];
  const t = (s - cs[lo]) / Math.max(0.001, cs[hi] - cs[lo]);
  const lat = a[1] + t * (b[1] - a[1]);
  const cos = Math.cos((lat * Math.PI) / 180);
  const mx = f.mx[lo] + t * (f.mx[hi] - f.mx[lo]),
    my = f.my[lo] + t * (f.my[hi] - f.my[lo]);
  let heading = f.bearing[lo];
  const toEnd = cs[hi] - s,
    fromStart = s - cs[lo];
  if (toEnd < f.blend[hi]) {
    const w = 0.5 - (0.5 * toEnd) / f.blend[hi];
    heading += w * wrap180(f.bearing[hi] - heading);
  } else if (fromStart < f.blend[lo]) {
    const w = 0.5 - (0.5 * fromStart) / f.blend[lo];
    heading += w * wrap180(f.bearing[lo - 1] - heading);
  }
  out[0] = a[0] + t * (b[0] - a[0]) + (mx * offsetM) / (METRES_PER_DEGREE * cos);
  out[1] = lat + (my * offsetM) / METRES_PER_DEGREE;
  out[2] = wrap180(heading);
  return out;
}
/**
 * Inverse of `projectOffset` across the section at chainage `s`: the lateral offset (metres, positive to
 * the right) whose projection is closest to the given point. Used to keep a vehicle's drawn position
 * continuous when it moves onto a different segment.
 */
export function offsetAt(segment: Segment, s: number, lon: number, lat: number) {
  s = Math.max(0, Math.min(s, segment.lengthM));
  const f = frameOf(segment),
    cs = segment.cumulativeS;
  const lo = pieceAt(segment, s),
    hi = lo + 1;
  const a = segment.polyline[lo],
    b = segment.polyline[hi];
  const t = (s - cs[lo]) / Math.max(0.001, cs[hi] - cs[lo]);
  const cLat = a[1] + t * (b[1] - a[1]),
    cLon = a[0] + t * (b[0] - a[0]);
  const cos = Math.cos((cLat * Math.PI) / 180);
  const mx = f.mx[lo] + t * (f.mx[hi] - f.mx[lo]),
    my = f.my[lo] + t * (f.my[hi] - f.my[lo]);
  const dx = (lon - cLon) * cos * METRES_PER_DEGREE,
    dy = (lat - cLat) * METRES_PER_DEGREE;
  return (dx * mx + dy * my) / Math.max(1e-9, mx * mx + my * my);
}
export function projectSegment(
  segment: Segment,
  lane: number,
  s: number,
  lanes = segment.lanes,
): [number, number, number] {
  return projectOffset(segment, laneOffset(segment, lane, lanes), s, [0, 0, 0]) as [
    number,
    number,
    number,
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
