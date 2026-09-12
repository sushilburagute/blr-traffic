import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { createEngine } from '../src/sim/engine';
import { presetConfig } from '../src/lib/presets';
import { makeSnapshot } from '../src/sim/snapshot';
import { makeLayers } from '../src/components/map/layers';
import networkJSON from '../src/data/corridor/network.json';
import type { NetworkData } from '../src/sim/types';
const network = networkJSON as unknown as NetworkData;
const config = presetConfig('monday-9am');
config.demand.vehPerHour = 0;
config.disruptions = [];
config.environment.potholes = 0;
config.environment.speedBreakers = 0;
config.squeeze.enabled = false;
const engine = createEngine(network, config),
  main = network.segments.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'main');
const totalLength = main.reduce((sum, { s }) => sum + s.lengthM, 0);
let spawned = 0;
for (let index = 0; index < main.length; index++) {
  const { s, i } = main[index];
  const count =
    index === main.length - 1 ? 10000 - spawned : Math.floor((10000 * s.lengthM) / totalLength);
  for (let j = 0; j < count; j++) {
    const id = engine.vehicles.spawn(i, j % 3, 0, 0, 0);
    engine.vehicles.s[id] = ((Math.floor(j / 3) + 0.5) * s.lengthM) / Math.ceil(count / 3);
    engine.vehicles.signalRoll[id] = 1;
    engine.vehicles.exitJunction[id] = s.direction === 'toMarathahalli' ? 5 : 0;
    engine.vehicles.v[id] = 0;
    spawned++;
  }
}
engine.vehicles.rebuildIndex();
const samples: number[] = [];
for (let i = 0; i < 300; i++) {
  const start = performance.now();
  engine.step();
  samples.push(performance.now() - start);
}
const sorted = samples.slice(50).sort((a, b) => a - b);
let snapshot = makeSnapshot(engine);
const snapTimes: number[] = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  snapshot = makeSnapshot(engine, snapshot);
  snapTimes.push(performance.now() - start);
}
const layersTimes: number[] = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  makeLayers(network, config, snapshot, { colorMode: 'type', heat: true, queues: true, zoom: 16 });
  layersTimes.push(performance.now() - start);
}
const summary = {
  node: process.version,
  platform: process.platform,
  initialVehicles: spawned,
  finalVehicles: engine.vehicles.active.length,
  stepMeanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  stepP99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
  snapshotMeanMs: snapTimes.slice(10).reduce((a, b) => a + b, 0) / 90,
  layerConstructionMeanMs: layersTimes.slice(10).reduce((a, b) => a + b, 0) / 90,
  note: 'Synthetic 10k stationary two-wheelers spread across OSM main segments. Layer construction is CPU only; GPU frame time is not measured by this script.',
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/perf.json', JSON.stringify(summary, null, 2));
console.log(summary);
