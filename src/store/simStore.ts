'use client';
import { create } from 'zustand';
import type { Snapshot, SimStats, ScenarioConfig } from '@/sim/types';
export const snapshotRef: { current: Snapshot | null } = { current: null };
interface State {
  status: 'idle' | 'loading' | 'ready' | 'running' | 'paused' | 'finished' | 'error';
  speed: number;
  simTime: number;
  progress: number;
  latestStats: SimStats | null;
  rain: boolean;
  error: string | null;
  runConfig: ScenarioConfig | null;
  runPreset: string;
  skipping: boolean;
}
export const useSimStore = create<State>(() => ({
  status: 'idle',
  speed: 8,
  simTime: 0,
  progress: 0,
  latestStats: null,
  rain: false,
  error: null,
  runConfig: null,
  runPreset: 'monday-9am',
  skipping: false,
}));
