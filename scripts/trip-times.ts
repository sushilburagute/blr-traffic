/**
 * Uncensored trip times: every vehicle generated during the measurement window is followed until it
 * finishes (demand keeps flowing afterwards, as it would on the real road), including time spent
 * waiting to enter. The in-app report only averages trips completed inside the run, which is biased low.
 *
 *   yarn trips [--preset monday-9am] [--window 45] [--extra 75] [--json] [--set demand.vehPerHour=14000 ...]
 *
 * `--set path=value` (repeatable) overrides one config field; the value is parsed as JSON when possible.
 */
import { createEngine, DT } from '../src/sim/engine';
import { presetConfig } from '../src/lib/presets';
import { mergeConfig } from '../src/lib/schema';
import networkJSON from '../src/data/corridor/network.json';
import type { NetworkData, Direction } from '../src/sim/types';

const network = networkJSON as unknown as NetworkData;
const flag = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const preset = flag('preset', 'monday-9am'),
  windowMin = Number(flag('window', '45')),
  extraMin = Number(flag('extra', '75'));

let config = presetConfig(preset);
process.argv.forEach((arg, i) => {
  if (arg !== '--set') return;
  const [path, raw] = process.argv[i + 1].split('=');
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // a bare string
  }
  const patch = path
    .split('.')
    .reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Parameters<
    typeof mergeConfig
  >[1];
  config = mergeConfig(config, patch);
});
config.durationMin = windowMin + extraMin;
const engine = createEngine(network, config),
  v = engine.vehicles,
  queues = engine.queue as unknown as { __t?: number }[][];

// Tag each generated arrival with its time; recover it when the vehicle enters the road.
for (const q of queues) {
  const push = q.push.bind(q);
  q.push = (...items) => {
    for (const item of items) item.__t = engine.time;
    return push(...items);
  };
}
const sourceOfSegment = new Map(
  network.sources.map((s, i) => [network.segments.findIndex((x) => x.id === s.segmentId), i]),
);
const arrival = new Map<number, number>(),
  direction = new Map<number, Direction>();
const spawn = v.spawn.bind(v);
v.spawn = (seg, ...rest) => {
  const id = spawn(seg, ...rest);
  if (id >= 0) {
    const queue = queues[sourceOfSegment.get(seg) ?? -1];
    arrival.set(v.uid[id], queue?.[0]?.__t ?? engine.time);
    direction.set(v.uid[id], network.segments[seg].direction);
  }
  return id;
};
interface Trip {
  road: number;
  total: number;
  through: boolean;
  direction: Direction;
  arrivedAt: number;
}
const trips: Trip[] = [];
const complete = engine.stats.complete.bind(engine.stats);
engine.stats.complete = (vehicles, id, time) => {
  const uid = vehicles.uid[id],
    at = arrival.get(uid);
  if (at !== undefined && at < windowMin * 60)
    trips.push({
      road: time - vehicles.spawnTime[id],
      total: time - at,
      through: Boolean(vehicles.through[id]),
      direction: direction.get(uid)!,
      arrivedAt: at,
    });
  complete(vehicles, id, time);
};
engine.run(Math.round((config.durationMin * 60) / DT));

let unfinished = 0;
for (const q of queues) for (const item of q) if ((item.__t ?? 0) < windowMin * 60) unfinished++;
const lengthM = (d: Direction) =>
  network.segments
    .filter((s) => s.kind === 'main' && s.direction === d)
    .reduce((sum, s) => sum + s.lengthM, 0);
const summary = (xs: number[], metres = 0) => {
  const s = [...xs].sort((a, b) => a - b),
    at = (q: number) => +(s[Math.min(s.length - 1, Math.floor(s.length * q))] / 60).toFixed(1);
  return {
    n: s.length,
    meanMin: +(s.reduce((a, b) => a + b, 0) / s.length / 60).toFixed(1),
    p10Min: at(0.1),
    medianMin: at(0.5),
    p90Min: at(0.9),
    medianKmh: metres ? +((metres / (s[Math.floor(s.length / 2)] || 1)) * 3.6).toFixed(1) : null,
  };
};
const rows: Record<string, ReturnType<typeof summary>> = {};
for (const d of ['toMarathahalli', 'toSilkBoard'] as const) {
  const through = trips.filter((t) => t.through && t.direction === d);
  rows[`${d} end-to-end`] = summary(
    through.map((t) => t.total),
    lengthM(d),
  );
  // Time dependence: early vs late arrivals within the window.
  const half = (windowMin * 60) / 2;
  rows[`${d} end-to-end, first half`] = summary(
    through.filter((t) => t.arrivedAt < half).map((t) => t.total),
    lengthM(d),
  );
  rows[`${d} end-to-end, second half`] = summary(
    through.filter((t) => t.arrivedAt >= half).map((t) => t.total),
    lengthM(d),
  );
  const local = trips.filter((t) => !t.through && t.direction === d);
  rows[`${d} side-road entry wait`] = summary(local.map((t) => t.total - t.road));
}
const header = {
  preset,
  windowMin,
  extraMin,
  freeFlowMin: +(engine.stats.freeFlow / 60).toFixed(1),
  completedWindowTrips: trips.length,
  windowArrivalsNeverEntered: unfinished,
  overrides: process.argv.flatMap((a, i) => (a === '--set' ? [process.argv[i + 1]] : [])),
};
// Peak queue (m) per junction approach over the whole run, by direction.
const peakQueues = Object.fromEntries(
  network.junctions.map((j, i) => [
    j.id,
    {
      toMarathahalli: Math.round(engine.stats.maxQueues[i * 2]),
      toSilkBoard: Math.round(engine.stats.maxQueues[i * 2 + 1]),
    },
  ]),
);
if (process.argv.includes('--json')) console.log(JSON.stringify({ ...header, rows, peakQueues }));
else {
  console.log(header);
  console.table(rows);
  console.table(peakQueues);
}
