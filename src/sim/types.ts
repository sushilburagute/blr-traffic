export const VEHICLE_TYPES = ['twoWheeler', 'auto', 'car', 'cab', 'bus', 'truck'] as const;
export const PROFILES = ['disciplined', 'opportunist', 'aggressive'] as const;
export const JUNCTION_IDS = [
  'silkBoard',
  'agara',
  'iblur',
  'bellandur',
  'kadubeesanahalli',
  'marathahalli',
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type BehaviourProfile = (typeof PROFILES)[number];
export type JunctionId = (typeof JUNCTION_IDS)[number];
export type Cohort = `${VehicleType}:${BehaviourProfile}`;
export type Direction = 'toMarathahalli' | 'toSilkBoard';
export type LonLat = [number, number];
export interface VehicleTypeParams {
  length: number;
  width: number;
  vMax: number;
  a: number;
  b: number;
  T: number;
  s0: number;
  canFilter: boolean;
  canUseVirtualLane: boolean;
}
export interface BehaviourParams {
  politeness: number;
  bSafe: number;
  aThr: number;
  lcCooldown: number;
  gapFactor: number;
  filterProb: number;
  amberRunProb: number;
  redRunProb: number;
  reactionTime: number;
  routeChangeProb: number;
  busLaneViolationProb: number;
}
export interface SignalPlan {
  cycleS: number;
  phases: { approaches: number[]; greenS: number; amberS: number }[];
  offsetS: number;
}
export interface DemandPulse {
  sourceId: string;
  startMin: number;
  durationMin: number;
  vehPerHour: number;
}
export interface EncroachmentSpec {
  segmentId: string;
  s: number;
  lengthM: number;
  widthReductionM: number;
}
export interface BusStopSpec {
  segmentId: string;
  s: number;
  dwellS: number;
}
export interface ObstacleSpec {
  id: string;
  segmentId: string;
  lanes: number[];
  s: number;
  type: 'pothole' | 'speedBreaker';
  speedCapKmh: number;
}
export type DisruptionType =
  | 'accident'
  | 'breakdown'
  | 'construction'
  | 'waterlogging'
  | 'illegalParking'
  | 'brokenSignal'
  | 'event'
  | 'closure';
export interface Disruption {
  id: string;
  type: DisruptionType;
  startMin: number;
  durationMin: number;
  junctionId?: JunctionId;
  segmentId?: string;
  sOffset: number;
  params: { lanesBlocked?: number; lengthM?: number; vehPerHour?: number; sourceId?: string };
}
export interface ScenarioConfig {
  version: 1;
  seed: number;
  durationMin: number;
  startClock: string;
  demand: {
    vehPerHour: number;
    profile: 'morning' | 'evening' | 'flat' | 'custom';
    customCurve?: number[];
    mix: Record<VehicleType, number>;
    behaviourMix: Record<BehaviourProfile, number>;
    throughShare: number;
    od?: number[][];
    pulses: DemandPulse[];
  };
  infra: {
    lanesOverride?: Record<string, number>;
    speedLimitKmh: number;
    busLane: boolean;
    flyovers: Record<JunctionId, boolean>;
    uTurns: Record<JunctionId, boolean>;
    encroachment: EncroachmentSpec[];
    busStops: BusStopSpec[];
    signals: Record<JunctionId, SignalPlan>;
  };
  disruptions: Disruption[];
  environment: {
    rain: boolean;
    rainIntensity: 0 | 1 | 2;
    potholes: number;
    speedBreakers: number;
    pinnedObstacles?: ObstacleSpec[];
  };
  behaviour: Record<BehaviourProfile, Partial<BehaviourParams>>;
  squeeze: { enabled: boolean; densityThreshold: number; virtualLaneSpeedCapKmh: number };
  userCohort: Cohort;
  /** Recorded live changes, replayed before their fixed simulation tick. */
  liveEvents?: (
    | { tick: number; kind: 'rain'; on: boolean; intensity: 0 | 1 | 2 }
    | { tick: number; kind: 'disruption'; disruption: Disruption }
  )[];
}
export interface Junction {
  id: JunctionId;
  name: string;
  lonlat: LonLat;
  sOnCorridor: number;
  hasFlyover: boolean;
  signalDefault: SignalPlan;
  crossRoadNames: string[];
}
export interface Segment {
  id: string;
  direction: Direction;
  fromJunction: JunctionId;
  toJunction: JunctionId;
  lanes: number;
  widthM: number;
  lengthM: number;
  speedLimitKmh: number;
  polyline: LonLat[];
  cumulativeS: number[];
  kind: 'main' | 'flyover' | 'ramp';
  osmWayIds?: number[];
  bypassFor?: string;
}
export interface Source {
  id: string;
  segmentId: string;
  junctionId: JunctionId;
  weight: number;
  endToEnd: boolean;
}
export interface Sink {
  id: string;
  segmentId: string;
  junctionId: JunctionId;
}
export interface NetworkData {
  junctions: Junction[];
  segments: Segment[];
  sources: Source[];
  sinks: Sink[];
  meta?: { source: string; attribution: string; notes: string[] };
}
export interface Snapshot {
  simTime: number;
  clock: string;
  count: number;
  pos: Float32Array;
  heading: Float32Array;
  speed: Float32Array;
  type: Uint8Array;
  profile: Uint8Array;
  flags: Uint8Array;
  signals: Uint8Array;
  queues: Float32Array;
  segmentSpeed: Float32Array;
  ids: Uint32Array;
  segment: Uint16Array;
  lane: Float32Array;
  effectiveLanes: Uint8Array;
}
export interface CohortStats {
  cohort: Cohort;
  completedTrips: number;
  endToEndTrips: number;
  meanTravelTimeS: number | null;
  medianTravelTimeS: number | null;
  p90TravelTimeS: number | null;
  meanSpeedKmh: number;
  stopsPerTrip: number;
  laneChangesPerTrip: number;
  hardBrakesPerTrip: number;
  filteringEvents: number;
  redLightRuns: number;
  virtualLaneTimeS: number;
  nearMisses: number;
  queueTimeShare: number;
  travelTimesS: number[];
  hoursLostPerYear: number | null;
}
export interface TimeSeries {
  tStart: number;
  tStep: number;
  values: Float32Array;
}
export interface SimStats {
  simTime: number;
  completedTrips: number;
  activeVehicles: number;
  unservedDemand: number;
  meanSpeedKmh: number;
  freeFlowTravelTimeS: number;
  congestionPct: number | null;
  throughput: Record<Direction, number>;
  cohorts: CohortStats[];
  speedSeries: TimeSeries;
  queueSeries: TimeSeries[];
  cohortSpeedSeries: Record<Cohort, TimeSeries>;
  queues: Float32Array;
  maxQueues: Float32Array;
  events: { simTime: number; label: string }[];
  config: ScenarioConfig;
  finished: boolean;
}
export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T;
