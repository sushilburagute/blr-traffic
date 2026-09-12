export function canFilter(
  type: number,
  leaderSpeed: number,
  gap: number,
  roll: number,
  probability: number,
) {
  return type === 0 && leaderSpeed < 2 && gap < 3 && gap > 0 && roll < probability;
}
