import { loadNetwork } from './network';
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
} from './types';
export const DT = 0.1;
/** How far past a flyover's split point a through vehicle keeps trying to get onto the ramp. */
const FLYOVER_WINDOW_M = 60;
interface Arrival {
  type: number;
  profile: number;
  exit: number;
  through: boolean;
  roll: number;
  bus: boolean;
  turned?: boolean;
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
      for (const e of this.config.infra.encroachment)
        if (e.segmentId === s.id) width -= (e.widthReductionM * e.lengthM) / s.lengthM;
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
    const v = this.vehicles;
    for (let k = v.active.length - 1; k >= 0; k--) {
      const id = v.active[k],
        seg = v.segment[id];
      const bypass = this.bypasses[seg];
      if (bypass < 0 || !v.through[id] || v.flags[id] & 2) continue;
      const s = this.network.segments[seg],
        f = this.network.segments[bypass];
      if (!this.config.infra.flyovers[s.toJunction]) continue;
      const offset = v.s[id] - (s.lengthM - f.lengthM);
      if (offset < 0 || offset > FLYOVER_WINDOW_M) continue;
      const lane = Math.min(v.lane[id], this.lanes[bypass] - 1);
      const { leader, follower } = v.neighbours(bypass, lane, offset);
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
      v.removeIndex(id);
      v.segment[id] = bypass;
      v.lane[id] = lane;
      v.s[id] = offset;
      v.flags[id] &= ~6;
      v.insert(id);
      v.gapHistory.fill(10000, id * 11, id * 11 + 11);
    }
  }
  private constraints(id: number, lane: number) {
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
    const a = this.approaches[seg],
      state = this.signals[a];
    if (s.kind !== 'flyover' && state !== 2) {
      const allowed = v.signalRoll[id] < (state === 1 ? p.amberRunProb : p.redRunProb);
      if (!allowed) stop = s.lengthM - 2 - position;
    }
    for (const o of this.obstacleBySegment[seg])
      if (o.lanes.includes(lane)) {
        const delta = o.s - position;
        const radius = o.type === 'pothole' ? 8 : 5;
        if (delta >= -radius && delta < 60) {
          const obstacleIndex = this.obstacleBySegment[seg].indexOf(o);
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
      if (['event', 'brokenSignal'].includes(d.type)) continue;
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
      ['iblur', 'bellandur'].includes(s.toJunction) &&
      s.kind === 'main'
    ) {
      const dist = s.lengthM - 120 - position;
      if (position < s.lengthM - 20) {
        if (lane === this.lanes[seg] - 1) {
          stop = Math.min(stop, Math.max(0, dist));
          pressure = Math.max(pressure, 2 - dist / 60);
        }
        if (dist < 100) cap = Math.min(cap, 20 / 3.6);
      }
    }
    for (const e of this.config.infra.encroachment)
      if (
        e.segmentId === s.id &&
        position < e.s + e.lengthM &&
        lane >= Math.max(1, this.lanes[seg] - Math.ceil(e.widthReductionM / 3.5))
      ) {
        stop = Math.min(stop, Math.max(0, e.s - position - 2));
        pressure = Math.max(pressure, 3 - (e.s - position) / 60);
      }
    if (v.type[id] === 4) {
      for (let i = 0; i < this.config.infra.busStops.length; i++) {
        const b = this.config.infra.busStops[i];
        if (b.segmentId !== s.id || v.servedStop[id] === i || position > b.s + 5) continue;
        if (b.s - position < 60 && lane !== this.lanes[seg] - 1) pressure = Math.max(pressure, 1);
        if (lane === this.lanes[seg] - 1) {
          stop = Math.min(stop, Math.max(0, b.s - position));
          if (lane === v.lane[id] && b.s - position < 1 && v.v[id] < 0.5) {
            if (!v.dwellUntil[id]) v.dwellUntil[id] = this.time + b.dwellS;
            if (this.time >= v.dwellUntil[id]) {
              v.servedStop[id] = i;
              v.dwellUntil[id] = 0;
            }
          }
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
    return { cap, stop, pressure };
  }
  private changeLane(
    id: number,
    currentA: number,
    current: { cap: number; stop: number; pressure: number },
  ) {
    const v = this.vehicles,
      seg = v.segment[id],
      lane = v.lane[id],
      type = TYPE_PARAMS[v.type[id]],
      p = this.profiles[v.profile[id]],
      position = v.s[id],
      rain = this.weather;
    const oldLeader = v.leader(id),
      oldGap = v.gap(id, oldLeader);
    if (
      !(v.flags[id] & 2) &&
      oldLeader >= 0 &&
      canFilter(v.type[id], v.v[oldLeader], oldGap, this.behaviourRng.next(), p.filterProb) &&
      lane < this.lanes[seg] - 1 &&
      this.network.segments[seg].lengthM - position > 20
    ) {
      const f = v.neighbours(seg, 6 + lane, position);
      if (
        (f.leader < 0 || v.s[f.leader] - position > 5) &&
        (f.follower < 0 || position - v.s[f.follower] > 5)
      ) {
        v.moveLane(id, lane, true);
        v.filterEvents[id]++;
        v.laneChanges[id]++;
        return true;
      }
    }
    if (v.flags[id] & 2) {
      if (current.stop > 20 && oldLeader >= 0) return;
      for (const target of [lane, lane + 1]) {
        const n = v.neighbours(seg, target, position);
        if (
          v.gap(id, n.leader) > type.s0 + 2 &&
          (n.follower < 0 || position - v.s[n.follower] > type.length + 3)
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
    for (const target of [lane - 1, lane + 1]) {
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
      const n = v.neighbours(seg, target, position),
        gap = v.gap(id, n.leader),
        back = n.follower < 0 ? 10000 : position - type.length - v.s[n.follower];
      if (gap < type.s0 * p.gapFactor || back < 2 * p.gapFactor) continue;
      const targetConstraints = this.constraints(id, target);
      // Same weather factors as the current-lane acceleration, or every other lane looks better in the rain.
      const ta = idm(
        v.v[id],
        Math.min(gap, targetConstraints.stop),
        n.leader < 0 ? 0 : v.v[id] - v.v[n.leader],
        type,
        Math.min(type.vMax * rain.speed, targetConstraints.cap),
        rain.headway,
        rain.accel,
      );
      let before = 0,
        after = 0;
      if (n.follower >= 0) {
        const fp = TYPE_PARAMS[v.type[n.follower]];
        before = idm(
          v.v[n.follower],
          n.leader < 0 ? 10000 : v.s[n.leader] - fp.length - v.s[n.follower],
          n.leader < 0 ? 0 : v.v[n.follower] - v.v[n.leader],
          fp,
          fp.vMax * rain.speed,
          rain.headway,
          rain.accel,
        );
        after = idm(
          v.v[n.follower],
          back,
          v.v[n.follower] - v.v[id],
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
      const back = v.neighbours(seg, best, position).follower;
      if (back >= 0 && v.v[back] > v.v[id] + 2) v.nearMisses[back]++;
      v.moveLane(id, best);
      v.laneChanges[id]++;
      v.cooldown[id] = this.time + p.lcCooldown;
      return true;
    }
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
        p = TYPE_PARAMS[v.type[id]],
        behaviour = this.profiles[v.profile[id]];
      const index = id * 11,
        delay = Math.min(10, Math.round(behaviour.reactionTime / DT)),
        delayed = index + ((historySlot - delay + 11) % 11);
      const laneCheck = this.ticks % 5 === id % 5 && this.time >= v.cooldown[id];
      const actualGap = v.gap(id, leader);
      // At rest with both actual and perceived gaps below s0, IDM cannot produce positive acceleration.
      // Preserve perception history while avoiding repeated obstacle/MOBIL work for stationary followers.
      if (!laneCheck && v.v[id] === 0 && actualGap <= p.s0 && v.gapHistory[delayed] <= p.s0) {
        v.gapHistory[index + historySlot] = actualGap;
        v.dvHistory[index + historySlot] = leader < 0 ? 0 : -v.v[leader];
        v.a[id] = 0;
        this.nextGap[id] = actualGap;
        continue;
      }
      const constraint = this.constraints(id, v.lane[id]);
      let gap = Math.min(v.gap(id, leader), constraint.stop),
        dv = gap === constraint.stop ? v.v[id] : leader < 0 ? 0 : v.v[id] - v.v[leader];
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
        const newLeader = v.leader(id),
          c = this.constraints(id, v.lane[id]);
        gap = Math.min(v.gap(id, newLeader), c.stop);
        dv = gap === c.stop ? v.v[id] : newLeader < 0 ? 0 : v.v[id] - v.v[newLeader];
        a = idm(
          v.v[id],
          gap,
          dv,
          p,
          Math.min(p.vMax * rain.speed, c.cap),
          rain.headway,
          rain.accel,
        );
      }
      const filterLane = 6 + Math.min(v.lane[id], Math.max(0, this.lanes[v.segment[id]] - 2));
      if (
        (v.flags[id] & 2) === 0 &&
        v.laneIndex[v.segment[id] * LANES_PER_SEGMENT + filterLane].length
      ) {
        const filtered = v.neighbours(v.segment[id], filterLane, v.s[id]).leader;
        if (filtered >= 0 && v.s[filtered] - v.s[id] < 10) a -= 0.3;
      }
      v.a[id] = a;
      this.nextGap[id] = gap;
      this.nextDV[id] = dv;
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
        let travel = Math.min(move, Math.max(0, gap - 0.1));
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
      const junction = this.network.junctions.findIndex((j) => j.id === s.toJunction);
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
      let lane = Math.min(v.lane[id], this.lanes[next] - 1);
      if (
        !laneAllowed(
          v.type[id],
          lane,
          this.lanes[next],
          this.config.infra.busLane,
          Boolean(v.busAllowed[id]),
        )
      )
        lane = Math.max(0, lane - 1);
      const receiving = v.laneIndex[next * LANES_PER_SEGMENT + lane][0] ?? -1;
      const space = receiving < 0 ? 10000 : v.s[receiving] - TYPE_PARAMS[v.type[receiving]].length;
      if (space < TYPE_PARAMS[v.type[id]].s0 + 1) {
        v.s[id] = s.lengthM;
        v.v[id] = 0;
        continue;
      }
      if (s.kind !== 'flyover' && this.signals[this.approaches[seg]] === 0) v.redRuns[id]++;
      v.removeIndex(id);
      v.segment[id] = next;
      v.lane[id] = lane;
      v.s[id] = Math.min(v.s[id] - s.lengthM, space - 0.5);
      v.flags[id] &= ~6;
      v.signalRoll[id] = this.behaviourRng.next();
      v.servedStop[id] = -1;
      v.insert(id);
      v.gapHistory.fill(10000, id * 11, id * 11 + 11);
    }
    this.ticks++;
    if (this.ticks % 10 === 0) this.stats.sample(v, this.time, this.effectiveLanes);
  }
  run(steps: number) {
    for (let i = 0; i < steps && !this.finished; i++) this.step();
  }
}
