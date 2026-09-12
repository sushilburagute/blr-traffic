export function squeezeState(
  wasOpen: boolean,
  enabled: boolean,
  density: number,
  threshold: number,
  cuttingShare: number,
) {
  if (!enabled) return false;
  return wasOpen ? density >= threshold * 0.7 : density > threshold && cuttingShare > 0.3;
}
export function canUseVirtual(type: number, profile: number) {
  return type < 4 && profile !== 0;
}
