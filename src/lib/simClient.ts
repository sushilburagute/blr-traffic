'use client';
import type { ToWorker, FromWorker } from '@/sim/protocol';
import type { NetworkData, ScenarioConfig, SimStats, Snapshot, Disruption } from '@/sim/types';
import { snapshotBuffers } from '@/sim/snapshot';
export function createSimClient() {
  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url));
  const listeners = new Set<(m: FromWorker) => void>();
  let disposed = false;
  worker.onmessage = (event: MessageEvent<FromWorker>) => listeners.forEach((fn) => fn(event.data));
  worker.onerror = (event) =>
    listeners.forEach((fn) =>
      fn({ type: 'error', message: event.message || 'Simulation worker could not start' }),
    );
  const send = (m: ToWorker, transfer: ArrayBuffer[] = []) => {
    if (!disposed) worker.postMessage(m, transfer);
  };
  return {
    init: (network: NetworkData, config: ScenarioConfig) => send({ type: 'init', network, config }),
    play: () => send({ type: 'play' }),
    pause: () => send({ type: 'pause' }),
    setSpeed: (multiplier: number) => send({ type: 'setSpeed', multiplier }),
    setRain: (on: boolean, intensity: 0 | 1 | 2 = 1) => send({ type: 'setRain', on, intensity }),
    addDisruption: (d: Disruption) => send({ type: 'addDisruption', d }),
    skipToEnd: (untilS?: number) => send({ type: 'skipToEnd', untilS }),
    requestStats: () => send({ type: 'requestStats' }),
    recycle: (snapshot: Snapshot) => send({ type: 'recycle', snapshot }, snapshotBuffers(snapshot)),
    on: (fn: (m: FromWorker) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
      worker.terminate();
    },
  };
}
export type SimClient = ReturnType<typeof createSimClient>;
export async function fetchNetwork(signal?: AbortSignal): Promise<NetworkData> {
  const response = await fetch('/data/corridor/network.json', { signal });
  if (!response.ok) throw new Error('Could not load the corridor network');
  return response.json();
}
export function createHeadlessRun(
  config: ScenarioConfig,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  untilS?: number,
): Promise<SimStats> {
  return new Promise((resolve, reject) => {
    const client = createSimClient();
    const finish = () => {
      client.dispose();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException('Run cancelled', 'AbortError'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    client.on((m) => {
      if (m.type === 'ready') client.skipToEnd(untilS);
      if (m.type === 'progress') onProgress?.(m.pct);
      if (m.type === 'snapshot') client.recycle(m.snapshot);
      if (m.type === 'finished') {
        finish();
        resolve(m.stats);
      }
      if (m.type === 'error') {
        finish();
        reject(new Error(m.message));
      }
    });
    fetchNetwork(signal)
      .then((n) => client.init(n, config))
      .catch((e) => {
        finish();
        reject(e);
      });
  });
}
