import type { NetworkData, Snapshot } from '@/sim/types';
import { METRES_PER_DEGREE } from '@/sim/network';
import { TYPE_COLORS, PROFILE_COLORS, speedColor } from '@/lib/colors';
import { TYPE_PARAMS } from '@/sim/params';
import { SPRITE_SIZE_M } from '@/lib/vehicleSprites';
import type { ColorMode } from '@/store/uiStore';

/** Snapshot cue bits (see `Snapshot.cues`). */
export const CUE_BRAKE = 1,
  CUE_LEFT = 2,
  CUE_RIGHT = 4,
  CUE_RED_RUN = 8;
/** Engine flag bits (see `Vehicles.flags`). */
const FLAG_FILTER = 2,
  FLAG_VIRTUAL = 4,
  FLAG_COHORT = 8;
/** Beyond this jump (metres) between two snapshots a vehicle snaps instead of sliding. */
const MAX_SLIDE_M = 90;

export interface VehicleGroup {
  length: number;
  positions: Float64Array;
  /** deck.gl icon angles: counter-clockwise degrees, i.e. negated compass headings. */
  angles: Float32Array;
  colors: Uint8Array;
  /** Behaviour highlight ring colour; transparent when none applies. */
  halos: Uint8Array;
  /** White ring for the user's cohort only (used at low zoom). */
  cohort: Uint8Array;
  /** Dot radius at low zoom, metres. */
  radii: Float32Array;
  /** Icon size (sprite cell height) at true scale, metres. */
  sizes: Float32Array;
  /** Halo radius at true scale, metres. */
  haloRadii: Float32Array;
  types: Uint8Array;
  cues: Uint8Array;
  /** Maps a group index back to the index in the latest snapshot (for tooltips). */
  order: Int32Array;
}

type Typed = Float64Array | Float32Array | Uint8Array | Uint32Array | Int32Array;
function grow<T extends Typed>(a: T, n: number, make: (n: number) => T) {
  return a.length >= n ? a : make(2 ** Math.ceil(Math.log2(Math.max(n, 256))));
}
const f32 = (n: number) => new Float32Array(n),
  f64 = (n: number) => new Float64Array(n),
  u8 = (n: number) => new Uint8Array(n);
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
const lerpAngle = (a: number, b: number, t: number) => a + wrap(b - a) * t;
const HALO_M = TYPE_PARAMS.map((p) => p.length / 2 + 0.8);
const DOT_M = TYPE_PARAMS.map((p) => (p.length > 6 ? 2 : 1.3));

/**
 * Renders vehicles between two worker snapshots. Each vehicle is matched by its stable uid and
 * slides from where it was drawn when the new snapshot arrived to its new simulated pose over one
 * snapshot interval, so motion and lane changes are continuous instead of stepping at 20 Hz.
 * The engine's heading already includes the tilt into lane changes; it is eased the same way.
 * Vehicles on flyovers are ordered last so they can be drawn above the deck.
 */
export class VehicleFrame {
  private count = 0;
  private ground = 0;
  private from = f64(0);
  private to = f64(0);
  private fromHeading = f32(0);
  private toHeading = f32(0);
  private shownPos = f64(0);
  private shownHeading = f32(0);
  private ids = new Uint32Array(0);
  private nextIds = new Uint32Array(0);
  private slotOfUid = new Int32Array(0);
  private out = [f64(0), f64(0)];
  private outAngles = [f32(0), f32(0)];
  private flip = 0;
  private receivedAt = -1;
  private interval = 50;
  private order = new Int32Array(0);
  private types = u8(0);
  private cues = u8(0);
  private flags = u8(0);
  private colors = u8(0);
  private halos = u8(0);
  private cohort = u8(0);
  private radii = f32(0);
  private sizes = f32(0);
  private haloRadii = f32(0);
  private views: [VehicleGroup, VehicleGroup] | null = null;
  private colorMode: ColorMode | null = null;
  private snapshot: Snapshot | null = null;
  private readonly onFlyover: Uint8Array;

  constructor(network: NetworkData) {
    this.onFlyover = Uint8Array.from(network.segments, (s) => (s.kind === 'flyover' ? 1 : 0));
  }

  get latest() {
    return this.snapshot;
  }

