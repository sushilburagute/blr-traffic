import type { VehicleTypeParams } from '../types';
/** Treiber's IDM, with finite limits to remain stable near standing obstacles. */
export function idm(
  v: number,
  gap: number,
  deltaV: number,
  p: VehicleTypeParams,
  v0 = p.vMax,
  headwayFactor = 1,
  accelFactor = 1,
) {
  const a = p.a * accelFactor;
  const desired =
    p.s0 + Math.max(0, v * p.T * headwayFactor + (v * deltaV) / (2 * Math.sqrt(a * p.b)));
  const ratio = v / Math.max(0.1, v0);
  const ratio2 = ratio * ratio,
    gapRatio = desired / Math.max(0.1, gap);
  return Math.max(-9, Math.min(a, a * (1 - ratio2 * ratio2 - gapRatio * gapRatio)));
}
