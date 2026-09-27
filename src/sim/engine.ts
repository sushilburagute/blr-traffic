import { loadNetwork, projectOffset, offsetAt } from './network';
import { validateScenarioNetwork } from './network/validate';
import { RNG } from './rng';
import { Vehicles, LANES_PER_SEGMENT } from './vehicles';
import { TYPE_PARAMS, BEHAVIOUR_PARAMS } from './params';
import { idm } from './models/idm';
import { mobil } from './models/mobil';
import { canUseVirtual, squeezeState } from './models/squeeze';
import { canFilter } from './models/filtering';
import { signalState } from './signals';
import { createObstacles } from './obstacles';
import { rainFactors } from './environment';
import { demandRates } from './demand';
import { affects, disruptionSection, isActive } from './disruptions';
import { physicalLanes, laneAllowed } from './infra';
import { StatsCollector } from './stats';
import {
  VEHICLE_TYPES,
  PROFILES,
  type NetworkData,
  type ScenarioConfig,
  type Disruption,
  type ObstacleSpec,
  type EncroachmentSpec,
} from './types';
export const DT = 0.1;
/** How far past a flyover's split point a through vehicle keeps trying to get onto the ramp. */
const FLYOVER_WINDOW_M = 60;
/** Hardest physically plausible braking, m/s² (IDM is clamped to the same value). */
const B_MAX = 8.5;
/** A bus stops changing lanes (other than toward the kerb) this far before a stop it will serve. */
const BUS_STOP_APPROACH_M = 400;
/** Lane-change cooldown while a bus works its way to the kerb (s). */
const BUS_PULL_COOLDOWN_S = 1;
/** Within this distance of its stop a bus still outside the kerb lane serves the stop from the next lane. */
const BUS_FALLBACK_M = 30;
/** How far ahead of a segment's end a vehicle looks into the next segment for its leader. */
const LOOKAHEAD_M = 250;
/** Per-step relaxation of the drawn lateral position toward the lane (τ = 0.6 s two-wheelers, 0.8 s others). */
const LATERAL_RELAX = TYPE_PARAMS.map((_, t) => 1 - Math.exp(-DT / (t === 0 ? 0.6 : 0.8)));
/**
 * Drawn lateral speed limits (m/s) and lateral acceleration limit (m/s²), so a lane change eases in rather
 * than starting at full lateral speed (the drawn heading follows the lateral speed).
 */
const LATERAL_SPEED = TYPE_PARAMS.map((_, t) => (t === 0 ? 2 : 1.5)),
  LATERAL_ACCEL = 3;
/**
 * A vehicle can only move sideways by steering while it rolls forward: lateral speed is also capped at
 * a creep speed plus a steering angle's share of forward speed, so near-stationary vehicles edge across
 * slowly instead of sliding sideways (two-wheelers lean in more sharply).
 */
const LATERAL_CREEP = 0.4,
  LATERAL_STEER = TYPE_PARAMS.map((_, t) => (t === 0 ? 0.45 : 0.25));
/** No leader in range: gap reported to IDM. */
const FREE_GAP = 10000;
/**
 * Right of way where feeders merge. A flyover landing and the at-grade road rejoin zip-fashion: neither gives
 * way, because at-grade traffic released by the signal forces its way in alongside the landing traffic, as it
 * does on the ORR (see plan/implementation-notes.md, Calibration). On-ramps give way to both.
 */
const MERGE_PRIORITY = { flyover: 1, main: 1, ramp: 0 } as const;
/** Zip merge: spacing to a vehicle on the other feeder is relaxed by MERGE_EASE per metre beyond MERGE_EASE_M. */
const MERGE_EASE = 0.3,
  MERGE_EASE_M = 20;
