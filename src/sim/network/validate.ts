import type { NetworkData, ScenarioConfig, Disruption } from '../types';
/** Validate references once at init, instead of silently ignoring an expert typo. */
export function validateScenarioNetwork(network: NetworkData, config: ScenarioConfig) {
  const segments = new Map(network.segments.map((s) => [s.id, s]));
  const sources = new Set(network.sources.map((s) => s.id));
  const junctions = new Set(network.junctions.map((j) => j.id));
  const segment = (id: string) => {
    const s = segments.get(id);
    if (!s) throw new Error(`Unknown road segment: ${id}`);
    return s;
  };
  for (const source of network.sources) segment(source.segmentId);
  for (const id of Object.keys(config.infra.lanesOverride ?? {})) segment(id);
  for (const x of [
    ...config.infra.encroachment,
    ...config.infra.busStops,
    ...(config.environment.pinnedObstacles ?? []),
  ]) {
    const s = segment(x.segmentId);
    if (x.s > s.lengthM) throw new Error(`Location exceeds the length of ${s.id}`);
  }
  for (const x of config.environment.pinnedObstacles ?? []) {
    const s = segment(x.segmentId),
      lanes = config.infra.lanesOverride?.[s.id] ?? s.lanes;
    if (x.lanes.some((l) => l >= lanes)) throw new Error(`Obstacle lane does not exist on ${s.id}`);
  }
  for (const p of config.demand.pulses)
    if (!sources.has(p.sourceId)) throw new Error(`Unknown demand source: ${p.sourceId}`);
  const disruption = (d: Disruption) => {
    if (d.segmentId) {
      const s = segment(d.segmentId);
      if (d.sOffset > s.lengthM) throw new Error(`Disruption exceeds the length of ${s.id}`);
    }
    if (d.junctionId && !junctions.has(d.junctionId))
      throw new Error(`Unknown junction: ${d.junctionId}`);
    if (d.params.sourceId && !sources.has(d.params.sourceId))
      throw new Error(`Unknown demand source: ${d.params.sourceId}`);
  };
  for (const d of config.disruptions) disruption(d);
  for (const e of config.liveEvents ?? []) if (e.kind === 'disruption') disruption(e.disruption);
  if (
    config.demand.od &&
    (config.demand.od.length !== network.sources.length ||
      config.demand.od.some((row) => row.length !== network.sinks.length))
  )
    throw new Error(
      `OD matrix must have ${network.sources.length} source rows and ${network.sinks.length} destination columns`,
    );
}
