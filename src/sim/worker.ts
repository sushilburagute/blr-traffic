/// <reference lib="webworker" />
import { createEngine, DT, type Engine } from './engine';
import { makeSnapshot, snapshotBuffers } from './snapshot';
import type { ToWorker, FromWorker } from './protocol';
import type { Snapshot } from './types';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: Engine | undefined,
  running = false,
  skipping = false,
  speed = 8,
  last = 0,
  debt = 0,
  lastSnapshot = 0,
  lastStats = 0,
  timer: ReturnType<typeof setTimeout> | undefined,
  finishedSent = false;
let stopTick = Infinity;
const pool: Snapshot[] = [];
const send = (message: FromWorker, transfer: ArrayBuffer[] = []) =>
  scope.postMessage(message, transfer);
function snapshot() {
  if (!engine) return;
  const s = makeSnapshot(engine, pool.pop());
  send({ type: 'snapshot', snapshot: s }, snapshotBuffers(s));
}
function schedule() {
  if (timer === undefined) timer = setTimeout(tick, 0);
}
function tick() {
  timer = undefined;
  if (!engine || !running) return;
  try {
    const start = performance.now();
    const elapsed = Math.min(0.25, (start - last) / 1000);
    last = start;
    debt = Math.min(64, debt + elapsed * speed);
    const budget = skipping ? 40 : 12;
    while (!engine.finished && engine.ticks < stopTick && (skipping || debt >= DT)) {
      engine.step();
      if (!skipping) debt -= DT;
      if (performance.now() - start >= budget) break;
    }
    const now = performance.now();
    if (now - lastSnapshot >= 50) {
      if (!skipping) snapshot();
      send({
        type: 'progress',
        simTime: engine.time,
        pct: Math.min(
          1,
          engine.time / Math.max(DT, Math.min(engine.config.durationMin * 60, stopTick * DT)),
        ),
      });
      lastSnapshot = now;
    }
    if (now - lastStats >= 5000) {
      send({ type: 'stats', stats: engine.report() });
      lastStats = now;
    }
    if (engine.finished || engine.ticks >= stopTick) {
      running = false;
      if (!finishedSent) {
        finishedSent = true;
        snapshot();
        send({ type: 'finished', stats: engine.report() });
      }
    } else timer = setTimeout(tick, skipping ? 0 : 4);
  } catch (e) {
    running = false;
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  try {
    switch (m.type) {
      case 'init':
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        engine = createEngine(m.network, m.config);
        running = false;
        skipping = false;
        finishedSent = false;
        stopTick = Infinity;
        debt = 0;
        pool.length = 0;
        last = performance.now();
        send({ type: 'ready' });
        snapshot();
        break;
      case 'play':
        running = true;
        last = performance.now();
        schedule();
        break;
      case 'pause':
        running = false;
        break;
      case 'setSpeed':
        if (![1, 2, 4, 8, 16, 32].includes(m.multiplier)) throw new Error('Invalid speed');
        speed = m.multiplier;
        break;
      case 'setRain':
        engine?.setRain(m.on, m.intensity);
        if (engine) send({ type: 'stats', stats: engine.report() });
        break;
      case 'addDisruption':
        engine?.addDisruption(m.d);
        if (engine) send({ type: 'stats', stats: engine.report() });
        break;
      case 'skipToEnd':
        stopTick = m.untilS === undefined ? Infinity : Math.max(0, Math.round(m.untilS / DT));
        skipping = true;
        running = true;
        last = performance.now();
        schedule();
        break;
      case 'requestStats':
        if (engine) send({ type: 'stats', stats: engine.report() });
        break;
      case 'recycle':
        if (pool.length < 2) pool.push(m.snapshot);
        break;
      case 'dispose':
        running = false;
        if (timer !== undefined) clearTimeout(timer);
        scope.close();
        break;
    }
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
