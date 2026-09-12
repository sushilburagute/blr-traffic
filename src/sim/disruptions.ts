import type { Disruption, Segment } from './types';
export function isActive(d: Disruption, time: number) {
  return time >= d.startMin * 60 && time < (d.startMin + d.durationMin) * 60;
}
export function affects(d: Disruption, segment: Segment) {
  return d.segmentId === segment.id || d.junctionId === segment.toJunction;
}
export function disruptionSection(d: Disruption, segment: Segment) {
  const length =
    d.params.lengthM ?? (d.type === 'construction' ? 300 : d.type === 'illegalParking' ? 60 : 20);
  const start = d.sOffset || Math.max(0, segment.lengthM - length - 15);
  return { start, end: Math.min(segment.lengthM, start + length) };
}
