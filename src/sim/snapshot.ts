import type { Engine } from './engine';
import type { Snapshot } from './types';
import { projectOffset } from './network';
/** Snapshot cue bits (see `Snapshot.cues`). */
export const CUE_BRAKE = 1,
  CUE_LEFT = 2,
  CUE_RIGHT = 4,
  CUE_RED_RUN = 8;
/** Brake lights: decelerating harder than this (m/s²), or held on the brake below STOPPED_MS. */
const BRAKE_ACCEL = -0.8,
  STOPPED_MS = 0.5;
/** Indicator on while the drawn position is this far (m) from the lane it is moving to. */
const INDICATE_M = 0.15;
/** A red-light run stays flagged for this long (s of sim time). */
const RED_RUN_CUE_S = 5;
const DEG = 180 / Math.PI;
const point = new Float64Array(3);
export function makeSnapshot(engine: Engine, reuse?: Snapshot): Snapshot {
  const v = engine.vehicles,
    n = v.active.length;
  const reusable =
    reuse &&
    reuse.pos.length >= n * 2 &&
    reuse.cues?.length >= n &&
    reuse.segmentSpeed.length === engine.network.segments.length;
  const capacity = 2 ** Math.ceil(Math.log2(Math.max(n, 256)));
  const s: Snapshot = reusable
    ? reuse
    : {
        simTime: 0,
        clock: '',
        count: 0,
        pos: new Float64Array(capacity * 2),
        heading: new Float32Array(capacity),
        speed: new Float32Array(capacity),
        type: new Uint8Array(capacity),
        profile: new Uint8Array(capacity),
        flags: new Uint8Array(capacity),
        cues: new Uint8Array(capacity),
        ids: new Uint32Array(capacity),
        segment: new Uint16Array(capacity),
        lane: new Float32Array(capacity),
        effectiveLanes: new Uint8Array(engine.network.segments.length),
        signals: new Uint8Array(engine.signals.length),
        queues: new Float32Array(engine.signals.length),
        segmentSpeed: new Float32Array(engine.network.segments.length),
      };
  s.simTime = engine.time;
  s.count = n;
  const [h, m] = engine.config.startClock.split(':').map(Number);
  const total = (h * 3600 + m * 60 + Math.floor(engine.time)) % 86400;
  s.clock = `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  s.segmentSpeed.fill(0);
  const counts = new Uint32Array(s.segmentSpeed.length);
  for (let i = 0; i < n; i++) {
    const id = v.active[i],
      seg = v.segment[id],
      lane = v.lane[id] + (v.flags[id] & 2 ? 0.5 : 0),
      speed = v.v[id];
    const target = engine.lateralTarget(seg, lane);
    let lat = v.latM[id];
    if (lat !== lat) lat = target;
    projectOffset(engine.network.segments[seg], lat, v.s[id], point);
    s.pos[2 * i] = point[0];
    s.pos[2 * i + 1] = point[1];
    // Road bearing, turned toward the side the vehicle is drifting (positive lateral = right = clockwise).
    s.heading[i] = point[2] + Math.atan2(v.latV[id], Math.max(speed, 1)) * DEG;
    const drift = target - lat;
    s.cues[i] =
      (v.a[id] < BRAKE_ACCEL || speed < STOPPED_MS ? CUE_BRAKE : 0) |
      (drift < -INDICATE_M ? CUE_LEFT : drift > INDICATE_M ? CUE_RIGHT : 0) |
      (engine.time - v.redRunAt[id] < RED_RUN_CUE_S ? CUE_RED_RUN : 0);
    s.speed[i] = speed;
    s.type[i] = v.type[id];
    s.profile[i] = v.profile[id];
    s.flags[i] = v.flags[id];
    s.ids[i] = v.uid[id];
    s.segment[i] = seg;
    s.lane[i] = lane;
    s.segmentSpeed[seg] += speed * 3.6;
    counts[seg]++;
  }
  for (let i = 0; i < counts.length; i++)
    s.segmentSpeed[i] = counts[i] ? s.segmentSpeed[i] / counts[i] : -1;
  s.signals.set(engine.signals);
  s.queues.set(engine.stats.queues);
  s.effectiveLanes.set(engine.effectiveLanes);
  return s;
}
export function snapshotBuffers(s: Snapshot): ArrayBuffer[] {
  return [
    s.pos,
    s.heading,
    s.speed,
    s.type,
    s.profile,
    s.flags,
    s.cues,
    s.signals,
    s.queues,
    s.segmentSpeed,
    s.ids,
    s.segment,
    s.lane,
    s.effectiveLanes,
  ].map((a) => a.buffer as ArrayBuffer);
}
