import { TYPE_PARAMS } from './params';
export const LANES_PER_SEGMENT = 12;
export class Vehicles {
  readonly s: Float32Array;
  readonly v: Float32Array;
  readonly a: Float32Array;
  readonly lane: Int16Array;
  readonly segment: Int16Array;
  readonly type: Uint8Array;
  readonly profile: Uint8Array;
  readonly flags: Uint8Array;
  readonly uid: Uint32Array;
  readonly spawnTime: Float32Array;
  readonly distance: Float32Array;
  readonly queueTime: Float32Array;
  readonly stops: Uint16Array;
  readonly stopDuration: Float32Array;
  readonly laneChanges: Uint16Array;
  readonly hardBrakes: Uint16Array;
  readonly nearMisses: Uint16Array;
  readonly filterEvents: Uint16Array;
  readonly redRuns: Uint16Array;
  readonly virtualTime: Float32Array;
  readonly cooldown: Float32Array;
  readonly dwellUntil: Float32Array;
  readonly servedStop: Int16Array;
  readonly exitJunction: Int16Array;
  readonly through: Uint8Array;
  readonly hasTurned: Uint8Array;
  readonly obstacleEncounter: Int32Array;
  readonly obstacleMissed: Uint8Array;
  readonly signalRoll: Float32Array;
  readonly busAllowed: Uint8Array;
  readonly gapHistory: Float32Array;
  readonly dvHistory: Float32Array;
  readonly previous: Float32Array;
  /**
   * Drawn lateral position, metres from the segment centreline (positive to the right of travel, like
   * `laneOffset`). Relaxes toward the logical lane each step; rendering only — the model never reads it.
   */
  readonly latM: Float32Array;
  /** Lateral velocity of `latM`, m/s (rendering only). */
  readonly latV: Float32Array;
  /** 1 once the driver has decided to cross this segment's stop line on amber/red (cleared on green / new segment). */
  readonly committed: Uint8Array;
  /** Sim time of the last red-light run (for the snapshot cue); very negative when none. */
  readonly redRunAt: Float32Array;
  readonly active: number[] = [];
  readonly activeIndex: Int32Array;
  readonly lanePosition: Int32Array;
  readonly free: number[] = [];
  readonly laneIndex: number[][];
  private serial = 0;
  constructor(
    readonly segmentCount: number,
    readonly capacity = 16000,
  ) {
    this.s = new Float32Array(capacity);
    this.v = new Float32Array(capacity);
    this.a = new Float32Array(capacity);
    this.lane = new Int16Array(capacity);
    this.segment = new Int16Array(capacity);
    this.segment.fill(-1);
    this.type = new Uint8Array(capacity);
    this.profile = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.uid = new Uint32Array(capacity);
    this.spawnTime = new Float32Array(capacity);
    this.distance = new Float32Array(capacity);
    this.queueTime = new Float32Array(capacity);
    this.stops = new Uint16Array(capacity);
    this.stopDuration = new Float32Array(capacity);
    this.laneChanges = new Uint16Array(capacity);
    this.hardBrakes = new Uint16Array(capacity);
    this.nearMisses = new Uint16Array(capacity);
    this.filterEvents = new Uint16Array(capacity);
    this.redRuns = new Uint16Array(capacity);
    this.virtualTime = new Float32Array(capacity);
    this.cooldown = new Float32Array(capacity);
    this.dwellUntil = new Float32Array(capacity);
    this.servedStop = new Int16Array(capacity);
    this.exitJunction = new Int16Array(capacity);
    this.through = new Uint8Array(capacity);
    this.hasTurned = new Uint8Array(capacity);
    this.obstacleEncounter = new Int32Array(capacity);
    this.obstacleMissed = new Uint8Array(capacity);
    this.signalRoll = new Float32Array(capacity);
    this.busAllowed = new Uint8Array(capacity);
    this.gapHistory = new Float32Array(capacity * 11);
    this.dvHistory = new Float32Array(capacity * 11);
    this.previous = new Float32Array(capacity);
    this.latM = new Float32Array(capacity);
    this.latV = new Float32Array(capacity);
    this.committed = new Uint8Array(capacity);
    this.redRunAt = new Float32Array(capacity);
    this.activeIndex = new Int32Array(capacity);
    this.lanePosition = new Int32Array(capacity);
    this.laneIndex = Array.from({ length: segmentCount * LANES_PER_SEGMENT }, () => []);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }
  laneKey(id: number) {
    return (
      this.segment[id] * LANES_PER_SEGMENT +
      (this.flags[id] & 2 ? 6 + this.lane[id] : this.lane[id])
    );
  }
  spawn(segment: number, lane: number, type: number, profile: number, time: number) {
    const id = this.free.pop();
    if (id === undefined) return -1;
    this.segment[id] = segment;
    this.lane[id] = lane;
    this.type[id] = type;
    this.profile[id] = profile;
    this.uid[id] = ++this.serial;
    this.spawnTime[id] = time;
    this.flags[id] = 0;
    this.s[id] = 0;
    this.v[id] = 0;
    this.a[id] = 0;
    this.distance[id] = 0;
    this.queueTime[id] = 0;
    this.stops[id] = 0;
    this.stopDuration[id] = 0;
    this.laneChanges[id] = 0;
    this.hardBrakes[id] = 0;
    this.nearMisses[id] = 0;
    this.filterEvents[id] = 0;
    this.redRuns[id] = 0;
    this.virtualTime[id] = 0;
    this.cooldown[id] = 0;
    this.dwellUntil[id] = 0;
    this.latM[id] = NaN; // initialised to the lane centre by the engine (or on the first step)
    this.latV[id] = 0;
    this.committed[id] = 0;
    this.redRunAt[id] = -1e9;
    this.servedStop[id] = -1;
    this.hasTurned[id] = 0;
    this.obstacleEncounter[id] = -1;
    this.obstacleMissed[id] = 0;
    this.gapHistory.fill(10000, id * 11, id * 11 + 11);
    this.dvHistory.fill(0, id * 11, id * 11 + 11);
    this.activeIndex[id] = this.active.length;
    this.active.push(id);
    this.insert(id);
    return id;
  }
  insert(id: number) {
    const list = this.laneIndex[this.laneKey(id)];
    let i = list.length;
    list.push(id);
    while (i > 0 && this.s[list[i - 1]] > this.s[id]) {
      list[i] = list[i - 1];
      this.lanePosition[list[i]] = i;
      i--;
    }
    list[i] = id;
    this.lanePosition[id] = i;
  }
  removeIndex(id: number) {
    const list = this.laneIndex[this.laneKey(id)];
    const i = this.lanePosition[id];
    if (list[i] !== id) throw new Error('Lane index out of sync');
    list.splice(i, 1);
    for (let j = i; j < list.length; j++) this.lanePosition[list[j]] = j;
  }
  moveLane(id: number, lane: number, filter = false) {
    this.removeIndex(id);
    this.lane[id] = lane;
    this.flags[id] = filter ? this.flags[id] | 2 : this.flags[id] & ~2;
    this.insert(id);
  }
  despawn(id: number) {
    this.removeIndex(id);
    const index = this.activeIndex[id],
      last = this.active.pop()!;
    if (last !== id) {
      this.active[index] = last;
      this.activeIndex[last] = index;
    }
    this.segment[id] = -1;
    this.free.push(id);
  }
  rebuildIndex() {
    for (const list of this.laneIndex) {
      for (let i = 1; i < list.length; i++) {
        const id = list[i];
        let j = i - 1;
        while (j >= 0 && this.s[list[j]] > this.s[id]) {
          list[j + 1] = list[j];
          j--;
        }
        list[j + 1] = id;
      }
      for (let i = 0; i < list.length; i++) this.lanePosition[list[i]] = i;
    }
  }
  /** Result of the last `locate` call (kept in fields so the hot path allocates nothing). */
  foundLeader = -1;
  foundFollower = -1;
  /** Finds the first vehicle at or ahead of `s` and the last one behind it in a lane list. */
  locate(segment: number, lane: number, s: number, exclude = -1) {
    const list = this.laneIndex[segment * LANES_PER_SEGMENT + lane];
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (this.s[list[m]] < s) lo = m + 1;
      else hi = m;
    }
    let l = lo,
      f = lo - 1;
    while (l < list.length && list[l] === exclude) l++;
    while (f >= 0 && list[f] === exclude) f--;
    this.foundLeader = l < list.length ? list[l] : -1;
    this.foundFollower = f >= 0 ? list[f] : -1;
  }
  neighbours(
    segment: number,
    lane: number,
    s: number,
    exclude = -1,
  ): { leader: number; follower: number } {
    this.locate(segment, lane, s, exclude);
    return { leader: this.foundLeader, follower: this.foundFollower };
  }
  leader(id: number) {
    return this.laneIndex[this.laneKey(id)][this.lanePosition[id] + 1] ?? -1;
  }
  gap(id: number, leader: number) {
    return leader < 0 ? 10000 : this.s[leader] - TYPE_PARAMS[this.type[leader]].length - this.s[id];
  }
}
