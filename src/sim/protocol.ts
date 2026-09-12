import type { NetworkData, ScenarioConfig, Snapshot, SimStats, Disruption } from './types';
export type ToWorker =
  | { type: 'init'; network: NetworkData; config: ScenarioConfig }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'setSpeed'; multiplier: number }
  | { type: 'setRain'; on: boolean; intensity: 0 | 1 | 2 }
  | { type: 'addDisruption'; d: Disruption }
  | { type: 'skipToEnd'; untilS?: number }
  | { type: 'requestStats' }
  | { type: 'dispose' }
  | { type: 'recycle'; snapshot: Snapshot };
export type FromWorker =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'stats'; stats: SimStats }
  | { type: 'progress'; simTime: number; pct: number }
  | { type: 'finished'; stats: SimStats }
  | { type: 'error'; message: string };
