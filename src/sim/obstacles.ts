import type { NetworkData, ScenarioConfig, ObstacleSpec } from './types';
import { RNG } from './rng';
export function createObstacles(network: NetworkData, config: ScenarioConfig) {
  const rng = new RNG(config.seed).fork('obstacles');
  const segments = network.segments.filter((s) => s.kind === 'main');
  const obstacles: ObstacleSpec[] = [...(config.environment.pinnedObstacles ?? [])];
  for (const type of ['pothole', 'speedBreaker'] as const) {
    const count =
      type === 'pothole' ? config.environment.potholes : config.environment.speedBreakers;
    for (let i = 0; i < count; i++) {
      const segment = segments[Math.floor(rng.next() * segments.length)];
      obstacles.push({
        id: `${type}-${i}`,
        segmentId: segment.id,
        lanes:
          type === 'pothole'
            ? [Math.floor(rng.next() * segment.lanes)]
            : Array.from({ length: segment.lanes }, (_, i) => i),
        s: rng.range(80, Math.max(81, segment.lengthM - 80)),
        type,
        speedCapKmh: type === 'pothole' ? 5 : 10,
      });
    }
  }
  return obstacles;
}
