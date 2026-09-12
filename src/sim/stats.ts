import {
  VEHICLE_TYPES,
  PROFILES,
  type Cohort,
  type CohortStats,
  type SimStats,
  type NetworkData,
  type ScenarioConfig,
  type TimeSeries,
} from './types';
import { Vehicles, LANES_PER_SEGMENT } from './vehicles';
import { TYPE_PARAMS } from './params';
export const COHORTS = VEHICLE_TYPES.flatMap((t) => PROFILES.map((p) => `${t}:${p}` as Cohort));
export function queueClass(m: number) {
  return m < 250 ? 'Free' : m < 500 ? 'Moderate' : m <= 750 ? 'High' : 'Severe';
}
export function approachQueue(vehicles: Vehicles, segment: number, length: number, lanes: number) {
  let longest = 0;
  for (let lane = 0; lane < lanes; lane++) {
    const list = vehicles.laneIndex[segment * LANES_PER_SEGMENT + lane];
    let tail = length,
      head = length;
    for (let i = list.length - 1; i >= 0; i--) {
      const id = list[i],
        gap = tail - vehicles.s[id];
      if (vehicles.v[id] >= 5 / 3.6 || gap > (i === list.length - 1 ? 30 : 15)) break;
      if (i === list.length - 1) head = length;
      tail = vehicles.s[id] - TYPE_PARAMS[vehicles.type[id]].length;
      longest = Math.max(longest, head - tail);
    }
  }
  return longest;
}
interface Aggregate {
  trips: number;
  times: number[];
  distance: number;
  time: number;
  stops: number;
  changes: number;
  brakes: number;
  near: number;
  queue: number;
  filters: number;
  red: number;
  virtual: number;
}
export class StatsCollector {
  readonly aggregates: Aggregate[] = COHORTS.map(() => ({
    trips: 0,
    times: [],
    distance: 0,
    time: 0,
    stops: 0,
    changes: 0,
    brakes: 0,
    near: 0,
    queue: 0,
    filters: 0,
    red: 0,
    virtual: 0,
  }));
  readonly speed: number[] = [];
  readonly queueHistory: number[][];
  readonly cohortSpeed: number[][] = COHORTS.map(() => []);
  readonly queues: Float32Array;
  readonly maxQueues: Float32Array;
  readonly throughput = { toMarathahalli: 0, toSilkBoard: 0 };
  readonly events: { simTime: number; label: string }[] = [];
  private speedSum = 0;
  private samples = 0;
  private cohortSum = new Float64Array(18);
  private cohortSamples = new Uint32Array(18);
  private minuteQueue: Float32Array;
  readonly freeFlow: number;
  constructor(
    readonly network: NetworkData,
    readonly config: ScenarioConfig,
  ) {
    this.queues = new Float32Array(network.junctions.length * 2);
    this.maxQueues = new Float32Array(this.queues.length);
    this.minuteQueue = new Float32Array(this.queues.length);
    this.queueHistory = Array.from({ length: this.queues.length }, () => []);
    this.freeFlow =
      network.segments
        .filter((s) => s.kind === 'main')
        .reduce(
          (sum, s) =>
            sum + s.lengthM / (Math.min(s.speedLimitKmh, config.infra.speedLimitKmh) / 3.6),
          0,
        ) /
      Math.max(
        1,
        new Set(network.segments.filter((s) => s.kind === 'main').map((s) => s.direction)).size,
      );
  }
  complete(v: Vehicles, id: number, time: number) {
    const a = this.aggregates[v.type[id] * 3 + v.profile[id]],
      elapsed = time - v.spawnTime[id];
    a.trips++;
    if (v.through[id]) a.times.push(elapsed);
    a.distance += v.distance[id];
    a.time += elapsed;
    a.stops += v.stops[id];
    a.changes += v.laneChanges[id];
    a.brakes += v.hardBrakes[id];
    a.near += v.nearMisses[id];
    a.queue += v.queueTime[id];
    a.filters += v.filterEvents[id];
    a.red += v.redRuns[id];
    a.virtual += v.virtualTime[id];
    this.throughput[this.network.segments[v.segment[id]].direction]++;
  }
  sample(v: Vehicles, time: number, lanes: number[]) {
    this.queues.fill(0);
    for (let i = 0; i < this.network.segments.length; i++) {
      const s = this.network.segments[i];
      if (s.kind === 'ramp') continue;
      const a =
        this.network.junctions.findIndex((j) => j.id === s.toJunction) * 2 +
        (s.direction === 'toSilkBoard' ? 1 : 0);
      this.queues[a] = Math.max(this.queues[a], approachQueue(v, i, s.lengthM, lanes[i]));
    }
    for (let i = 0; i < this.queues.length; i++) {
      this.maxQueues[i] = Math.max(this.maxQueues[i], this.queues[i]);
      this.minuteQueue[i] = Math.max(this.minuteQueue[i], this.queues[i]);
    }
    let sum = 0;
    const count = new Uint32Array(18),
      speeds = new Float64Array(18);
    for (const id of v.active) {
      sum += v.v[id];
      const c = v.type[id] * 3 + v.profile[id];
      count[c]++;
      speeds[c] += v.v[id] * 3.6;
    }
    this.speedSum += v.active.length ? (sum * 3.6) / v.active.length : 0;
    this.samples++;
    for (let c = 0; c < 18; c++)
      if (count[c]) {
        this.cohortSum[c] += speeds[c] / count[c];
        this.cohortSamples[c]++;
      }
    if (Math.round(time) % 60 === 0) {
      this.speed.push(this.speedSum / this.samples);
      for (let c = 0; c < 18; c++)
        this.cohortSpeed[c].push(this.cohortSum[c] / Math.max(1, this.cohortSamples[c]));
      for (let a = 0; a < this.queues.length; a++) this.queueHistory[a].push(this.minuteQueue[a]);
      this.speedSum = 0;
      this.samples = 0;
      this.cohortSum.fill(0);
      this.cohortSamples.fill(0);
      this.minuteQueue.fill(0);
    }
  }
  report(v: Vehicles, time: number, unserved: number, finished = false): SimStats {
    const activeDistance = new Float64Array(18),
      activeTime = new Float64Array(18),
      activeQueue = new Float64Array(18);
    let currentSpeed = 0;
    for (const id of v.active) {
      const c = v.type[id] * 3 + v.profile[id];
      activeDistance[c] += v.distance[id];
      activeTime[c] += time - v.spawnTime[id];
      activeQueue[c] += v.queueTime[id];
      currentSpeed += v.v[id];
    }
    const cohorts: CohortStats[] = this.aggregates.map((a, c) => {
      const times = [...a.times].sort((x, y) => x - y),
        mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
      return {
        cohort: COHORTS[c],
        completedTrips: a.trips,
        endToEndTrips: times.length,
        meanTravelTimeS: mean,
        medianTravelTimeS: times.length
          ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2
          : null,
        p90TravelTimeS: times.length ? times[Math.ceil(times.length * 0.9) - 1] : null,
        meanSpeedKmh:
          ((a.distance + activeDistance[c]) / Math.max(1, a.time + activeTime[c])) * 3.6,
        stopsPerTrip: a.stops / Math.max(1, a.trips),
        laneChangesPerTrip: a.changes / Math.max(1, a.trips),
        hardBrakesPerTrip: a.brakes / Math.max(1, a.trips),
        nearMisses: a.near,
        queueTimeShare: (a.queue + activeQueue[c]) / Math.max(1, a.time + activeTime[c]),
        filteringEvents: a.filters,
        redLightRuns: a.red,
        virtualLaneTimeS: a.virtual,
        travelTimesS: times,
        hoursLostPerYear: mean === null ? null : (Math.max(0, mean - this.freeFlow) * 500) / 3600,
      };
    });
    const allTimes = cohorts.flatMap((c) => c.travelTimesS);
    const series = (values: number[]): TimeSeries => ({
      tStart: 60,
      tStep: 60,
      values: Float32Array.from(values),
    });
    return {
      simTime: time,
      completedTrips: cohorts.reduce((n, c) => n + c.completedTrips, 0),
      activeVehicles: v.active.length,
      unservedDemand: unserved,
      meanSpeedKmh: v.active.length ? (currentSpeed / v.active.length) * 3.6 : 0,
      freeFlowTravelTimeS: this.freeFlow,
      congestionPct: allTimes.length
        ? Math.max(
            0,
            (allTimes.reduce((a, b) => a + b, 0) / allTimes.length / this.freeFlow - 1) * 100,
          )
        : null,
      throughput: { ...this.throughput },
      cohorts,
      speedSeries: series(this.speed),
      queueSeries: this.queueHistory.map(series),
      cohortSpeedSeries: Object.fromEntries(
        COHORTS.map((c, i) => [c, series(this.cohortSpeed[i])]),
      ) as Record<Cohort, TimeSeries>,
      queues: this.queues.slice(),
      maxQueues: this.maxQueues.slice(),
      events: [...this.events],
      config: structuredClone(this.config),
      finished,
    };
  }
}
