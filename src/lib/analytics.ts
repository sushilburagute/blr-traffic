'use client';
import { sendGAEvent } from '@next/third-parties/google';
type Events = {
  sim_start: { preset: string; cohort: string };
  sim_finish: { preset: string; cohort: string; durationMin: number };
  preset_selected: { preset: string };
  expert_mode_toggled: { enabled: boolean };
  rain_toggled: { on: boolean };
  share_copied: { source: string };
  report_viewed: { cohort: string };
  guide_opened: { source: string };
};
export function track<E extends keyof Events>(event: E, params: Events[E]) {
  if (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID) sendGAEvent('event', event, params);
}
