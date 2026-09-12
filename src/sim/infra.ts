import type { ScenarioConfig, Segment } from './types';
export function physicalLanes(segment: Segment, config: ScenarioConfig) {
  return config.infra.lanesOverride?.[segment.id] ?? segment.lanes;
}
export function laneAllowed(
  type: number,
  lane: number,
  lanes: number,
  busLane: boolean,
  violation: boolean,
) {
  return !busLane || lane !== lanes - 1 || type === 4 || violation;
}
