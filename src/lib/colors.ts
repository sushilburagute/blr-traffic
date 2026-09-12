import type { VehicleType, BehaviourProfile, Cohort } from '@/sim/types';
export const TYPE_COLORS: [number, number, number][] = [
  [151, 226, 166],
  [245, 195, 98],
  [127, 173, 242],
  [190, 151, 236],
  [242, 141, 109],
  [183, 190, 194],
];
export const PROFILE_COLORS: [number, number, number][] = [
  [151, 226, 166],
  [245, 195, 98],
  [240, 111, 101],
];
export const VEHICLE_LABELS: Record<VehicleType, string> = {
  twoWheeler: 'Two-wheeler',
  auto: 'Auto',
  car: 'Car',
  cab: 'Cab',
  bus: 'Bus',
  truck: 'Truck',
};
export const PROFILE_LABELS: Record<BehaviourProfile, string> = {
  disciplined: 'Lane follower',
  opportunist: 'Gap taker',
  aggressive: 'Lane cutter',
};
export function cohortLabel(cohort: Cohort) {
  const [t, p] = cohort.split(':') as [VehicleType, BehaviourProfile];
  return `${VEHICLE_LABELS[t]} · ${PROFILE_LABELS[p]}`;
}
export function speedColor(kmh: number): [number, number, number] {
  return kmh < 0
    ? [93, 108, 107]
    : kmh < 10
      ? [242, 109, 100]
      : kmh < 25
        ? [242, 177, 94]
        : [142, 213, 162];
}
export const queueColor = (m: number) =>
  m < 250 ? '#97e2a6' : m < 500 ? '#f5c362' : m <= 750 ? '#ef9754' : '#f26d64';
