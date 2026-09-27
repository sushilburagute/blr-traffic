'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as GLMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Maximize2, Plus, Minus, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAP_STYLE } from '@/lib/mapStyle';
import { snapshotRef, useSimStore } from '@/store/simStore';
import { useUiStore } from '@/store/uiStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { TYPE_COLORS, VEHICLE_LABELS, PROFILE_LABELS } from '@/lib/colors';
import {
  VEHICLE_TYPES,
  PROFILES,
  type NetworkData,
  type ScenarioConfig,
  type Snapshot,
} from '@/sim/types';

/** Ring colours match haloColor in vehicleFrame.ts. */
const BEHAVIOUR_RINGS = [
  ['Ran a red', '#ff453a'],
  ['Squeeze lane', '#f5c362'],
  ['Filtering', '#6ecdff'],
] as const;
/** Indicator blink half-period, ms. */
const BLINK_MS = 380;
import { projectSegment, distance } from '@/sim/network';
import { overview, flyToJunction } from './camera';
import { sceneLayers, vehicleLayers, type Scene } from './layers';
import { Minimap } from './Minimap';
import { VehicleFrame, CUE_BRAKE, CUE_RED_RUN, type VehicleGroup } from './vehicleFrame';
import 'maplibre-gl/dist/maplibre-gl.css';
export default function MapCanvas({
  network,
  config,
}: {
  network: NetworkData;
  config: ScenarioConfig;
}) {
  const container = useRef<HTMLDivElement>(null),
    mapRef = useRef<GLMap | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null),
    [offline, setOffline] = useState(false),
    [glError, setGlError] = useState(false);
  const rain = useSimStore((s) => s.rain),
    selected = useUiStore((s) => s.selectedJunction),
    mode = useUiStore((s) => s.cameraMode),
    legend = useUiStore((s) => s.legendVisible),
    pin = useUiStore((s) => s.pinObstacle);
  const stats = useSimStore((s) => s.latestStats);
  useEffect(() => {
    if (!container.current) return;
    let disposed = false,
      frame = 0;
    let map: GLMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {},
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#19221f' } },
          ],
        },
        center: [77.665, 12.937],
        zoom: 12,
        maxBounds: [
          [77.56, 12.86],
          [77.76, 13.02],
        ],
        pitch: 0,
        attributionControl: false,
      });
    } catch {
      setGlError(true);
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '© OpenStreetMap contributors · OpenFreeMap',
      }),
      'bottom-right',
    );
    const controller = new AbortController();
    fetch(MAP_STYLE, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
      .then((r) => {
        if (!r.ok) throw new Error('style');
        return r.json();
      })
      .then((style) => {
        if (!disposed) map.setStyle(style);
      })
      .catch(() => {
        if (!disposed) setOffline(true);
      });
    const vehicles = new VehicleFrame(network);
    const groups: Record<string, VehicleGroup | undefined> = {};
    const overlay = new MapboxOverlay({
      interleaved: false,
      getTooltip: (info) => {
        const s = vehicles.latest,
          id = info.layer?.id ?? '',
          group = groups[id.slice(id.lastIndexOf('-') + 1)];
        if (id.startsWith('vehicle') && s && group && info.index >= 0) {
          const i = group.order[info.index];
          return {
            text: `${VEHICLE_LABELS[VEHICLE_TYPES[s.type[i]]]} · ${PROFILE_LABELS[PROFILES[s.profile[i]]]}\n${(s.speed[i] * 3.6).toFixed(1)} km/h · lane ${s.lane[i] + 1}${s.flags[i] & 2 ? ' · filtering' : ''}${s.flags[i] & 4 ? ' · squeeze lane' : ''}${s.flags[i] & 8 ? ' · your cohort' : ''}${s.cues[i] & CUE_BRAKE ? ' · braking' : ''}${s.cues[i] & CUE_RED_RUN ? ' · ran a red' : ''}`,
            style: { backgroundColor: '#18221c', color: '#edf4e9', fontSize: '12px' },
          };
        }
        const object = info.object as { name?: string; label?: string } | undefined;
        return object?.name ?? object?.label ?? null;
      },
    });
    map.addControl(overlay);
    map.on('load', () => overview(map, network));
    const updateBounds = () => {
      const b = map.getBounds();
      setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on('moveend', updateBounds);
    map.on('dragstart', () => useUiStore.setState({ cameraMode: 'free' }));
    map.on('zoomstart', (e) => {
      if (e.originalEvent) useUiStore.setState({ cameraMode: 'free' });
    });
    map.on('click', (e) => {
      if (!useUiStore.getState().pinObstacle) return;
      let best: { segmentId: string; s: number; lane: number; distance: number } | null = null;
      for (const segment of network.segments.filter((s) => s.kind === 'main'))
        for (let i = 0; i <= 100; i++) {
          const s = (segment.lengthM * i) / 100,
            p = projectSegment(segment, 0, s);
          const d = distance([e.lngLat.lng, e.lngLat.lat], [p[0], p[1]]);
          if (!best || d < best.distance) best = { segmentId: segment.id, s, lane: 0, distance: d };
        }
      if (best) {
        const previous = useScenarioStore.getState().config.environment.pinnedObstacles ?? [];
        useScenarioStore.getState().patch({
          environment: {
            pinnedObstacles: [
              ...previous,
              {
                id: `pinned-${previous.length}`,
                segmentId: best.segmentId,
                s: best.s,
                lanes: [best.lane],
                type: 'pothole',
                speedCapKmh: 5,
              },
            ],
          },
        });
        useUiStore.setState({ pinObstacle: false, panelOpen: true, mode: 'expert' });
      }
    });
    let scene: Scene | null = null,
      previous: Snapshot | null = null,
      previousConfig: ScenarioConfig | null = null,
      previousOptions = '',
      version = 0,
      sceneVersion = 0,
      drawn = '';
    function animate() {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const snapshot = snapshotRef.current,
        ui = useUiStore.getState(),
        zoom = map.getZoom(),
        options = {
          colorMode: ui.colorMode,
          heat: ui.heat,
          queues: ui.queues,
          zoom: Math.round(zoom * 10) / 10,
        };
      const key = JSON.stringify(options);
      const now = performance.now();
      const fresh = snapshot !== previous;
      if (fresh) {
        if (snapshot) vehicles.accept(snapshot, now);
        else vehicles.clear();
        version++;
      }
      if (!scene || fresh || key !== previousOptions || configRef.current !== previousConfig) {
        scene = sceneLayers(network, configRef.current, snapshot, options);
        previous = snapshot;
        previousConfig = configRef.current;
        previousOptions = key;
        sceneVersion++;
      }
      if (vehicles.paint(ui.colorMode)) version++;
      const blinkOn = Math.floor(now / BLINK_MS) % 2 === 0;
      // Skip redundant uploads once every vehicle has settled and nothing else changed.
      const state = `${version}|${sceneVersion}|${blinkOn}|${vehicles.moving(now)}`;
      if (state === drawn && !vehicles.moving(now)) return;
      drawn = state;
      const [ground, flyover] = snapshot ? vehicles.frame(now) : [];
      groups.ground = ground;
      groups.flyover = flyover;
      overlay.setProps({
        layers: [
          ...scene.under,
          ...(ground ? vehicleLayers(ground, 'ground', zoom, blinkOn, version) : []),
          ...scene.deck,
          ...(flyover ? vehicleLayers(flyover, 'flyover', zoom, blinkOn, version) : []),
          ...scene.over,
        ],
      });
    }
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      controller.abort();
      cancelAnimationFrame(frame);
      mapRef.current = null;
      map.remove();
    };
  }, [network]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === 'overview') overview(map, network);
    else if (mode === 'junction' && selected) flyToJunction(map, network, selected);
  }, [mode, selected, network]);
  return (
    <div className={`map-wrap ${rain ? 'raining' : ''}`}>
      <div className="map-container" ref={container} />
      {glError && (
        <div className="map-fallback">
          <svg viewBox="0 0 800 500">
            {network.segments
              .filter((s) => s.kind === 'main')
              .map((s) => (
                <polyline
                  key={s.id}
                  points={s.polyline
                    .map((p) => `${(p[0] - 77.615) * 8500},${480 - (p[1] - 12.91) * 8500}`)
                    .join(' ')}
                  fill="none"
                  stroke="#a7e7b4"
                  strokeWidth={3}
                />
              ))}
          </svg>
          <p>WebGL is unavailable. The simulation continues with a schematic corridor.</p>
        </div>
      )}
      {(offline || network.meta?.source !== 'osm') && (
        <div className="map-source-note">
          <TriangleAlert size={12} />
          {offline ? 'Basemap offline · ' : ''}
          {network.meta?.source !== 'osm' ? 'Approximate geometry · OSM validation pending' : ''}
        </div>
      )}
      {pin && (
        <div className="pin-notice">
          Click near a road to place a pothole. Apply & restart to use it.
          <Button
            size="sm"
            variant="outline"
            onClick={() => useUiStore.setState({ pinObstacle: false })}
          >
            Cancel
          </Button>
        </div>
      )}
      <div className="map-tools">
        <Button
          variant="secondary"
          onClick={() => {
            useUiStore.setState({ cameraMode: 'overview', selectedJunction: null });
            if (mapRef.current) overview(mapRef.current, network);
          }}
        >
          <Maximize2 size={15} /> Overview <kbd>Esc</kbd>
        </Button>
        <div className="zoom-buttons">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Zoom in"
            onClick={() => mapRef.current?.zoomIn()}
          >
            <Plus size={17} />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Zoom out"
            onClick={() => mapRef.current?.zoomOut()}
          >
            <Minus size={17} />
          </Button>
        </div>
      </div>
      <Minimap
        network={network}
        bounds={bounds}
        speeds={snapshotRef.current?.segmentSpeed}
        onJump={(lon, lat) => {
          mapRef.current?.flyTo({ center: [lon, lat], zoom: 15 });
          useUiStore.setState({ cameraMode: 'free' });
        }}
      />
      {legend && (
        <div className="map-legend">
          <span className="eyebrow">ON THE ROAD</span>
          {VEHICLE_TYPES.map((t, i) => (
            <span key={t}>
              <i style={{ background: `rgb(${TYPE_COLORS[i]})` }} />
              {VEHICLE_LABELS[t]}
            </span>
          ))}
          <span>
            <i className="cohort-ring" />
            Your cohort
          </span>
          <span className="eyebrow">UP CLOSE</span>
          {BEHAVIOUR_RINGS.map(([label, color]) => (
            <span key={label}>
              <i className="cohort-ring" style={{ borderColor: color }} />
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="map-credit">
        Built by <a href="https://sush.dev">sush.dev</a> · {stats?.activeVehicles ?? 0} on the road
      </div>
    </div>
  );
}
