import { describe, it, expect } from 'vitest';
import { RNG } from '@/sim/rng';
import { idm } from '@/sim/models/idm';
import { mobil } from '@/sim/models/mobil';
import { squeezeState, canUseVirtual } from '@/sim/models/squeeze';
import { TYPE_PARAMS, BEHAVIOUR_PARAMS } from '@/sim/params';
import { signalState } from '@/sim/signals';
import { queueClass, approachQueue } from '@/sim/stats';
import { defaultSignal, mergeConfig } from '@/lib/schema';
import { presetConfig } from '@/lib/presets';
import { createEngine } from '@/sim/engine';
import { loadNetwork, cumulative } from '@/sim/network';
import { makeSnapshot } from '@/sim/snapshot';
import { demandRates } from '@/sim/demand';
import { Vehicles } from '@/sim/vehicles';
import data from '@/data/corridor/network.json';
import type { NetworkData } from '@/sim/types';
const network = data as unknown as NetworkData;
describe('traffic physics', () => {
  it('replays live rain and disruptions at their original ticks', () => {
    const c = mergeConfig(presetConfig('sunday-morning'), { durationMin: 2 });
    const live = createEngine(network, c);
    live.run(200);
    live.setRain(true, 2);
    live.run(100);
    live.addDisruption({
      id: 'live',
      type: 'accident',
      junctionId: 'iblur',
      startMin: 0,
      durationMin: 5,
      sOffset: 0,
      params: { lanesBlocked: 2 },
    });
    live.run(100);
    live.setRain(false, 0);
    live.run(800);
    const replay = createEngine(network, live.report().config);
    replay.run(1200);
    expect(replay.report()).toEqual(live.report());
    expect(replay.vehicles.s).toEqual(live.vehicles.s);
  });
  it('IDM accelerates in free flow and brakes before an obstacle', () => {
    const p = TYPE_PARAMS[2];
    expect(idm(0, 1000, 0, p)).toBeCloseTo(p.a);
    expect(idm(15, 5, 15, p)).toBeLessThan(-3);
    expect(idm(p.vMax, 100000, 0, p)).toBeCloseTo(0, 3);
  });
  it('MOBIL always rejects unsafe cut-ins', () => {
    expect(mobil(0, 3, 0, -5, 0, 0, BEHAVIOUR_PARAMS[2], 10)).toBe(false);
    expect(mobil(0, 0.2, 0, 0, 0, 0, BEHAVIOUR_PARAMS[2])).toBe(true);
    expect(mobil(0, 0.2, 0, 0, 0, 0, BEHAVIOUR_PARAMS[0])).toBe(false);
  });
  it('squeeze has hysteresis and excludes large vehicles', () => {
    expect(squeezeState(false, true, 110, 100, 0.5)).toBe(true);
    expect(squeezeState(true, true, 80, 100, 0.5)).toBe(true);
    expect(squeezeState(true, true, 69, 100, 0.5)).toBe(false);
    expect(canUseVirtual(4, 2)).toBe(false);
    expect(canUseVirtual(2, 0)).toBe(false);
  });
  it('signals cover the exact cycle boundaries', () => {
    expect(signalState(defaultSignal, 0, 0)).toBe(2);
    expect(signalState(defaultSignal, 54, 0)).toBe(1);
    expect(signalState(defaultSignal, 57, 0)).toBe(0);
    expect(signalState(defaultSignal, 120, 0)).toBe(2);
  });
  it('queue classes respect their boundaries', () => {
    expect([249, 250, 499, 500, 750, 751].map(queueClass)).toEqual([
      'Free',
      'Moderate',
      'Moderate',
      'High',
      'High',
      'Severe',
    ]);
  });
  it('only counts a contiguous queue at the stop line', () => {
    const v = new Vehicles(1);
    for (const s of [80, 90, 98]) {
      const id = v.spawn(0, 0, 0, 0, 0);
      v.s[id] = s;
    }
    v.rebuildIndex();
    expect(approachQueue(v, 0, 100, 1)).toBe(22);
    v.v[v.laneIndex[0][1]] = 10;
    expect(approachQueue(v, 0, 100, 1)).toBe(4);
  });
  it('demand profile integrates to the requested hourly rate', () => {
    const c = presetConfig('monday-9am');
    const rates = demandRates(network, c);
    expect(rates.flat().reduce((a, b) => a + b, 0) / rates.length).toBeCloseTo(
      c.demand.vehPerHour,
      5,
    );
  });
  it('forks isolate random streams', () => {
    const a = new RNG(42),
      b = new RNG(42);
    a.fork('obstacles').next();
    expect(a.fork('spawn').next()).toBe(b.fork('spawn').next());
  });
  it('preserves geometry lengths and endpoints', () => {
    const g = loadNetwork(network);
    for (const s of network.segments) {
      expect(cumulative(s.polyline).at(-1)).toBeCloseTo(s.lengthM, 2);
      const p = g.project(s.id, (s.lanes - 1) / 2, s.lengthM);
      expect(p.slice(0, 2)).toEqual(s.polyline.at(-1));
    }
  });
  it('runs deterministically with no overlapping or negative-speed vehicles', () => {
    const c = mergeConfig(presetConfig('sunday-morning'), { durationMin: 2 });
    const a = createEngine(network, c),
      b = createEngine(network, c);
    a.run(1200);
    b.run(1200);
    expect(a.report()).toEqual(b.report());
    expect(a.vehicles.s).toEqual(b.vehicles.s);
    for (const list of a.vehicles.laneIndex) {
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        expect(a.vehicles.v[id]).toBeGreaterThanOrEqual(0);
        if (i)
          expect(
            a.vehicles.s[id] - TYPE_PARAMS[a.vehicles.type[id]].length - a.vehicles.s[list[i - 1]],
          ).toBeGreaterThanOrEqual(-0.01);
      }
    }
  }, 20000);
  it('rain lowers movement with the same arrivals and seed', () => {
    const c = mergeConfig(presetConfig('sunday-morning'), { durationMin: 2 });
    const dry = createEngine(network, c),
      wet = createEngine(network, c);
    dry.run(300);
    wet.run(300);
    wet.setRain(true);
    dry.run(300);
    wet.run(300);
    expect(wet.report().meanSpeedKmh).toBeLessThan(dry.report().meanSpeedKmh);
  });
  it('reuses returned snapshot buffers and stable identities', () => {
    const e = createEngine(network, presetConfig('sunday-morning'));
    e.run(50);
    const s = makeSnapshot(e),
      buffer = s.pos.buffer;
    const next = makeSnapshot(e, s);
    expect(next.pos.buffer).toBe(buffer);
    expect(next.ids[0]).toBe(e.vehicles.uid[e.vehicles.active[0]]);
  });
});