  accept(snapshot: Snapshot, now: number) {
    const n = snapshot.count,
      previous = this.count;
    // Where each vehicle is drawn right now becomes the start of its next slide.
    const alpha = this.alpha(now);
    this.shownPos = grow(this.shownPos, previous * 2, f64);
    this.shownHeading = grow(this.shownHeading, previous, f32);
    for (let k = 0; k < previous; k++) {
      this.shownPos[2 * k] = this.from[2 * k] + (this.to[2 * k] - this.from[2 * k]) * alpha;
      this.shownPos[2 * k + 1] =
        this.from[2 * k + 1] + (this.to[2 * k + 1] - this.from[2 * k + 1]) * alpha;
      this.shownHeading[k] = lerpAngle(this.fromHeading[k], this.toHeading[k], alpha);
    }
    let maxUid = 0;
    for (let i = 0; i < n; i++) maxUid = Math.max(maxUid, snapshot.ids[i]);
    if (this.slotOfUid.length <= maxUid) {
      const next = new Int32Array(2 ** Math.ceil(Math.log2(maxUid + 1024)));
      next.set(this.slotOfUid);
      this.slotOfUid = next;
    }
    for (let k = 0; k < previous; k++) this.slotOfUid[this.ids[k]] = k + 1;

    this.from = grow(this.from, n * 2, f64);
    this.to = grow(this.to, n * 2, f64);
    this.fromHeading = grow(this.fromHeading, n, f32);
    this.toHeading = grow(this.toHeading, n, f32);
    this.nextIds = grow(this.nextIds, n, (m) => new Uint32Array(m));
    this.order = grow(this.order, n, (m) => new Int32Array(m));
    this.types = grow(this.types, n, u8);
    this.cues = grow(this.cues, n, u8);
    this.flags = grow(this.flags, n, u8);
    this.colors = grow(this.colors, n * 4, u8);
    this.halos = grow(this.halos, n * 4, u8);
    this.cohort = grow(this.cohort, n * 4, u8);
    this.radii = grow(this.radii, n, f32);
    this.sizes = grow(this.sizes, n, f32);
    this.haloRadii = grow(this.haloRadii, n, f32);
    for (let b = 0; b < 2; b++) {
      this.out[b] = grow(this.out[b], n * 2, f64);
      this.outAngles[b] = grow(this.outAngles[b], n, f32);
    }

    // Ground vehicles first, flyover vehicles last.
    let ground = 0;
    for (let i = 0; i < n; i++) if (!this.onFlyover[snapshot.segment[i]]) ground++;
    let g = 0,
      f = ground;
    for (let i = 0; i < n; i++) {
      const k = this.onFlyover[snapshot.segment[i]] ? f++ : g++;
      const uid = snapshot.ids[i],
        slot = this.slotOfUid[uid] - 1,
        lon = snapshot.pos[2 * i],
        lat = snapshot.pos[2 * i + 1];
      const heading = snapshot.heading[i];
      let fromLon = lon,
        fromLat = lat,
        fromHeading = heading;
      if (slot >= 0) {
        const px = this.shownPos[2 * slot],
          py = this.shownPos[2 * slot + 1],
          dx = (lon - px) * Math.cos((lat * Math.PI) / 180) * METRES_PER_DEGREE,
          dy = (lat - py) * METRES_PER_DEGREE;
        if (Math.hypot(dx, dy) < MAX_SLIDE_M) {
          fromLon = px;
          fromLat = py;
          fromHeading = this.shownHeading[slot];
        }
      }
      this.order[k] = i;
      this.nextIds[k] = uid;
      this.to[2 * k] = lon;
      this.to[2 * k + 1] = lat;
      this.from[2 * k] = fromLon;
      this.from[2 * k + 1] = fromLat;
      this.fromHeading[k] = fromHeading;
      this.toHeading[k] = heading;
      const type = snapshot.type[i];
      this.types[k] = type;
      this.radii[k] = DOT_M[type];
      this.sizes[k] = SPRITE_SIZE_M[type];
      this.haloRadii[k] = HALO_M[type];
      this.cues[k] = snapshot.cues ? snapshot.cues[i] : 0;
      this.flags[k] = snapshot.flags[i];
    }
    for (let k = 0; k < previous; k++) this.slotOfUid[this.ids[k]] = 0;
    [this.ids, this.nextIds] = [this.nextIds, this.ids];
    this.count = n;
    this.ground = ground;
    this.snapshot = snapshot;
    if (this.receivedAt >= 0)
      this.interval = Math.min(
        250,
        Math.max(16, this.interval * 0.7 + (now - this.receivedAt) * 0.3),
      );
    this.receivedAt = now;
    this.colorMode = null;
    this.views = null;
  }

