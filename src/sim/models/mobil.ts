import type { BehaviourParams } from '../types';
export function mobil(
  currentA: number,
  targetA: number,
  newFollowerBefore: number,
  newFollowerAfter: number,
  oldFollowerBefore: number,
  oldFollowerAfter: number,
  p: BehaviourParams,
  pressure = 0,
) {
  return (
    newFollowerAfter >= -p.bSafe &&
    targetA -
      currentA +
      p.politeness * (newFollowerAfter - newFollowerBefore + oldFollowerAfter - oldFollowerBefore) +
      pressure >
      p.aThr
  );
}
