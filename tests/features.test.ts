import { describe, it, expect } from 'vitest';
import { createEngine } from '@/sim/engine';
import { defaults, mergeConfig } from '@/lib/schema';
import { cumulative } from '@/sim/network';
import { StatsCollector } from '@/sim/stats';
import { Vehicles } from '@/sim/vehicles';
import type { NetworkData, ScenarioConfig, LonLat, DeepPartial } from '@/sim/types';
const polyline: LonLat[] = [
    [77.62, 12.92],
    [77.626, 12.92],
  ],
  cs = cumulative(polyline);
const base = defaults();
const network: NetworkData = {
  junctions: [
    {
      id: 'silkBoard',
      name: 'Start',
      lonlat: polyline[0],
      sOnCorridor: 0,
      hasFlyover: false,
      signalDefault: base.infra.signals.silkBoard,
      crossRoadNames: [],
    },
    {
      id: 'agara',
      name: 'End',
      lonlat: polyline[1],
      sOnCorridor: cs.at(-1)!,
      hasFlyover: false,
      signalDefault: base.infra.signals.agara,
      crossRoadNames: [],
    },
  ],
  segments: [
    {
      id: 'road',
      direction: 'toMarathahalli',
      fromJunction: 'silkBoard',
      toJunction: 'agara',
      lanes: 3,
      widthM: 10.5,
      lengthM: cs.at(-1)!,
      speedLimitKmh: 60,
      polyline,
      cumulativeS: cs,
      kind: 'main',
    },
  ],
  sources: [
    { id: 'source', segmentId: 'road', junctionId: 'silkBoard', weight: 1, endToEnd: true },
  ],
  sinks: [{ id: 'end', segmentId: 'road', junctionId: 'agara' }],
};
function config(patch: DeepPartial<ScenarioConfig> = {}) {
  return mergeConfig(
    mergeConfig(base, {
      durationMin: 5,
      demand: {
        vehPerHour: 6000,
        profile: 'flat',
        throughShare: 1,
        mix: { twoWheeler: 0, auto: 0, car: 100, cab: 0, bus: 0, truck: 0 },
        behaviourMix: { disciplined: 100, opportunist: 0, aggressive: 0 },
      },
      userCohort: 'car:disciplined',
      environment: { potholes: 0, speedBreakers: 0 },
      squeeze: { enabled: false },
      infra: {
        signals: {
          agara: {
            cycleS: 120,
            offsetS: 0,
            phases: [{ approaches: [0, 1], greenS: 120, amberS: 0 }],
          },
        },
      },
    }),
    patch,
  );
}
describe('integrated traffic features', () => {
  it('discharges a red-light queue when green begins', () => {
    const e = createEngine(
      network,
      config({
        demand: { vehPerHour: 4000 },
        infra: {
          signals: {
            agara: {
              cycleS: 120,
              offsetS: 0,
              phases: [
                { approaches: [2], greenS: 60, amberS: 0 },
                { approaches: [0, 1], greenS: 60, amberS: 0 },
              ],
            },
          },
        },
      }),
    );
    e.run(590);
    expect(e.report().completedTrips).toBe(0);
    expect(e.report().maxQueues[2]).toBeGreaterThan(10);
    e.run(600);
    expect(e.report().completedTrips).toBeGreaterThan(10);
  });
  it('a two-lane accident substantially reduces throughput', () => {
    const dry = createEngine(network, config()),
      blocked = createEngine(
        network,
        config({
          disruptions: [
            {
              id: 'crash',
              type: 'accident',
              segmentId: 'road',
              startMin: 0,
              durationMin: 5,
              sOffset: 300,
              params: { lanesBlocked: 2, lengthM: 20 },
            },
          ],
        }),
      );
    dry.run(3000);
    blocked.run(3000);
    expect(blocked.report().completedTrips).toBeLessThan(dry.report().completedTrips * 0.75);
  });
  it('a speed breaker reduces speed near its location', () => {
    const dry = createEngine(network, config({ demand: { vehPerHour: 0 } })),
      slow = createEngine(
        network,
        config({
          demand: { vehPerHour: 0 },
          environment: {
            pinnedObstacles: [
              {
                id: 'breaker',
                segmentId: 'road',
                lanes: [0, 1, 2],
                s: 150,
                type: 'speedBreaker',
                speedCapKmh: 10,
              },
            ],
          },
        }),
      );
    for (const e of [dry, slow]) {
      const id = e.vehicles.spawn(0, 0, 2, 0, 0);
      e.vehicles.s[id] = 100;
      e.vehicles.v[id] = 15;
      e.vehicles.signalRoll[id] = 1;
      e.vehicles.cooldown[id] = 100;
    }
    dry.run(30);
    slow.run(30);
    expect(slow.vehicles.v[0]).toBeLessThan(dry.vehicles.v[0]);
  });
  it('disciplined non-buses never enter the reserved kerb lane', () => {
    const e = createEngine(network, config({ infra: { busLane: true } }));
    for (let i = 0; i < 1000; i++) {
      e.step();
      for (const id of e.vehicles.active) expect(e.vehicles.lane[id]).not.toBe(2);
    }
  });
  it('a filtering two-wheeler advances through a standing queue', () => {
    const e = createEngine(
      network,
      config({
        demand: { vehPerHour: 0 },
        behaviour: { aggressive: { filterProb: 1 } },
        infra: {
          signals: {
            agara: {
              cycleS: 120,
              offsetS: 0,
              phases: [{ approaches: [2], greenS: 120, amberS: 0 }],
            },
          },
        },
      }),
    );
    const end = network.segments[0].lengthM;
    let car = -1;
    for (const lane of [0, 1, 2])
      for (let j = 0; j < 5; j++) {
        const id = e.vehicles.spawn(0, lane, 2, 0, 0);
        e.vehicles.s[id] = end - 5 - j * 7;
        e.vehicles.signalRoll[id] = 1;
        e.vehicles.cooldown[id] = 100;
        if (lane === 0 && j === 4) car = id;
      }
    const bike = e.vehicles.spawn(0, 0, 0, 2, 0);
    e.vehicles.s[bike] = e.vehicles.s[car] - 5.5;
    e.vehicles.signalRoll[bike] = 1;
    e.vehicles.rebuildIndex();
    e.run(150);
    expect(e.vehicles.filterEvents[bike]).toBeGreaterThan(0);
    expect(e.vehicles.s[bike]).toBeGreaterThan(e.vehicles.s[car]);
  });
  it('computes mean, median, p90 and annual loss from qualifying trips', () => {
    const c = config(),
      v = new Vehicles(1),
      stats = new StatsCollector(network, c);
    for (const elapsed of [60, 120, 180]) {
      const id = v.spawn(0, 0, 2, 0, 0);
      v.through[id] = 1;
      v.distance[id] = 600;
      v.queueTime[id] = elapsed / 2;
      v.stops[id] = 2;
      stats.complete(v, id, elapsed);
      v.despawn(id);
    }
    const result = stats.report(v, 180, 0),
      cohort = result.cohorts.find((c) => c.cohort === 'car:disciplined')!;
    expect(cohort.completedTrips).toBe(3);
    expect(cohort.meanTravelTimeS).toBe(120);
    expect(cohort.medianTravelTimeS).toBe(120);
    expect(cohort.p90TravelTimeS).toBe(180);
    expect(cohort.queueTimeShare).toBe(0.5);
    expect(cohort.stopsPerTrip).toBe(2);
    expect(cohort.hoursLostPerYear).toBeCloseTo(((120 - result.freeFlowTravelTimeS) * 500) / 3600);
  });
  it('saturates a three-lane road at a plausible car-equivalent capacity', () => {
    const e = createEngine(network, config({ demand: { vehPerHour: 12000 } }));
    e.run(1800);
    const first = e.report().completedTrips;
    e.run(1200);
    const perLane = ((e.report().completedTrips - first) * 30) / 3;
    expect(perLane).toBeGreaterThan(1400);
    expect(perLane).toBeLessThan(2400);
  });
});
describe('weather and grade separation', () => {
  it('rain does not inflate lane changes (target-lane IDM uses the same weather factors)', () => {
    const scenario = config({
      demand: {
        mix: { twoWheeler: 40, auto: 10, car: 30, cab: 0, bus: 15, truck: 5 },
        behaviourMix: { disciplined: 0, opportunist: 0, aggressive: 100 },
      },
      userCohort: 'car:aggressive',
    });
    const dry = createEngine(network, scenario),
      wet = createEngine(
        network,
        mergeConfig(scenario, { environment: { rain: true, rainIntensity: 2 } }),
      );
    dry.run(3000);
    wet.run(3000);
    const changes = (e: typeof dry) =>
      e.report().cohorts.find((c) => c.cohort === 'car:aggressive')!.laneChangesPerTrip;
    expect(changes(dry)).toBeGreaterThan(0.3);
    expect(changes(wet)).toBeLessThan(changes(dry) * 1.5);
  });
  it('through traffic uses a flyover bypass only from its split point and skips the signal', () => {
    const cs2 = cumulative([
      [77.6245, 12.92],
      [77.626, 12.92],
    ]);
    const withFlyover: NetworkData = {
      ...network,
      junctions: network.junctions.map((j) => (j.id === 'agara' ? { ...j, hasFlyover: true } : j)),
      segments: [
        ...network.segments,
        {
          ...network.segments[0],
          id: 'road-flyover',
          kind: 'flyover',
          lanes: 2,
          widthM: 7,
          polyline: [
            [77.6245, 12.92],
            [77.626, 12.92],
          ],
          cumulativeS: cs2,
          lengthM: cs2.at(-1)!,
          bypassFor: 'road',
        },
      ],
    };
    const red = {
      agara: { cycleS: 120, offsetS: 0, phases: [{ approaches: [2], greenS: 120, amberS: 0 }] },
    };
    const e = createEngine(
      withFlyover,
      config({ infra: { signals: red, flyovers: { agara: true } } }),
    );
    e.run(1500);
    const flyoverIndex = 1;
    const onFlyover = e.vehicles.active.filter((id) => e.vehicles.segment[id] === flyoverIndex);
    expect(onFlyover.length).toBeGreaterThan(0);
    for (const id of onFlyover) expect(e.vehicles.s[id]).toBeLessThanOrEqual(cs2.at(-1)! + 0.01);
    // Every through vehicle climbs the flyover, so the permanently red at-grade signal completes nothing at grade
    // while the flyover lets trips through.
    expect(e.report().completedTrips).toBeGreaterThan(20);
    const grounded = createEngine(
      withFlyover,
      config({ infra: { signals: red, flyovers: { agara: false } } }),
    );
    grounded.run(1500);
    expect(grounded.report().completedTrips).toBe(0);
  });
});
