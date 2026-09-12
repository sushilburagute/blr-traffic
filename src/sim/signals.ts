import type { SignalPlan } from './types';
export function signalState(plan: SignalPlan, time: number, approach: number): 0 | 1 | 2 {
  let t = (((time + plan.offsetS) % plan.cycleS) + plan.cycleS) % plan.cycleS;
  for (const phase of plan.phases) {
    if (t < phase.greenS + phase.amberS)
      return phase.approaches.includes(approach) ? (t < phase.greenS ? 2 : 1) : 0;
    t -= phase.greenS + phase.amberS;
  }
  return 0;
}
