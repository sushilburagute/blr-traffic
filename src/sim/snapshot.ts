import type { Engine } from './engine';
import type { Snapshot } from './types';
import { projectSegment } from './network';
export function makeSnapshot(engine: Engine, reuse?: Snapshot): Snapshot {
  const v = engine.vehicles,
    n = v.active.length;
  const reusable =
    reuse &&
    reuse.pos.length >= n * 2 &&
    reuse.segmentSpeed.length === engine.network.segments.length;
  const capacity = 2 ** Math.ceil(Math.log2(Math.max(n, 256)));
  const s: Snapshot = reusable
    ? reuse
    : {
        simTime: 0,
        clock: '',
        count: 0,
        pos: new Float32Array(capacity * 2),
        heading: new Float32Array(capacity),
        speed: new Float32Array(capacity),
        type: new Uint8Array(capacity),
        profile: new Uint8Array(capacity),
        flags: new Uint8Array(capacity),
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
      lane = v.lane[id] + (v.flags[id] & 2 ? 0.5 : 0);
    const [lon, lat, heading] = projectSegment(
      engine.network.segments[seg],
      lane,
      v.s[id],
      engine.effectiveLanes[seg],
    );
    s.pos[2 * i] = lon;
    s.pos[2 * i + 1] = lat;
    s.heading[i] = heading;
    s.speed[i] = v.v[id];
    s.type[i] = v.type[id];
    s.profile[i] = v.profile[id];
    s.flags[i] = v.flags[id];
    s.ids[i] = v.uid[id];
    s.segment[i] = seg;
    s.lane[i] = lane;
    s.segmentSpeed[seg] += v.v[id] * 3.6;
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
    s.signals,
    s.queues,
    s.segmentSpeed,
    s.ids,
    s.segment,
    s.lane,
    s.effectiveLanes,
  ].map((a) => a.buffer as ArrayBuffer);
}
