import { performance } from 'node:perf_hooks';
import { createEngine } from '../src/sim/engine';
import { presetConfig } from '../src/lib/presets';
import network from '../src/data/corridor/network.json';
import type { NetworkData } from '../src/sim/types';
import { queueClass } from '../src/sim/stats';
const arg = process.argv.indexOf('--preset');
const config = presetConfig(arg >= 0 ? process.argv[arg + 1] : 'monday-9am');
const duration = process.argv.indexOf('--duration');
if (duration >= 0) config.durationMin = Number(process.argv[duration + 1]);
const e = createEngine(network as unknown as NetworkData, config),
  start = performance.now();
e.run(config.durationMin * 600);
const elapsed = performance.now() - start,
  s = e.report();
console.log(
  `Headless ${config.durationMin} min: ${(elapsed / 1000).toFixed(2)} s; ${s.completedTrips} completed, ${s.activeVehicles} active, ${s.unservedDemand} waiting`,
);
console.table(
  s.cohorts
    .filter((c) => c.completedTrips)
    .map((c) => ({
      cohort: c.cohort,
      trips: c.completedTrips,
      endToEnd: c.endToEndTrips,
      minutes: c.meanTravelTimeS === null ? '—' : (c.meanTravelTimeS / 60).toFixed(1),
      kmh: c.meanSpeedKmh.toFixed(1),
      stops: c.stopsPerTrip.toFixed(1),
      changes: c.laneChangesPerTrip.toFixed(1),
    })),
);
console.table(
  e.network.junctions.map((j, i) => ({
    junction: j.name,
    maxQueue: Math.round(Math.max(s.maxQueues[i * 2], s.maxQueues[i * 2 + 1])),
    class: queueClass(Math.max(s.maxQueues[i * 2], s.maxQueues[i * 2 + 1])),
  })),
);