  private alpha(now: number) {
    return this.receivedAt < 0
      ? 1
      : Math.min(1, Math.max(0, (now - this.receivedAt) / this.interval));
  }

  /** Forgets all vehicles, e.g. when a new run starts and uids restart. */
  clear() {
    this.count = 0;
    this.ground = 0;
    this.receivedAt = -1;
    this.snapshot = null;
    this.views = null;
  }

  /** Whether any vehicle is still sliding toward its latest snapshot pose. */
  moving(now: number) {
    return this.count > 0 && this.alpha(now) < 1;
  }

  /** Recolours when a snapshot or the colour mode changes. Returns whether colours changed. */
  paint(colorMode: ColorMode) {
    const s = this.snapshot;
    if (!s || colorMode === this.colorMode) return false;
    this.colorMode = colorMode;
    for (let k = 0; k < this.count; k++) {
      const i = this.order[k];
      let color = TYPE_COLORS[s.type[i]];
      if (colorMode === 'behaviour') color = PROFILE_COLORS[s.profile[i]];
      if (colorMode === 'speed') color = speedColor(s.speed[i] * 3.6);
      if (colorMode === 'cohort')
        color = s.flags[i] & FLAG_COHORT ? [192, 244, 200] : [88, 105, 95];
      this.colors.set(color, k * 4);
      this.colors[k * 4 + 3] = 255;
      this.halos.set(haloColor(this.cues[k], this.flags[k]), k * 4);
      this.cohort.set(this.flags[k] & FLAG_COHORT ? [235, 255, 225, 255] : [0, 0, 0, 0], k * 4);
    }
    this.views = null;
    return true;
  }

  /** Interpolated poses for this animation frame, split into ground and flyover groups. */
  frame(now: number): [VehicleGroup, VehicleGroup] {
    const alpha = this.alpha(now);
    this.flip = 1 - this.flip;
    const pos = this.out[this.flip],
      angles = this.outAngles[this.flip];
    for (let k = 0; k < this.count; k++) {
      pos[2 * k] = this.from[2 * k] + (this.to[2 * k] - this.from[2 * k]) * alpha;
      pos[2 * k + 1] = this.from[2 * k + 1] + (this.to[2 * k + 1] - this.from[2 * k + 1]) * alpha;
      angles[k] = -lerpAngle(this.fromHeading[k], this.toHeading[k], alpha);
    }
    // Per-vehicle attributes keep their identity between snapshots so deck.gl only re-uploads
    // the moving parts each frame.
    this.views ??= [this.group(0, this.ground), this.group(this.ground, this.count)];
    return this.views.map((v, g) => {
      const start = g ? this.ground : 0,
        end = g ? this.count : this.ground;
      return {
        ...v,
        positions: pos.subarray(start * 2, end * 2),
        angles: angles.subarray(start, end),
      };
    }) as [VehicleGroup, VehicleGroup];
  }

  private group(start: number, end: number): VehicleGroup {
    return {
      length: end - start,
      positions: f64(0),
      angles: f32(0),
      colors: this.colors.subarray(start * 4, end * 4),
      halos: this.halos.subarray(start * 4, end * 4),
      cohort: this.cohort.subarray(start * 4, end * 4),
      radii: this.radii.subarray(start, end),
      sizes: this.sizes.subarray(start, end),
      haloRadii: this.haloRadii.subarray(start, end),
      types: this.types.subarray(start, end),
      cues: this.cues.subarray(start, end),
      order: this.order.subarray(start, end),
    };
  }
}

/** Behaviour highlight ring: red-light run > squeeze lane > filtering > your cohort. */
function haloColor(cue: number, flag: number): [number, number, number, number] {
  if (cue & CUE_RED_RUN) return [255, 69, 58, 255];
  if (flag & FLAG_VIRTUAL) return [245, 195, 98, 235];
  if (flag & FLAG_FILTER) return [110, 205, 255, 235];
  if (flag & FLAG_COHORT) return [235, 255, 225, 255];
  return [0, 0, 0, 0];
}