interface Arrival {
  type: number;
  profile: number;
  exit: number;
  through: boolean;
  roll: number;
  bus: boolean;
  turned?: boolean;
}
interface Constraint {
  cap: number;
  stop: number;
  pressure: number;
}
export function createEngine(network: NetworkData, config: ScenarioConfig) {
  return new Engine(network, config);
}
export class Engine {
  readonly config: ScenarioConfig;
  readonly replayConfig: ScenarioConfig;
  private eventCursor = 0;
  private readonly scheduledEvents: NonNullable<ScenarioConfig['liveEvents']>;
  readonly graph;
  readonly vehicles: Vehicles;
  readonly stats: StatsCollector;
  readonly obstacles: ObstacleSpec[];
  readonly lanes: number[];
  readonly effectiveLanes: number[];
  readonly squeeze: boolean[];
  readonly signals: Uint8Array;
  readonly next: Int16Array;
  readonly approaches: Int16Array;
  readonly bypasses: Int16Array;
  private weather = rainFactors(false);
  private readonly speedCaps: Float32Array;
  readonly rates: number[][];
  readonly spawnRng: RNG;
  readonly behaviourRng: RNG;
  readonly incidentRng: RNG;
  readonly encounterRng: RNG;
  readonly queue: Arrival[][];
  readonly profiles;
  readonly obstacleBySegment: ObstacleSpec[][];
  readonly activeDisruptions: Disruption[][];
  readonly brokenUntil: Float64Array;
  readonly brokenGate: Uint8Array;
  ticks = 0;
  arrived = 0;
  spawned = 0;
  private nextDemandTick = 0;
  private nextIncidentTick = 0;
  private readonly nextGap: Float32Array;
  private readonly nextDV: Float32Array;
  /** Per segment, per obstacle: bit mask of the lanes it covers. */
  private readonly obstacleLaneMask: Uint32Array[];
  private readonly encroachmentBySegment: EncroachmentSpec[][];
  /** Per segment: indices into `config.infra.busStops`. */
  private readonly busStopsBySegment: number[][];
  /** Junction index of each segment's downstream end. */
  private readonly toJunctionIndex: Int16Array;
  /** Segments whose kerb lane floods in heavy rain (Iblur / Bellandur approaches). */
  private readonly floodProne: Uint8Array;
  /** Segments that have a flyover bypass (candidates for transferToFlyovers). */
  private readonly bypassed: number[];
  /** Perception delay (ticks) per behaviour profile. */
  private readonly profileDelay: Int32Array;
  /** Scratch constraint results, reused every call to avoid allocation. */
  private readonly current: Constraint = { cap: 0, stop: 0, pressure: 0 };
  private readonly target: Constraint = { cap: 0, stop: 0, pressure: 0 };
  private readonly transferCandidates: number[] = [];
  /** Fixed lane width per segment (widthM / physical lanes); squeeze never re-lays the road out. */
  private readonly laneWidth: Float32Array;
  /** Per segment: the segments (main, flyover, ramp) that flow into it. */
  private readonly feeders: number[][];
  /** Per segment: 1 when a higher-priority feeder joins the same downstream segment. */
  private readonly yields: Uint8Array;
  /** Speed of the leader found by the last `gapAhead` call (own speed when there is none). */
  private aheadSpeed = 0;
  /** Relative speed to whatever bounds the gap returned by the last `perceive` call. */
  private perceivedDV = 0;
  /** Whether the gap returned by the last `perceive` call is to a vehicle beyond the segment end. */
  private perceivedAhead = false;
  /** Per vehicle: this step's gap is to a vehicle beyond the segment end (see integration). */
  private readonly gapIsAhead: Uint8Array;
  private readonly point = new Float64Array(3);
  constructor(
    readonly network: NetworkData,
    config: ScenarioConfig,
  ) {
    validateScenarioNetwork(network, config);
    this.config = structuredClone(config);
    this.replayConfig = structuredClone(config);
    this.scheduledEvents = [...(config.liveEvents ?? [])].sort((a, b) => a.tick - b.tick);
    this.graph = loadNetwork(network);
    this.vehicles = new Vehicles(network.segments.length);
    this.stats = new StatsCollector(network, this.config);
    this.obstacles = createObstacles(network, this.config);
    this.lanes = network.segments.map((s) => physicalLanes(s, config));
    this.effectiveLanes = [...this.lanes];
    this.squeeze = network.segments.map(() => false);
    this.signals = new Uint8Array(network.junctions.length * 2);
    this.next = new Int16Array(network.segments.length);
    this.approaches = Int16Array.from(network.segments.map((_, i) => this.graph.approachOf(i)));
    this.bypasses = Int16Array.from(
      network.segments.map((s) => network.segments.findIndex((b) => b.bypassFor === s.id)),
    );
    this.speedCaps = Float32Array.from(
      network.segments.map((s) => Math.min(s.speedLimitKmh, config.infra.speedLimitKmh) / 3.6),
    );
    this.weather = rainFactors(config.environment.rain);
    this.next.fill(-1);
    for (let i = 0; i < network.segments.length; i++) {
      const s = network.segments[i];
      const next = network.segments.findIndex(
        (n) => n.kind === 'main' && n.direction === s.direction && n.fromJunction === s.toJunction,
      );
      this.next[i] = next;
    }
    const rng = new RNG(config.seed);
    this.spawnRng = rng.fork('spawn');
    this.behaviourRng = rng.fork('behaviour');
    this.incidentRng = rng.fork('disruptions');
    this.encounterRng = rng.fork('obstacle-encounters');
    this.rates = demandRates(network, this.config);
    this.queue = network.sources.map(() => []);
    this.profiles = PROFILES.map((p, i) => ({ ...BEHAVIOUR_PARAMS[i], ...config.behaviour[p] }));
    this.obstacleBySegment = network.segments.map((s) =>
      this.obstacles.filter((o) => o.segmentId === s.id),
    );
    this.activeDisruptions = network.segments.map(() => []);
    this.brokenUntil = new Float64Array(network.junctions.length);
    this.brokenGate = new Uint8Array(network.junctions.length);
    this.nextGap = new Float32Array(this.vehicles.capacity);
    this.nextDV = new Float32Array(this.vehicles.capacity);
    this.gapIsAhead = new Uint8Array(this.vehicles.capacity);
    this.obstacleLaneMask = this.obstacleBySegment.map((list) =>
      Uint32Array.from(list, (o) => o.lanes.reduce((m, l) => m | (1 << l), 0)),
    );
    this.encroachmentBySegment = network.segments.map((s) =>
      this.config.infra.encroachment.filter((e) => e.segmentId === s.id),
    );
    this.busStopsBySegment = network.segments.map(() => []);
    this.config.infra.busStops.forEach((b, i) =>
      this.busStopsBySegment[this.graph.byId.get(b.segmentId)!].push(i),
    );
    this.toJunctionIndex = Int16Array.from(network.segments, (s) =>
      network.junctions.findIndex((j) => j.id === s.toJunction),
    );
    this.floodProne = Uint8Array.from(network.segments, (s) =>
      Number(s.kind === 'main' && (s.toJunction === 'iblur' || s.toJunction === 'bellandur')),
    );
    this.bypassed = [];
    for (let i = 0; i < network.segments.length; i++)
      if (this.bypasses[i] >= 0) this.bypassed.push(i);
    this.profileDelay = Int32Array.from(this.profiles, (b) =>
      Math.min(10, Math.round(b.reactionTime / DT)),
    );
    this.laneWidth = Float32Array.from(network.segments, (s, i) => s.widthM / this.lanes[i]);
    this.feeders = network.segments.map(() => []);
    for (let i = 0; i < network.segments.length; i++)
      if (this.next[i] >= 0) this.feeders[this.next[i]].push(i);
    this.yields = Uint8Array.from(network.segments, (s, i) =>
      Number(
        this.next[i] >= 0 &&
          this.feeders[this.next[i]].some(
            (f) => MERGE_PRIORITY[network.segments[f].kind] > MERGE_PRIORITY[s.kind],
          ),
      ),
    );
    this.stats.events.push(
      ...config.disruptions.map((d) => ({ simTime: d.startMin * 60, label: d.type })),
    );
    if (config.environment.rain) this.stats.events.push({ simTime: 0, label: 'Rain on' });
  }
  get time() {
    return this.ticks * DT;
  }
  get finished() {
    return this.ticks >= Math.round((this.config.durationMin * 60) / DT);
  }
  get unservedDemand() {
    return this.arrived - this.spawned;
  }
  setRain(on: boolean, intensity: 0 | 1 | 2 = 1, record = true) {
    if (record)
      (this.replayConfig.liveEvents ??= []).push({ tick: this.ticks, kind: 'rain', on, intensity });
    this.weather = rainFactors(on);
    this.config.environment.rain = on;
    this.config.environment.rainIntensity = on ? intensity : 0;
    this.stats.events.push({ simTime: this.time, label: on ? 'Rain on' : 'Rain off' });
  }
  addDisruption(d: Disruption, record = true) {
    if (record)
      (this.replayConfig.liveEvents ??= []).push({
        tick: this.ticks,
        kind: 'disruption',
        disruption: structuredClone(d),
      });
    this.config.disruptions.push(structuredClone(d));
    this.stats.events.push({ simTime: Math.max(this.time, d.startMin * 60), label: d.type });
    this.nextIncidentTick = 0;
  }
  report() {
    const stats = this.stats.report(this.vehicles, this.time, this.unservedDemand, this.finished);
    stats.config = structuredClone(this.replayConfig);
    return stats;
  }
  /**
   * Lateral offset (metres, positive to the right of travel) of a logical lane, fractional while filtering.
   * Lane width is fixed, so the virtual squeeze lane (index `lanes`) sits on the shoulder beyond the kerb.
   */
  lateralTarget(segment: number, lane: number) {
    return ((this.lanes[segment] - 1) / 2 - lane) * this.laneWidth[segment];
  }
  /** Lane a vehicle in `lane` of `seg` enters on `next`: ramps feed the kerb lane (highest index). */
  private entryLane(id: number, seg: number, next: number, lane: number) {
    const v = this.vehicles,
      lanes = this.lanes[next];
    let entry = this.network.segments[seg].kind === 'ramp' ? lanes - 1 : Math.min(lane, lanes - 1);
    if (
      !laneAllowed(v.type[id], entry, lanes, this.config.infra.busLane, Boolean(v.busAllowed[id]))
    )
      entry = Math.max(0, entry - 1);
    return entry;
  }
  /**
   * Gap to the first vehicle the given vehicle will meet beyond the end of `seg` in the lane it will enter
   * (FREE_GAP when it leaves the network there or nothing is within LOOKAHEAD_M). Where a flyover and the
   * at-grade road rejoin, the two feeders are merged zip-fashion: a vehicle on the other feeder that is
   * closer to the merge point, heading for the same lane and not held by a signal counts as a leader.
   */
  private gapAhead(id: number, seg: number, lane: number, position: number) {
    const v = this.vehicles,
      length = this.network.segments[seg].lengthM,
      next = this.next[seg],
      toEnd = length - position;
    this.aheadSpeed = v.v[id];
    if (toEnd > LOOKAHEAD_M || next < 0 || v.exitJunction[id] === this.toJunctionIndex[seg])
      return FREE_GAP;
    const entry = this.entryLane(id, seg, next, lane);
    const list = v.laneIndex[next * LANES_PER_SEGMENT + entry];
    let gap = FREE_GAP;
    if (list.length) {
      const leader = list[0];
      this.aheadSpeed = v.v[leader];
      gap = toEnd + v.s[leader] - TYPE_PARAMS[v.type[leader]].length;
    }
    const priority = MERGE_PRIORITY[this.network.segments[seg].kind];
    if (priority === 0) return gap;
    const feeders = this.feeders[next];
    for (let f = 0; f < feeders.length; f++) {
      const up = feeders[f];
      if (up === seg) continue;
      const kind = this.network.segments[up].kind,
        upLength = this.network.segments[up].lengthM,
        signalled = kind === 'main' && this.signals[this.approaches[up]] !== 2;
      for (let l = 0; l < 6; l++) {
        const others = v.laneIndex[up * LANES_PER_SEGMENT + l];
        if (!others.length || v.s[others[others.length - 1]] <= upLength - toEnd) continue;
        v.locate(up, l, upLength - toEnd + 1e-3);
        for (
          let k = v.foundLeader < 0 ? others.length : v.lanePosition[v.foundLeader];
          k < others.length;
          k++
        ) {
          const u = others[k];
          if (v.exitJunction[u] === this.toJunctionIndex[up]) continue;
          if (signalled && !v.committed[u] && v.s[u] < upLength - 2) continue;
          // A lower-priority vehicle waiting to give way is not merging yet.
          if (MERGE_PRIORITY[kind] < priority && v.v[u] < 1) continue;
          if (this.entryLane(u, up, next, l) !== entry) break;
          // Far from the merge only a gentle adjustment is needed: the required spacing tightens to the
          // real one over the last MERGE_EASE_M.
          const g =
            toEnd -
            (upLength - v.s[u]) -
            TYPE_PARAMS[v.type[u]].length +
            MERGE_EASE * Math.max(0, toEnd - MERGE_EASE_M);
          if (g < gap) {
            gap = g;
            this.aheadSpeed = v.v[u];
          }
          break;
        }
      }
    }
    return gap;
  }
  /** Current (undelayed) gap in the vehicle's own lane, bounded by the stop distance; sets perceivedDV. */
  private perceive(id: number, stop: number) {
    const v = this.vehicles,
      leader = v.leader(id);
    let gap: number, dv: number;
    this.perceivedAhead = false;
    if (leader >= 0) {
      gap = v.gap(id, leader);
      dv = v.v[id] - v.v[leader];
    } else if (stop <= this.network.segments[v.segment[id]].lengthM - v.s[id]) {
      // Stopping before the segment end anyway (signal, give-way, stop): whatever is beyond is irrelevant.
      gap = FREE_GAP;
      dv = 0;
    } else {
      gap = this.gapAhead(id, v.segment[id], v.lane[id], v.s[id]);
      dv = v.v[id] - this.aheadSpeed;
      this.perceivedAhead = gap < FREE_GAP;
    }
    if (stop <= gap) {
      gap = stop;
      dv = v.v[id];
      this.perceivedAhead = false;
    }
    this.perceivedDV = dv;
    return gap;
  }
  /**
   * Signal state at a segment's stop line. Ramps are the cross-road entries at a junction: they turn in
   * while the main approach into the same junction and direction is held on red, and wait otherwise.
   */
  private signalFor(seg: number): number {
    const state = this.signals[this.approaches[seg]];
    return this.network.segments[seg].kind === 'ramp' ? (state === 0 ? 2 : 0) : state;
  }
  /** Keeps the drawn position continuous when a vehicle moves from (seg, s) to (next, nextS). */
  private carryLateral(id: number, seg: number, s: number, next: number, nextS: number) {
    const v = this.vehicles,
      p = this.point;
    if (v.latM[id] !== v.latM[id]) return; // not drawn yet; initialised by the lateral update
    projectOffset(this.network.segments[seg], v.latM[id], s, p);
    v.latM[id] = offsetAt(this.network.segments[next], nextS, p[0], p[1]);
  }
  /**
   * Stop distance for a vehicle that must give way where its segment merges into the next one (FREE_GAP
   * when it may go): side-road ramps yield to the main road and flyover (which zip-merge with each other, see
   * MERGE_PRIORITY), for vehicles about to pass the merge point in the lane it will join. A vehicle that can
   * no longer stop comfortably keeps going.
   */
  private giveWay(id: number, seg: number, lane: number, position: number) {
    const v = this.vehicles,
      next = this.next[seg];
    if (next < 0 || !this.yields[seg] || v.exitJunction[id] === this.toJunctionIndex[seg])
      return FREE_GAP;
    const priority = MERGE_PRIORITY[this.network.segments[seg].kind];
    // A yielding at-grade road would wait at its stop line; a ramp waits at its end.
    const dist = this.network.segments[seg].lengthM - (priority === 1 ? 2 : 0) - position,
      type = TYPE_PARAMS[v.type[id]];
    if (dist <= 0 || v.v[id] * v.v[id] > type.b * Math.max(0, dist - 0.3)) return FREE_GAP;
    const entry = this.entryLane(id, seg, next, lane),
      last = this.lanes[next] - 1;
    for (const up of this.feeders[next]) {
      const upSegment = this.network.segments[up];
      if (MERGE_PRIORITY[upSegment.kind] <= priority) continue;
      const held = upSegment.kind === 'main' && this.signals[this.approaches[up]] !== 2;
      for (let l = 0; l < 6; l++) {
        if (Math.min(l, last) !== entry) continue;
        const list = v.laneIndex[up * LANES_PER_SEGMENT + l];
        for (let k = list.length - 1; k >= 0; k--) {
          const u = list[k],
            toMerge = upSegment.lengthM - v.s[u];
          if (toMerge > 5 + (2.5 * upSegment.speedLimitKmh) / 3.6) break;
          if (v.exitJunction[u] === this.toJunctionIndex[up]) continue;
          if (held && !v.committed[u] && toMerge > 2) break;
          if (toMerge < 5 + 2.5 * v.v[u]) return dist;
        }
      }
    }
    return FREE_GAP;
  }
  /** A bus approaching (within BUS_STOP_APPROACH_M) or dwelling at a stop it has not yet served. */
  private servingStop(id: number) {
    const v = this.vehicles;
    if (v.type[id] !== 4) return false;
    if (v.dwellUntil[id] > 0) return true;
    const stops = this.busStopsBySegment[v.segment[id]],
      position = v.s[id];
    for (let k = 0; k < stops.length; k++) {
      const i = stops[k],
        b = this.config.infra.busStops[i];
      if (v.servedStop[id] !== i && position <= b.s + 5 && b.s - position < BUS_STOP_APPROACH_M)
        return true;
    }
    return false;
  }
  private demand() {
    const minute = Math.min(this.rates.length - 1, Math.floor(this.time / 60)),
      rain = this.config.environment.rain;
    const mix = VEHICLE_TYPES.map((t) => this.config.demand.mix[t]);
    if (rain) {
      const shift = Math.min(mix[0], mix.reduce((a, b) => a + b, 0) * 0.1);
      mix[0] -= shift;
      mix[3] += shift;
    }
    const profileMix = PROFILES.map((p) => this.config.demand.behaviourMix[p]);
    const [userType, userProfile] = this.config.userCohort.split(':');
    const ut = VEHICLE_TYPES.indexOf(userType as (typeof VEHICLE_TYPES)[number]),
      up = PROFILES.indexOf(userProfile as (typeof PROFILES)[number]);
    const cohortShare =
      ((mix[ut] / mix.reduce((a, b) => a + b, 0)) * profileMix[up]) /
      profileMix.reduce((a, b) => a + b, 0);
    const boost = Math.max(0, (0.08 - cohortShare) / (1 - cohortShare || 1));
    this.network.sources.forEach((source, index) => {
      let rate = this.rates[minute][index] * (rain ? 1.1 : 1);
      for (const p of this.config.demand.pulses)
        if (
          p.sourceId === source.id &&
          this.time >= p.startMin * 60 &&
          this.time < (p.startMin + p.durationMin) * 60
        )
          rate += p.vehPerHour;
      for (const d of this.config.disruptions)
        if (
          d.type === 'event' &&
          isActive(d, this.time) &&
          (d.params.sourceId === source.id || d.junctionId === source.junctionId)
        )
          rate += d.params.vehPerHour ?? 1200;
      const n = this.spawnRng.poisson(rate / 3600);
      this.arrived += n;
      for (let k = 0; k < n; k++) {
        const selected = this.spawnRng.next() < boost;
        const type = selected ? ut : this.spawnRng.pick(mix),
          profile = selected ? up : this.spawnRng.pick(profileMix);
        const segment = this.network.segments[this.graph.byId.get(source.segmentId)!];
        const start = this.network.junctions.findIndex((j) => j.id === segment.fromJunction);
        const dir = segment.direction === 'toMarathahalli' ? 1 : -1;
        let end = dir === 1 ? 5 : 0;
        let through = source.endToEnd;
        if (!through) {
          const steps = dir === 1 ? 5 - start : start;
          end = start + dir * (1 + Math.floor(this.spawnRng.next() * Math.max(1, steps)));
        }
        const od = this.config.demand.od?.[index];
        if (od && od.some((x) => x > 0)) {
          const sink = this.network.sinks[this.spawnRng.pick(od)];
          if (sink) {
            const target = this.network.junctions.findIndex((j) => j.id === sink.junctionId);
            if ((target - start) * dir > 0) end = target;
          }
          through = source.endToEnd && end === (dir === 1 ? 5 : 0);
        }
        // Bound queued objects; rejected excess remains counted as unserved demand.
        if (this.queue[index].length < 5000)
          this.queue[index].push({
            type,
            profile,
            exit: end,
            through,
            roll: this.spawnRng.next(),
            bus: this.spawnRng.next() < this.profiles[profile].busLaneViolationProb,
          });
      }
    });
  }
  private spawn() {
    const v = this.vehicles;
    this.network.sources.forEach((source, i) => {
      const arrival = this.queue[i][0];
      if (!arrival) return;
      // Everyone enters at grade; through traffic climbs onto a flyover at its split point (see transferToFlyovers).
      const seg = this.graph.byId.get(source.segmentId)!;
      let best = -1,
        bestGap = -1,
        entrySpeed = 0;
      for (let lane = 0; lane < this.lanes[seg]; lane++) {
        if (
          !laneAllowed(arrival.type, lane, this.lanes[seg], this.config.infra.busLane, arrival.bus)
        )
          continue;
        const leader = v.laneIndex[seg * LANES_PER_SEGMENT + lane][0] ?? -1;
        const gap = leader < 0 ? 10000 : v.s[leader] - TYPE_PARAMS[v.type[leader]].length;
        const p = TYPE_PARAMS[arrival.type],
          speed = Math.min(p.vMax, this.speedCaps[seg]) * this.weather.speed;
        const entering = leader < 0 ? speed : Math.min(speed, v.v[leader]);
        if (gap > p.s0 + Math.max(3, p.T * entering * this.weather.headway) && gap > bestGap) {
          best = lane;
          bestGap = gap;
          entrySpeed = entering;
        }
      }
      if (best < 0) return;
      const id = v.spawn(seg, best, arrival.type, arrival.profile, this.time);
      if (id < 0) return;
      v.v[id] = entrySpeed;
      v.latM[id] = this.lateralTarget(seg, best);
      v.gapHistory.fill(bestGap, id * 11, id * 11 + 11);
      v.exitJunction[id] = arrival.exit;
      v.through[id] = Number(arrival.through);
      v.hasTurned[id] = Number(arrival.turned ?? false);
      v.signalRoll[id] = arrival.roll;
      v.busAllowed[id] = Number(arrival.bus);
      v.flags[id] =
        `${VEHICLE_TYPES[arrival.type]}:${PROFILES[arrival.profile]}` === this.config.userCohort
          ? 8
          : 0;
      this.queue[i].shift();
      this.spawned++;
    });
  }
  private updateFeatures() {
    const v = this.vehicles;
    for (let i = 0; i < this.network.segments.length; i++) {
      const s = this.network.segments[i];
      const count = this.lanes[i] + 1;
      let present = 0,
        cutters = 0;
      for (let lane = 0; lane < count; lane++)
        for (const id of v.laneIndex[i * LANES_PER_SEGMENT + lane]) {
          present++;
          if (v.profile[id] !== 0) cutters++;
        }
      let width = this.lanes[i] * 3.5;
      for (const e of this.encroachmentBySegment[i])
        width -= (e.widthReductionM * e.lengthM) / s.lengthM;
      this.squeeze[i] =
        s.kind === 'main' &&
        squeezeState(
          this.squeeze[i],
          this.config.squeeze.enabled,
          present / (s.lengthM / 1000),
          this.config.squeeze.densityThreshold,
          cutters / Math.max(1, present),
        );
      this.effectiveLanes[i] = Math.max(1, Math.floor(width / 3.5)) + (this.squeeze[i] ? 1 : 0);
      this.activeDisruptions[i] = this.config.disruptions.filter(
        (d) => isActive(d, this.time) && affects(d, s),
      );
    }
    for (let j = 0; j < this.network.junctions.length; j++) {
      const junction = this.network.junctions[j];
      const broken = this.config.disruptions.some(
        (d) => d.type === 'brokenSignal' && d.junctionId === junction.id && isActive(d, this.time),
      );
      if (broken && this.time >= this.brokenUntil[j]) {
        this.brokenGate[j] = 1 - this.brokenGate[j];
        this.brokenUntil[j] = this.time + this.incidentRng.range(2, 6);
      }
      for (let a = 0; a < 2; a++)
        this.signals[j * 2 + a] = broken
          ? a === this.brokenGate[j]
            ? 2
            : 0
          : signalState(this.config.infra.signals[junction.id], this.time, a);
    }
  }
  /**
   * Through vehicles climb onto an enabled flyover when they pass its split point (the bypass covers only the
   * final stretch of the link). If the ramp is blocked they keep rolling at grade and retry within a short
   * window; past it they are committed to the signal like everyone else.
   */
  private transferToFlyovers() {
    const v = this.vehicles,
      candidates = this.transferCandidates;
    // Only lanes of segments with an enabled bypass can hold candidates; process them in the same
    // (descending active-index) order a full scan of `active` would.
    candidates.length = 0;
    for (const seg of this.bypassed) {
      const s = this.network.segments[seg];
      if (!this.config.infra.flyovers[s.toJunction]) continue;
      const start = s.lengthM - this.network.segments[this.bypasses[seg]].lengthM;
      for (let lane = 0; lane < 6; lane++)
        for (const id of v.laneIndex[seg * LANES_PER_SEGMENT + lane]) {
          const offset = v.s[id] - start;
          if (v.through[id] && offset >= 0 && offset <= FLYOVER_WINDOW_M) candidates.push(id);
        }
    }
    if (candidates.length > 1) candidates.sort((a, b) => v.activeIndex[b] - v.activeIndex[a]);
    for (const id of candidates) {
      const seg = v.segment[id],
        bypass = this.bypasses[seg];
      const s = this.network.segments[seg],
        f = this.network.segments[bypass];
      const offset = v.s[id] - (s.lengthM - f.lengthM);
      const lane = Math.min(v.lane[id], this.lanes[bypass] - 1);
      v.locate(bypass, lane, offset);
      const leader = v.foundLeader,
        follower = v.foundFollower;
      const p = TYPE_PARAMS[v.type[id]];
      if (
        leader >= 0 &&
        v.s[leader] - TYPE_PARAMS[v.type[leader]].length - offset < p.s0 + p.T * v.v[id]
      )
        continue;
      if (follower >= 0) {
        const q = TYPE_PARAMS[v.type[follower]];
        if (offset - p.length - v.s[follower] < q.s0 + q.T * v.v[follower]) continue;
      }
      this.carryLateral(id, seg, v.s[id], bypass, offset);
      v.removeIndex(id);
      v.segment[id] = bypass;
      v.lane[id] = lane;
      v.s[id] = offset;
      v.flags[id] &= ~6;
      v.committed[id] = 0;
      v.insert(id);
      v.gapHistory.fill(10000, id * 11, id * 11 + 11);
    }
  }
  /**
   * Lane-change pressure a vehicle feels in `lane` because it is the wrong lane for its route: a through
   * vehicle outside the flyover lanes approaching the split, or one exiting at the next junction outside the
   * kerb lane. Zero in a lane that suits the route.
   */
  private constraints(id: number, lane: number, out: Constraint) {
    const v = this.vehicles,
      seg = v.segment[id],
      s = this.network.segments[seg],
      position = v.s[id],
      p = this.profiles[v.profile[id]],
      rain = this.weather;
    let cap = this.speedCaps[seg] * rain.speed * (this.squeeze[seg] ? 0.85 : 1),
      stop = 10000,
      pressure = 0;
    const filtering = Boolean(v.flags[id] & 2);
    if (lane >= this.lanes[seg])
      cap = Math.min(cap, this.config.squeeze.virtualLaneSpeedCapKmh / 3.6);
    if (filtering) cap = Math.min(cap, 15 / 3.6);
    const state = this.signalFor(seg);
    // The stop line is 2 m before the segment end; once past it a vehicle carries on.
    if (s.kind !== 'flyover' && position < s.lengthM - 2) {
      if (state === 2) v.committed[id] = 0;
      else if (!v.committed[id]) {
        const dist = s.lengthM - 2 - position,
          speed = v.v[id],
          b = TYPE_PARAMS[v.type[id]].b;
        // Dilemma zone: on amber, a driver who cannot stop comfortably goes; on red, only one who would need
        // an emergency stop (or who runs reds anyway). Either decision holds until the line is crossed, so a
        // vehicle let through on amber is never stopped dead when the light turns red.
        // An amber runner commits once it can reach the line within about the amber time.
        const runsAmber = state === 1 && v.signalRoll[id] < p.amberRunProb;
        if (
          state === 1
            ? speed * speed > 2 * b * dist || (runsAmber && dist < 3 * speed + 5)
            : speed * speed > 4 * b * dist || v.signalRoll[id] < p.redRunProb
        )
          v.committed[id] = 1;
        else if (!runsAmber) stop = dist;
      }
    }
    const obstacles = this.obstacleBySegment[seg],
      masks = this.obstacleLaneMask[seg];
    for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++)
      if ((masks[obstacleIndex] >>> lane) & 1 && lane < 32) {
        const o = obstacles[obstacleIndex];
        const delta = o.s - position;
        const radius = o.type === 'pothole' ? 8 : 5;
        if (delta >= -radius && delta < 60) {
          if (
            lane === v.lane[id] &&
            o.type === 'pothole' &&
            v.obstacleEncounter[id] !== seg * 100 + obstacleIndex
          ) {
            v.obstacleEncounter[id] = seg * 100 + obstacleIndex;
            v.obstacleMissed[id] = Number(
              this.config.environment.rain && this.encounterRng.next() < 0.5,
            );
          }
          if (
            o.type === 'pothole' &&
            v.obstacleMissed[id] &&
            v.obstacleEncounter[id] === seg * 100 + obstacleIndex &&
            delta > radius + v.v[id] * p.reactionTime * 0.5
          )
            continue;
          const local = (o.speedCapKmh / 3.6) * rain.obstacle;
          cap = Math.min(
            cap,
            Math.sqrt(local * local + 2 * TYPE_PARAMS[v.type[id]].b * Math.max(0, delta - radius)),
          );
          if (o.type === 'pothole') pressure = Math.max(pressure, 1 - delta / 60);
        }
      }
    for (const d of this.activeDisruptions[seg]) {
      if (d.type === 'event' || d.type === 'brokenSignal') continue;
      const section = disruptionSection(d, s);
      if (position > section.end) continue;
      const dist = section.start - position;
      const blocked =
        d.type === 'closure' ? this.effectiveLanes[seg] : (d.params.lanesBlocked ?? 1);
      const first = this.lanes[seg] - blocked;
      if (lane >= first) {
        stop = Math.min(stop, Math.max(0, dist - 2));
        pressure = Math.max(pressure, Math.max(0, 3 - dist / 60));
      } else if (dist < 100) cap = Math.min(cap, (d.type === 'waterlogging' ? 20 : 25) / 3.6);
    }
    if (
      this.config.environment.rain &&
      this.config.environment.rainIntensity === 2 &&
      this.floodProne[seg]
    ) {
      const dist = s.lengthM - 120 - position;
      if (position < s.lengthM - 20) {
        // Stop short of the flooded kerb lane; a vehicle already in it wades out (capped) instead of freezing.
        if (lane === this.lanes[seg] - 1) {
          if (dist >= 0) stop = Math.min(stop, dist);
          pressure = Math.max(pressure, 2 - dist / 60);
        }
        if (dist < 100) cap = Math.min(cap, 20 / 3.6);
      }
    }
    for (const e of this.encroachmentBySegment[seg])
      if (
        position < e.s + e.lengthM &&
        lane >= Math.max(1, this.lanes[seg] - Math.ceil(e.widthReductionM / 3.5))
      ) {
        stop = Math.min(stop, Math.max(0, e.s - position - 2));
        pressure = Math.max(pressure, 3 - (e.s - position) / 60);
      }
    if (v.type[id] === 4) {
      const stops = this.busStopsBySegment[seg],
        kerb = this.lanes[seg] - 1,
        bus = TYPE_PARAMS[4];
      for (let k = 0; k < stops.length; k++) {
        const i = stops[k],
          b = this.config.infra.busStops[i];
        if (v.servedStop[id] === i || position > b.s + 5) continue;
        const dist = b.s - position,
          dwelling = v.dwellUntil[id] > 0;
        if (dist < BUS_STOP_APPROACH_M && lane !== kerb) pressure = Math.max(pressure, 1);
        // Blocked out of the kerb lane by a standing queue, a bus stops in the next lane out instead.
        if (lane !== kerb && !(lane === kerb - 1 && lane === v.lane[id] && dist < BUS_FALLBACK_M))
          continue;
        // Reached the kerb lane too late to pull in without an emergency stop: the stop is missed.
        if (!dwelling && v.v[id] * v.v[id] > B_MAX * Math.max(0, dist + bus.s0 - 0.2)) continue;
        // IDM comes to rest s0 short of a standing obstacle, so the virtual one sits s0 past the stop.
        stop = Math.min(stop, Math.max(0, dist + bus.s0));
        if (lane === v.lane[id] && dist < 2 && v.v[id] < 0.5) {
          if (!dwelling) v.dwellUntil[id] = Math.max(this.time + b.dwellS, 1e-3);
          else if (this.time >= v.dwellUntil[id]) {
            v.servedStop[id] = i;
            v.dwellUntil[id] = 0;
          }
        }
      }
    }
    if (this.yields[seg] && s.lengthM - position < LOOKAHEAD_M)
      stop = Math.min(stop, this.giveWay(id, seg, lane, position));
    // Courtesy: hold back behind a bus just ahead in the next lane toward the median that is working its way
    // across to the kerb for its stop, so it can get in.
    if (
      this.busStopsBySegment[seg].length &&
      lane > 0 &&
      lane < this.lanes[seg] &&
      v.type[id] !== 4 &&
      !filtering
    ) {
      v.locate(seg, lane - 1, position);
      const bus = v.foundLeader;
      if (bus >= 0 && v.type[bus] === 4 && this.servingStop(bus)) {
        const rear = v.s[bus] - TYPE_PARAMS[4].length - position;
        if (rear < 30) {
          if (rear > 1 && v.v[id] * v.v[id] < 2 * TYPE_PARAMS[v.type[id]].b * rear)
            stop = Math.min(stop, rear);
          // Alongside, or too close to hold back comfortably: ease off so the bus draws ahead.
          else cap = Math.min(cap, Math.max(0.5, Math.min(v.v[bus] - 2, v.v[id] * 0.9)));
        }
      }
    }
    if (this.config.infra.uTurns[s.toJunction] && s.lengthM - position < 100) cap *= 0.85;
    if (
      lane >= this.effectiveLanes[seg] ||
      !laneAllowed(
        v.type[id],
        lane,
        this.lanes[seg],
        this.config.infra.busLane,
        Boolean(v.busAllowed[id]),
      )
    )
      pressure += 5;
    out.cap = cap;
    out.stop = stop;
    out.pressure = pressure;
    return out;
  }
  private changeLane(id: number, currentA: number, current: Constraint) {
    const v = this.vehicles,
      seg = v.segment[id],
      lane = v.lane[id],
      type = TYPE_PARAMS[v.type[id]],
      p = this.profiles[v.profile[id]],
      position = v.s[id],
      rain = this.weather;
    // A bus heading for (or standing at) its stop only ever moves toward the kerb.
    if (v.type[id] === 4 && this.servingStop(id)) return this.pullToKerb(id);
    const oldLeader = v.leader(id),
      oldGap = v.gap(id, oldLeader);
    if (
      !(v.flags[id] & 2) &&
      oldLeader >= 0 &&
      canFilter(v.type[id], v.v[oldLeader], oldGap, this.behaviourRng.next(), p.filterProb) &&
      lane < this.lanes[seg] - 1 &&
      this.network.segments[seg].lengthM - position > 20
    ) {
      v.locate(seg, 6 + lane, position);
      const fLeader = v.foundLeader,
        fFollower = v.foundFollower;
      if (
        (fLeader < 0 || v.s[fLeader] - position > 5) &&
        (fFollower < 0 || position - v.s[fFollower] > 5)
      ) {
        v.moveLane(id, lane, true);
        v.filterEvents[id]++;
        v.laneChanges[id]++;
        return true;
      }
    }
    if (v.flags[id] & 2) {
      if (current.stop > 20 && oldLeader >= 0) return;
      for (let target = lane; target <= lane + 1; target++) {
        v.locate(seg, target, position);
        const leader = v.foundLeader,
          follower = v.foundFollower;
        if (
          v.gap(id, leader) > type.s0 + 2 &&
          (follower < 0 || position - v.s[follower] > type.length + 3)
        ) {
          v.moveLane(id, target);
          v.laneChanges[id]++;
          v.cooldown[id] = this.time + p.lcCooldown;
          return true;
        }
      }
      return;
    }
    let best = lane,
      bestScore = -Infinity;
    for (let target = lane - 1; target <= lane + 1; target += 2) {
      if (
        target < 0 ||
        target >= this.effectiveLanes[seg] ||
        (target >= this.lanes[seg] && !canUseVirtual(v.type[id], v.profile[id])) ||
        !laneAllowed(
          v.type[id],
          target,
          this.lanes[seg],
          this.config.infra.busLane,
          Boolean(v.busAllowed[id]),
        )
      )
        continue;
      v.locate(seg, target, position);
      const leader = v.foundLeader,
        follower = v.foundFollower,
        gap = leader >= 0 ? v.gap(id, leader) : this.gapAhead(id, seg, target, position),
        leaderSpeed = leader >= 0 ? v.v[leader] : this.aheadSpeed,
        back = follower < 0 ? 10000 : position - type.length - v.s[follower];
      if (gap < type.s0 * p.gapFactor || back < 2 * p.gapFactor) continue;
      const targetConstraints = this.constraints(id, target, this.target);
      // Same weather factors as the current-lane acceleration, or every other lane looks better in the rain.
      const ta = idm(
        v.v[id],
        Math.min(gap, targetConstraints.stop),
        gap <= targetConstraints.stop ? v.v[id] - leaderSpeed : v.v[id],
        type,
        Math.min(type.vMax * rain.speed, targetConstraints.cap),
        rain.headway,
        rain.accel,
      );
      let before = 0,
        after = 0;
      if (follower >= 0) {
        const fp = TYPE_PARAMS[v.type[follower]];
        before = idm(
          v.v[follower],
          leader < 0 ? 10000 : v.s[leader] - fp.length - v.s[follower],
          leader < 0 ? 0 : v.v[follower] - v.v[leader],
          fp,
          fp.vMax * rain.speed,
          rain.headway,
          rain.accel,
        );
        after = idm(
          v.v[follower],
          back,
          v.v[follower] - v.v[id],
          fp,
          fp.vMax * rain.speed,
          rain.headway,
          rain.accel,
        );
      }
      const pressure = Math.max(0, current.pressure - targetConstraints.pressure);
      const score = ta - currentA + p.politeness * (after - before) + pressure;
      if (mobil(currentA, ta, before, after, 0, 0, p, pressure) && score > bestScore) {
        best = target;
        bestScore = score;
      }
    }
    if (best !== lane) {
      v.locate(seg, best, position);
      const back = v.foundFollower;
      if (back >= 0 && v.v[back] > v.v[id] + 2) v.nearMisses[back]++;
      v.moveLane(id, best);
      v.laneChanges[id]++;
      v.cooldown[id] = this.time + p.lcCooldown;
      return true;
    }
  }
  /** Moves a bus one lane toward the kerb when the gap is safe (no incentive test). */
  private pullToKerb(id: number) {
    const v = this.vehicles,
      seg = v.segment[id],
      target = v.lane[id] + 1,
      type = TYPE_PARAMS[v.type[id]],
      position = v.s[id],
      rain = this.weather;
    if (v.flags[id] & 2 || v.dwellUntil[id] > 0 || target >= this.lanes[seg]) return;
    v.locate(seg, target, position);
    const leader = v.foundLeader,
      follower = v.foundFollower,
      gap = leader >= 0 ? v.gap(id, leader) : FREE_GAP,
      back = follower < 0 ? FREE_GAP : position - type.length - v.s[follower];
    // Buses force their way to the kerb: any physical gap will do, as long as nobody needs to brake harder
    // than B_MAX / 2 for it.
    if (gap < 1 || back < 1) return;
    if (leader >= 0 && idm(v.v[id], gap, v.v[id] - v.v[leader], type) < -B_MAX / 2) return;
    if (follower >= 0) {
      const fp = TYPE_PARAMS[v.type[follower]];
      const after = idm(
        v.v[follower],
        back,
        v.v[follower] - v.v[id],
        fp,
        fp.vMax * rain.speed,
        rain.headway,
        rain.accel,
      );
      if (after < -B_MAX / 2) return;
    }
    v.moveLane(id, target);
    v.laneChanges[id]++;
    v.cooldown[id] = this.time + BUS_PULL_COOLDOWN_S;
    return true;
  }
  step() {
    if (this.finished) return;
    while (
      this.eventCursor < this.scheduledEvents.length &&
      this.scheduledEvents[this.eventCursor].tick <= this.ticks
    ) {
      const event = this.scheduledEvents[this.eventCursor++];
      if (event.kind === 'rain') this.setRain(event.on, event.intensity, false);
      else this.addDisruption(event.disruption, false);
    }
    const v = this.vehicles,
      rain = this.weather;
    if (this.ticks >= this.nextDemandTick) {
      this.demand();
      this.nextDemandTick = this.ticks + 10;
    }
    if (this.ticks >= this.nextIncidentTick) {
      this.updateFeatures();
      this.nextIncidentTick = this.ticks + 5;
    }
    this.spawn();
    v.rebuildIndex();
    const historySlot = this.ticks % 11;
    for (const id of v.active) {
      const leader = v.leader(id),
        p = TYPE_PARAMS[v.type[id]];
      const index = id * 11,
        delay = this.profileDelay[v.profile[id]],
        delayed = index + ((historySlot - delay + 11) % 11);
      const laneCheck = this.ticks % 5 === id % 5 && this.time >= v.cooldown[id];
      const actualGap =
        leader >= 0 ? v.gap(id, leader) : this.gapAhead(id, v.segment[id], v.lane[id], v.s[id]);
      // At rest with both actual and perceived gaps below s0, IDM cannot produce positive acceleration.
      // Preserve perception history while avoiding repeated obstacle/MOBIL work for stationary followers.
      if (!laneCheck && v.v[id] === 0 && actualGap <= p.s0 && v.gapHistory[delayed] <= p.s0) {
        v.gapHistory[index + historySlot] = actualGap;
        v.dvHistory[index + historySlot] = leader < 0 ? -this.aheadSpeed : -v.v[leader];
        v.a[id] = 0;
        this.nextGap[id] = actualGap;
        this.gapIsAhead[id] = Number(leader < 0);
        continue;
      }
      let constraint = this.constraints(id, v.lane[id], this.current);
      let gap = this.perceive(id, constraint.stop),
        dv = this.perceivedDV;
      v.gapHistory[index + historySlot] = gap;
      v.dvHistory[index + historySlot] = dv;
      let a = idm(
        v.v[id],
        v.gapHistory[delayed],
        v.dvHistory[delayed],
        p,
        Math.min(p.vMax * rain.speed, constraint.cap),
        rain.headway,
        rain.accel,
      );
      if (laneCheck && this.changeLane(id, a, constraint)) {
        constraint = this.constraints(id, v.lane[id], this.current);
        gap = this.perceive(id, constraint.stop);
        dv = this.perceivedDV;
        a = idm(
          v.v[id],
          gap,
          dv,
          p,
          Math.min(p.vMax * rain.speed, constraint.cap),
          rain.headway,
          rain.accel,
        );
      }
      const filterLane = 6 + Math.min(v.lane[id], Math.max(0, this.lanes[v.segment[id]] - 2));
      if (
        (v.flags[id] & 2) === 0 &&
        v.laneIndex[v.segment[id] * LANES_PER_SEGMENT + filterLane].length
      ) {
        v.locate(v.segment[id], filterLane, v.s[id]);
        const filtered = v.foundLeader;
        if (filtered >= 0 && v.s[filtered] - v.s[id] < 10) a -= 0.3;
      }
      // Perception lags by the reaction time, so IDM alone can brake too late. Whenever the actual gap needs
      // more than comfortable braking to avoid contact, brake kinematically (up to B_MAX) instead of
      // relying on the no-overlap guard below to stop the vehicle instantly.
      if (dv > 0) {
        const need = (dv * dv) / (2 * Math.max(0.05, gap - 0.3));
        if (need > 0.5 * p.b) a = Math.min(a, -Math.min(B_MAX, need));
      }
      // Safe-speed cap (Gipps-style): after this step the vehicle must still be able to stop behind where the
      // thing ahead would stop if it braked at B_MAX, so decelerations stay physical instead of the guard below
      // stopping it dead: v' ≤ −B·DT + sqrt((B·DT)² + 2·B·(gap − 0.1) + v_leader²).
      if (gap < FREE_GAP) {
        const leaderV = Math.max(0, v.v[id] - dv),
          bdt = B_MAX * DT,
          safe =
            -bdt + Math.sqrt(bdt * bdt + 2 * B_MAX * Math.max(0, gap - 0.1) + leaderV * leaderV);
        a = Math.min(a, (safe - v.v[id]) / DT);
      }
      v.a[id] = Math.max(-B_MAX, a);
      this.nextGap[id] = gap;
      this.nextDV[id] = dv;
      this.gapIsAhead[id] = Number(this.perceivedAhead);
      v.previous[id] = v.s[id];
    }
    // Integrate only after all accelerations are known; hard gap guard prevents overlap despite delayed perception.
    for (const list of v.laneIndex) {
      for (let k = list.length - 1; k >= 0; k--) {
        const id = list[k],
          oldV = v.v[id];
        let newV = Math.max(0, oldV + v.a[id] * DT);
        const move = Math.max(0, (oldV + newV) * 0.5 * DT);
        const gap = this.nextGap[id];
        // A leader beyond the segment end (possibly still on the other side of a merge) cannot be hit before
        // the end: brake at B_MAX there rather than stopping dead; the transfer step checks the space.
        const bound = this.gapIsAhead[id]
          ? Math.max(
              gap,
              Math.min(
                this.network.segments[v.segment[id]].lengthM - v.s[id],
                // this step's travel when braking at B_MAX, plus the 0.1 m margin
                (oldV + Math.max(0, oldV - B_MAX * DT)) * 0.5 * DT + 0.1 + 1e-4,
              ),
            )
          : gap;
        let travel = Math.min(move, Math.max(0, bound - 0.1));
        if (k < list.length - 1) {
          const leader = list[k + 1];
          travel = Math.min(
            travel,
            Math.max(0, v.s[leader] - TYPE_PARAMS[v.type[leader]].length - v.s[id] - 0.1),
          );
        }
        if (travel + 1e-5 < move) newV = Math.min(newV, travel / DT);
        v.s[id] += travel;
        v.distance[id] += travel;
        v.v[id] = newV;
        // Realised acceleration (after the guard), used for brake-light cues.
        v.a[id] = (newV - oldV) / DT;
        const hard = (newV - oldV) / DT < -3.5;
        if (hard && !(v.flags[id] & 1)) v.hardBrakes[id]++;
        v.flags[id] = hard ? v.flags[id] | 1 : v.flags[id] & ~1;
        const virtual = v.lane[id] >= this.lanes[v.segment[id]];
        v.flags[id] = virtual ? v.flags[id] | 4 : v.flags[id] & ~4;
        if (virtual) v.virtualTime[id] += DT;
        if (newV < 5 / 3.6) v.queueTime[id] += DT;
        if (newV < 0.5) {
          const before = v.stopDuration[id];
          v.stopDuration[id] += DT;
          if (before < 2 && v.stopDuration[id] >= 2) v.stops[id]++;
        } else v.stopDuration[id] = 0;
      }
    }
    this.transferToFlyovers();
    for (let k = v.active.length - 1; k >= 0; k--) {
      const id = v.active[k],
        seg = v.segment[id],
        s = this.network.segments[seg];
      if (v.s[id] < s.lengthM) continue;
      const junction = this.toJunctionIndex[seg];
      const next = this.next[seg];
      const divert = next >= 0 && this.activeDisruptions[next].some((d) => d.type === 'closure');
      const bail =
        this.stats.queues[this.approaches[seg]] > 500 &&
        this.behaviourRng.next() < this.profiles[v.profile[id]].routeChangeProb;
      if (v.exitJunction[id] === junction || next < 0 || divert || bail) {
        if (divert || bail) v.through[id] = 0;
        this.stats.complete(v, id, this.time + DT);
        if (
          this.config.infra.uTurns[s.toJunction] &&
          !v.hasTurned[id] &&
          this.behaviourRng.next() < 0.05
        ) {
          const sourceIndex = this.network.sources.findIndex(
            (source) =>
              source.junctionId === s.toJunction &&
              this.network.segments[this.graph.byId.get(source.segmentId)!].direction !==
                s.direction,
          );
          if (sourceIndex >= 0) {
            const source = this.network.sources[sourceIndex];
            this.arrived++;
            this.queue[sourceIndex].push({
              type: v.type[id],
              profile: v.profile[id],
              exit: s.direction === 'toMarathahalli' ? 0 : this.network.junctions.length - 1,
              through: source.endToEnd,
              roll: this.behaviourRng.next(),
              bus: Boolean(v.busAllowed[id]),
              turned: true,
            });
          }
        }
        v.despawn(id);
        continue;
      }
      const lane = this.entryLane(id, seg, next, v.lane[id]);
      const receiving = v.laneIndex[next * LANES_PER_SEGMENT + lane][0] ?? -1;
      const space =
        receiving < 0 ? FREE_GAP : v.s[receiving] - TYPE_PARAMS[v.type[receiving]].length;
      // The look-ahead normally keeps the vehicle 0.1 m behind the receiving lane's last vehicle; only a
      // vehicle that merged into that lane during this same step can leave no room at all.
      if (space < 0.1) {
        v.s[id] = s.lengthM;
        v.v[id] = Math.min(v.v[id], v.v[receiving]);
        continue;
      }
      if (s.kind !== 'flyover' && this.signalFor(seg) === 0) {
        v.redRuns[id]++;
        v.redRunAt[id] = this.time;
      }
      const nextS = Math.min(v.s[id] - s.lengthM, space - 0.1);
      this.carryLateral(id, seg, v.s[id], next, nextS);
      v.removeIndex(id);
      v.segment[id] = next;
      v.lane[id] = lane;
      v.s[id] = nextS;
      v.flags[id] &= ~6;
      v.signalRoll[id] = this.behaviourRng.next();
      v.servedStop[id] = -1;
      v.dwellUntil[id] = 0;
      v.committed[id] = 0;
      v.insert(id);
      v.gapHistory.fill(10000, id * 11, id * 11 + 11);
    }
    // Drawn lateral position eases toward the logical lane (rendering only; never read by the model).
    for (const id of v.active) {
      const target = this.lateralTarget(v.segment[id], v.lane[id] + (v.flags[id] & 2 ? 0.5 : 0)),
        old = v.latM[id];
      if (old !== old) {
        v.latM[id] = target;
        v.latV[id] = 0;
        continue;
      }
      const type = v.type[id],
        limit = Math.min(LATERAL_SPEED[type], LATERAL_CREEP + LATERAL_STEER[type] * v.v[id]),
        last = v.latV[id];
      let speed = ((target - old) * LATERAL_RELAX[type]) / DT;
      speed = Math.max(-limit, Math.min(limit, speed));
      speed = Math.max(last - LATERAL_ACCEL * DT, Math.min(last + LATERAL_ACCEL * DT, speed));
      // Never overshoot the lane centre.
      if ((target - old) * (target - old - speed * DT) < 0) speed = (target - old) / DT;
      v.latM[id] = old + speed * DT;
      v.latV[id] = speed;
    }
    this.ticks++;
    if (this.ticks % 10 === 0) this.stats.sample(v, this.time, this.effectiveLanes);
  }
  run(steps: number) {
    for (let i = 0; i < steps && !this.finished; i++) this.step();
  }
}
