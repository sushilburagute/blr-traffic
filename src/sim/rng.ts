/** Independent named streams make obstacle and demand randomness insensitive to UI actions. */
export class RNG {
  private state: number;
  constructor(readonly seed: number) {
    this.state = seed >>> 0;
  }
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  pick(weights: readonly number[]) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) throw new Error('Weights must have positive mass');
    let n = this.next() * sum;
    for (let i = 0; i < weights.length; i++) {
      n -= weights[i];
      if (n < 0) return i;
    }
    return weights.length - 1;
  }
  poisson(lambda: number) {
    if (lambda <= 0) return 0;
    let count = 0,
      p = 1;
    const limit = Math.exp(-lambda);
    do {
      count++;
      p *= this.next();
    } while (p > limit);
    return count - 1;
  }
  fork(label: string) {
    let hash = this.seed >>> 0;
    for (let i = 0; i < label.length; i++) hash = Math.imul(hash ^ label.charCodeAt(i), 16777619);
    return new RNG(hash >>> 0);
  }
}
