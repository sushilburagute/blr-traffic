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
describe('segment boundaries', () => {
  it('a vehicle sees a standing leader across a segment boundary and stops behind it plausibly', () => {
    const c = mergeConfig(presetConfig('sunday-morning'), {
      durationMin: 2,
      demand: { vehPerHour: 0 },
      environment: { potholes: 0, speedBreakers: 0 },
      infra: {
        signals: {
          agara: {
            cycleS: 120,
            offsetS: 0,
            phases: [{ approaches: [0, 1], greenS: 120, amberS: 0 }],
          },
        },
      },
    });
    const e = createEngine(network, c),
      v = e.vehicles;
    const from = network.segments.findIndex((s) => s.id === 'toMarathahalli-silkBoard-agara'),
      to = network.segments.findIndex((s) => s.id === 'toMarathahalli-agara-iblur');
    const truck = v.spawn(to, 1, 5, 0, 0),
      car = v.spawn(from, 1, 2, 0, 0);
    v.s[truck] = 12;
    v.s[car] = network.segments[from].lengthM - 150;
    v.v[car] = 16;
    for (const id of [truck, car]) {
      v.exitJunction[id] = 5;
      v.signalRoll[id] = 1;
      v.cooldown[id] = 1000;
    }
    v.rebuildIndex();
    let worst = 0;
    for (let t = 0; t < 400; t++) {
      const before = v.v[car];
      e.step();
      v.v[truck] = 0;
      v.s[truck] = 12;
      worst = Math.max(worst, (before - v.v[car]) / 0.1);
    }
    expect(v.segment[car]).toBe(to);
    expect(v.v[car]).toBeLessThan(0.1);
    expect(v.s[car]).toBeLessThanOrEqual(12 - 9 + 0.01 - 0.09);
    expect(worst).toBeLessThanOrEqual(9);
  });
  it('buses never skip a stop because they changed lanes away from it', () => {
    const mains = network.segments.filter((s) => s.kind === 'main');
    const c = mergeConfig(presetConfig('monday-9am'), {
      durationMin: 6,
      demand: { mix: { bus: 30 } },
      infra: {
        busStops: mains.map((s) => ({
          segmentId: s.id,
          s: Math.round(s.lengthM * 0.3),
          dwellS: 15,
        })),
      },
    });
    const e = createEngine(network, c),
      v = e.vehicles;
    const stopOf = new Map(c.infra.busStops.map((b, i) => [b.segmentId, i]));
    let passes = 0,
      served = 0;
    for (let t = 0; t < 3600; t++) {
      const ahead = new Map<number, number>();
      for (const id of v.active) if (v.type[id] === 4) ahead.set(id, v.s[id]);
      e.step();
      for (const [id, s0] of ahead) {
        if (v.segment[id] < 0) continue;
        const i = stopOf.get(network.segments[v.segment[id]].id);
        if (i === undefined || v.type[id] !== 4) continue;
        const b = c.infra.busStops[i];
        if (s0 <= b.s + 5 && v.s[id] > b.s + 5) {
          passes++;
          if (v.servedStop[id] === i) served++;
        }
      }
    }
    expect(passes).toBeGreaterThan(20);
    expect(served / passes).toBeGreaterThan(0.8);
  }, 30000);
});
