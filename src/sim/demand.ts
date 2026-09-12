import type { NetworkData, ScenarioConfig } from './types';
export function clockMinute(clock: string) {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
}
function curve(config: ScenarioConfig, minute: number) {
  const d = config.demand;
  const clock = (clockMinute(config.startClock) + minute) % 1440;
  if (d.profile === 'flat') return 1;
  if (d.profile === 'custom') return d.customCurve?.[Math.min(59, Math.floor(minute))] ?? 1;
  const centre = d.profile === 'morning' ? 570 : 1140;
  return 0.55 + 0.65 * Math.exp(-(((clock - centre) / 70) ** 2));
}
export function demandRates(network: NetworkData, config: ScenarioConfig) {
  const n = Math.ceil(config.durationMin);
  const factors = Array.from({ length: n }, (_, i) => curve(config, i + 0.5));
  const total =
    factors.reduce((sum, f, i) => sum + f * Math.min(1, config.durationMin - i), 0) /
    config.durationMin;
  return factors.map((f) =>
    network.sources.map((source) => {
      const ends = network.sources.filter((s) => s.endToEnd).length,
        local = network.sources.length - ends;
      const weight = source.endToEnd
        ? config.demand.throughShare / ends
        : (1 - config.demand.throughShare) / Math.max(1, local);
      return ((config.demand.vehPerHour * f) / Math.max(0.001, total)) * weight;
    }),
  );
}
