import { afterEach, it, expect, vi } from 'vitest';
import { defaults } from '@/lib/schema';
import network from '@/data/corridor/network.json';
import type { NetworkData } from '@/sim/types';
import type { ToWorker, FromWorker } from '@/sim/protocol';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('worker protocol pauses, recycles snapshots, and finishes at an exact requested tick', async () => {
  vi.useFakeTimers();
  const messages: FromWorker[] = [];
  const scope: {
    postMessage: (message: FromWorker, buffers?: ArrayBuffer[]) => void;
    onmessage?: (event: MessageEvent<ToWorker>) => void;
    close: () => void;
  } = { postMessage: (m) => messages.push(m), close: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('@/sim/worker');
  const send = (data: ToWorker) => scope.onmessage!({ data } as MessageEvent<ToWorker>);
  send({
    type: 'init',
    network: network as unknown as NetworkData,
    config: { ...defaults(), durationMin: 1 },
  });
  expect(messages.some((m) => m.type === 'ready')).toBe(true);
  const initial = messages.find((m) => m.type === 'snapshot');
  if (initial?.type === 'snapshot') send({ type: 'recycle', snapshot: initial.snapshot });
  send({ type: 'setRain', on: true, intensity: 2 });
  send({ type: 'skipToEnd', untilS: 2.3 });
  await vi.runAllTimersAsync();
  const done = messages.find((m) => m.type === 'finished');
  expect(done?.type).toBe('finished');
  if (done?.type === 'finished') {
    expect(done.stats.simTime).toBeCloseTo(2.3);
    expect(done.stats.config.liveEvents?.[0]).toEqual({
      tick: 0,
      kind: 'rain',
      on: true,
      intensity: 2,
    });
    expect(done.stats.finished).toBe(false);
  }
  send({ type: 'dispose' });
  expect(scope.close).toHaveBeenCalled();
});
