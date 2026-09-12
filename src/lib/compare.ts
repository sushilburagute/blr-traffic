'use client';
import { createHeadlessRun } from './simClient';
import { mergeConfig } from './schema';
import type { ScenarioConfig } from '@/sim/types';
export type Comparison = 'no-rain' | 'no-squeeze' | 'disciplined';
export function comparisonConfig(config: ScenarioConfig, kind: Comparison) {
  return mergeConfig(
    config,
    kind === 'no-rain'
      ? {
          environment: { rain: false, rainIntensity: 0 },
          disruptions: config.disruptions.filter((d) => d.type !== 'waterlogging'),
          liveEvents: config.liveEvents?.filter(
            (e) => e.kind !== 'rain' && e.disruption.type !== 'waterlogging',
          ),
        }
      : kind === 'no-squeeze'
        ? { squeeze: { enabled: false } }
        : {
            demand: { behaviourMix: { disciplined: 100, opportunist: 0, aggressive: 0 } },
            squeeze: { enabled: false },
          },
  );
}
export function compare(
  config: ScenarioConfig,
  kind: Comparison,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
  untilS?: number,
) {
  return createHeadlessRun(comparisonConfig(config, kind), onProgress, signal, untilS);
}
