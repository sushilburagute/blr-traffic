export function rainFactors(on: boolean) {
  return on
    ? { speed: 0.75, headway: 1.3, accel: 0.8, obstacle: 0.6 }
    : { speed: 1, headway: 1, accel: 1, obstacle: 1 };
}
