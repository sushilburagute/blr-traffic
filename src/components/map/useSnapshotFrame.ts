import type { Snapshot } from '@/sim/types';
/** Two CPU buffers keep the render interpolation separate from transferable worker snapshots. */
export class SnapshotFrame {
  private base = new Float32Array(0);
  private velocity = new Float32Array(0);
  private buffers = [new Float32Array(0), new Float32Array(0)];
  private count = 0;
  private receivedAt = 0;
  private index = 0;
  accept(snapshot: Snapshot, now: number) {
    if (this.base.length < snapshot.pos.length) {
      this.base = new Float32Array(snapshot.pos.length);
      this.velocity = new Float32Array(snapshot.pos.length);
      this.buffers = [new Float32Array(snapshot.pos.length), new Float32Array(snapshot.pos.length)];
    }
    this.count = snapshot.count;
    this.receivedAt = now;
    this.base.set(snapshot.pos);
    for (let i = 0; i < this.count; i++) {
      const angle = (snapshot.heading[i] * Math.PI) / 180,
        lat = (snapshot.pos[i * 2 + 1] * Math.PI) / 180;
      this.velocity[i * 2] = (Math.sin(angle) * snapshot.speed[i]) / (111195 * Math.cos(lat));
      this.velocity[i * 2 + 1] = (Math.cos(angle) * snapshot.speed[i]) / 111195;
    }
  }
  positions(now: number, multiplier: number, playing: boolean) {
    const dt = playing
      ? Math.min(0.05, Math.max(0, (now - this.receivedAt) / 1000)) * multiplier
      : 0;
    this.index = 1 - this.index;
    const positions = this.buffers[this.index];
    for (let i = 0; i < this.count * 2; i++) positions[i] = this.base[i] + this.velocity[i] * dt;
    return positions;
  }
}
