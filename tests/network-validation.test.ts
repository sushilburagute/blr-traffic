import { it, expect } from 'vitest';
import { createEngine } from '@/sim/engine';
import { presetConfig } from '@/lib/presets';
import { mergeConfig } from '@/lib/schema';
import data from '@/data/corridor/network.json';
import type { NetworkData } from '@/sim/types';
const network = data as unknown as NetworkData;
it('rejects unknown expert references before the worker starts', () => {
  expect(() =>
    createEngine(
      network,
      mergeConfig(presetConfig('sunday-morning'), {
        infra: { busStops: [{ segmentId: 'does-not-exist', s: 100, dwellS: 20 }] },
      }),
    ),
  ).toThrow('Unknown road segment');
  expect(() =>
    createEngine(network, mergeConfig(presetConfig('sunday-morning'), { demand: { od: [[1]] } })),
  ).toThrow('OD matrix must have');
});
it('records a U-turn as a return trip without cycling indefinitely', () => {
  const c = mergeConfig(presetConfig('sunday-morning'), {
    durationMin: 1,
    demand: { vehPerHour: 0 },
    infra: { uTurns: { agara: true } },
  });
  const e = createEngine(network, c),
    seg = network.segments.findIndex(
      (s) => s.kind === 'main' && s.toJunction === 'agara' && s.direction === 'toMarathahalli',
    );
  const junction = network.junctions.findIndex((j) => j.id === 'agara');
  for (let i = 0; i < 100; i++) {
    const id = e.vehicles.spawn(seg, i % 3, 0, 0, 0);
    e.vehicles.s[id] = network.segments[seg].lengthM + 1 + i * 3;
    e.vehicles.exitJunction[id] = junction;
    e.vehicles.signalRoll[id] = 0;
    e.vehicles.through[id] = 0;
  }
  e.vehicles.rebuildIndex();
  e.step();
  expect(e.arrived).toBeGreaterThan(0);
  expect(e.arrived).toBeLessThan(20);
  expect(e.queue.flat().every((a) => a.turned)).toBe(true);
});
it('can replay wet pothole encounters deterministically', () => {
  const c = mergeConfig(presetConfig('monday-9am'), {
    durationMin: 1,
    environment: { rain: true, rainIntensity: 1 },
  });
  const a = createEngine(network, c),
    b = createEngine(network, c);
  a.run(600);
  b.run(600);
  expect(a.vehicles.obstacleMissed).toEqual(b.vehicles.obstacleMissed);
  expect(a.report()).toEqual(b.report());
});
