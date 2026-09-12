'use client';
import { create } from 'zustand';
import type { JunctionId } from '@/sim/types';
export type ColorMode = 'type' | 'behaviour' | 'speed' | 'cohort';
export const useUiStore = create<{
  mode: 'presets' | 'expert';
  panelOpen: boolean;
  selectedJunction: JunctionId | null;
  cameraMode: 'overview' | 'junction' | 'free';
  legendVisible: boolean;
  chartsVisible: boolean;
  heat: boolean;
  queues: boolean;
  colorMode: ColorMode;
  help: boolean;
  pinObstacle: boolean;
}>(() => ({
  mode: 'presets',
  panelOpen: true,
  selectedJunction: null,
  cameraMode: 'overview',
  legendVisible: true,
  chartsVisible: false,
  heat: true,
  queues: true,
  colorMode: 'type',
  help: false,
  pinObstacle: false,
}));
