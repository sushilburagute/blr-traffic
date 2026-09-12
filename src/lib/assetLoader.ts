'use client';
import { MAP_STYLE } from './mapStyle';
import { createSimClient, fetchNetwork } from './simClient';
import type { ScenarioConfig } from '@/sim/types';
import type { StyleSpecification } from 'maplibre-gl';
export type Asset = {
  name: string;
  state: 'waiting' | 'loading' | 'ready' | 'fallback' | 'error';
  detail?: string;
};
export async function loadAssets(
  config: ScenarioConfig,
  onChange: (assets: Asset[]) => void,
  signal: AbortSignal,
) {
  const assets: Asset[] = [
    { name: 'Corridor network', state: 'waiting' },
    { name: 'Map style', state: 'waiting' },
    { name: 'Vehicle atlas', state: 'waiting' },
    { name: 'Simulation engine', state: 'waiting' },
    { name: 'Corridor tiles', state: 'waiting' },
    { name: 'Map renderer', state: 'waiting' },
  ];
  const networkPromise = fetchNetwork(signal);
  const stylePromise = fetch(MAP_STYLE, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  }).then(async (r) => {
    if (!r.ok) throw new Error('Basemap unavailable');
    return (await r.json()) as StyleSpecification;
  });
  const update = (i: number, state: Asset['state'], detail?: string) => {
    assets[i] = { ...assets[i], state, detail };
    if (!signal.aborted) onChange([...assets]);
  };
  await Promise.allSettled(
    assets.map(async (_, i) => {
      update(i, 'loading');
      try {
        if (i === 0) await networkPromise;
        if (i === 1) {
          await stylePromise;
        }
        if (i === 2) {
          const r = await fetch('/sprites/vehicles.png', { signal });
          if (!r.ok) throw new Error('Atlas unavailable');
          await r.blob();
        }
        if (i === 3) {
          const client = createSimClient();
          try {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Worker timed out')), 15000);
              const abort = () => reject(new DOMException('Aborted', 'AbortError'));
              signal.addEventListener('abort', abort, { once: true });
              client.on((m) => {
                if (m.type === 'snapshot') client.recycle(m.snapshot);
                if (m.type === 'ready' || m.type === 'error') {
                  clearTimeout(timeout);
                  signal.removeEventListener('abort', abort);
                  if (m.type === 'ready') resolve();
                  else reject(new Error(m.message));
                }
              });
              networkPromise.then((n) => client.init(n, config)).catch(reject);
            });
          } finally {
            client.dispose();
          }
        }
        if (i === 4) {
          const [style, network] = await Promise.all([stylePromise, networkPromise]);
          const source = Object.values(style.sources).find((s) => s.type === 'vector');
          if (!source || source.type !== 'vector') throw new Error('No tile source');
          let templates = source.tiles;
          if (!templates?.length && source.url) {
            const r = await fetch(source.url, {
              signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
            });
            if (!r.ok) throw new Error('Tile index unavailable');
            templates = ((await r.json()) as { tiles: string[] }).tiles;
          }
          if (!templates?.[0]) throw new Error('No tile template');
          const urls = new Set<string>();
          for (const zoom of [13, 14, 15])
            for (const junction of network.junctions) {
              const [lon, lat] = junction.lonlat,
                n = 2 ** zoom,
                rad = (lat * Math.PI) / 180,
                x = Math.floor(((lon + 180) / 360) * n),
                y = Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n);
              urls.add(
                templates[0]
                  .replace('{z}', String(zoom))
                  .replace('{x}', String(x))
                  .replace('{y}', String(y)),
              );
            }
          const result = await Promise.allSettled(
            [...urls].map(async (url) => {
              const r = await fetch(url, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
              });
              if (!r.ok) throw new Error('Tile unavailable');
              await r.arrayBuffer();
            }),
          );
          if (result.some((r) => r.status === 'rejected'))
            throw new Error('Some tiles will load on demand');
        }
        if (i === 5) await import('@/components/map/MapCanvas');
        update(i, 'ready');
      } catch (e) {
        update(
          i,
          i === 1 || i === 4 ? 'fallback' : 'error',
          e instanceof Error ? e.message : String(e),
        );
      }
    }),
  );
  return assets;
}
