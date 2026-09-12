'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  FastForward,
  CloudRain,
  Share2,
  HelpCircle,
  SlidersHorizontal,
  Layers,
  Bookmark,
  ChartNoAxesCombined,
  ArrowRight,
  LoaderCircle,
  X,
  PanelLeftClose,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { FirstRunHint } from '@/components/ui/FirstRunHint';
import { PresetPicker } from './PresetPicker';
import { ExpertPanel } from './ExpertPanel';
import { HelpSheet } from './HelpSheet';
import { useScenarioStore } from '@/store/scenarioStore';
import { snapshotRef, useSimStore } from '@/store/simStore';
import { useUiStore, type ColorMode } from '@/store/uiStore';
import { createSimClient, fetchNetwork, type SimClient } from '@/lib/simClient';
import { presets, presetConfig } from '@/lib/presets';
import { encode, decode } from '@/lib/share';
import { clock, number } from '@/lib/units';
import { cohortLabel, queueColor } from '@/lib/colors';
import { track } from '@/lib/analytics';
import { queueClass } from '@/sim/stats';
import type { NetworkData, ScenarioConfig, Disruption } from '@/sim/types';
const MapCanvas = dynamic(() => import('@/components/map/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <LoaderCircle className="spin" /> Bringing the corridor into view…
    </div>
  ),
});
const LiveCharts = dynamic(() => import('./LiveCharts'), { ssr: false });
const SPEEDS = [1, 2, 4, 8, 16, 32];
export function Simulator() {
  const router = useRouter(),
    client = useRef<SimClient | null>(null),
    finishRequested = useRef(false);
  const [network, setNetwork] = useState<NetworkData | null>(null),
    [notice, setNotice] = useState(''),
    [saveOpen, setSaveOpen] = useState(false),
    [saveName, setSaveName] = useState(''),
    [layersOpen, setLayersOpen] = useState(false);
  const config = useScenarioStore((s) => s.config),
    presetId = useScenarioStore((s) => s.presetId),
    hydrated = useScenarioStore((s) => s.hydrated),
    saved = useScenarioStore((s) => s.savedScenarios);
  const sim = useSimStore(),
    ui = useUiStore();
  const start = useCallback(
    (c: ScenarioConfig, preset: string, net: NetworkData, autoplay = true) => {
      client.current?.dispose();
      snapshotRef.current = null;
      finishRequested.current = false;
      const worker = createSimClient();
      client.current = worker;
      useSimStore.setState({
        status: 'loading',
        latestStats: null,
        simTime: 0,
        progress: 0,
        error: null,
        runConfig: structuredClone(c),
        runPreset: preset,
        rain: c.environment.rain,
        skipping: false,
      });
      sessionStorage.setItem('blr-last-run', JSON.stringify({ config: c, preset }));
      worker.on((m) => {
        if (client.current !== worker) return;
        switch (m.type) {
          case 'ready':
            useSimStore.setState({ status: autoplay ? 'running' : 'ready' });
            worker.setSpeed(useSimStore.getState().speed);
            if (sessionStorage.getItem('blr-shared-result')) {
              sessionStorage.removeItem('blr-shared-result');
              const until = sessionStorage.getItem('blr-shared-until');
              sessionStorage.removeItem('blr-shared-until');
              worker.skipToEnd(until === null ? undefined : Number(until));
              useSimStore.setState({ skipping: true, status: 'running' });
            } else if (autoplay) worker.play();
            track('sim_start', { preset, cohort: c.userCohort });
            break;
          case 'snapshot': {
            const old = snapshotRef.current;
            snapshotRef.current = m.snapshot;
            if (old) requestAnimationFrame(() => requestAnimationFrame(() => worker.recycle(old)));
            break;
          }
          case 'progress': {
            const replayConfig = useSimStore.getState().runConfig ?? c;
            let rain = replayConfig.environment.rain;
            for (const event of replayConfig.liveEvents ?? []) {
              if (event.kind === 'rain' && event.tick <= Math.round(m.simTime * 10))
                rain = event.on;
            }
            useSimStore.setState({ simTime: m.simTime, progress: m.pct, rain });
            break;
          }
          case 'stats':
            useSimStore.setState({ latestStats: m.stats, runConfig: m.stats.config });
            sessionStorage.setItem(
              'blr-last-run',
              JSON.stringify({
                config: m.stats.config,
                preset,
                ...(finishRequested.current ? { untilS: m.stats.simTime } : {}),
              }),
            );
            if (finishRequested.current) {
              useSimStore.setState({ status: 'finished' });
              router.push('/report');
            }
            break;
          case 'finished':
            sessionStorage.setItem(
              'blr-last-run',
              JSON.stringify({ config: m.stats.config, preset, untilS: m.stats.simTime }),
            );
            useSimStore.setState({
              status: 'finished',
              latestStats: m.stats,
              runConfig: m.stats.config,
              simTime: m.stats.simTime,
              progress: 1,
              skipping: false,
            });
            track('sim_finish', { preset, cohort: c.userCohort, durationMin: c.durationMin });
            router.push('/report');
            break;
          case 'error':
            useSimStore.setState({ status: 'error', error: m.message });
            break;
        }
      });
      worker.init(net, c);
    },
    [router],
  );
  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    fetchNetwork(controller.signal)
      .then((net) => {
        setNetwork(net);
        const state = useScenarioStore.getState();
        let c = state.config;
        const duration = new URLSearchParams(location.search).get('dur');
        if (duration && Number(duration) >= 1 && Number(duration) <= 60)
          c = { ...c, durationMin: Number(duration) };
        start(c, state.presetId, net, false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) useSimStore.setState({ status: 'error', error: String(e) });
      });
    return () => {
      controller.abort();
      client.current?.dispose();
      client.current = null;
      snapshotRef.current = null;
    };
  }, [hydrated, start]);
  const play = useCallback(() => {
    const status = useSimStore.getState().status;
    if (status === 'loading' || status === 'error') return;
    if (status === 'running') {
      client.current?.pause();
      useSimStore.setState({ status: 'paused' });
    } else {
      client.current?.play();
      useSimStore.setState({ status: 'running' });
    }
  }, []);
  const setSpeed = useCallback((speed: number) => {
    client.current?.setSpeed(speed);
    useSimStore.setState({ speed });
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useUiStore.setState({ cameraMode: 'overview', selectedJunction: null });
        return;
      }
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches('input,select,textarea,button') || e.target.isContentEditable)
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        play();
      }
      if (e.key === '?') {
        useUiStore.setState({ help: !useUiStore.getState().help });
        track('guide_opened', { source: 'keyboard' });
      }
      if (e.key === '[' || e.key === ']') {
        const i = SPEEDS.indexOf(useSimStore.getState().speed);
        setSpeed(SPEEDS[Math.max(0, Math.min(5, i + (e.key === ']' ? 1 : -1)))]);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [play, setSpeed]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  function choosePreset(id: string) {
    const c = { ...presetConfig(id), userCohort: useScenarioStore.getState().config.userCohort };
    useScenarioStore.getState().setConfig(c, id);
    if (network) start(c, id, network);
    track('preset_selected', { preset: id });
  }
  function rain(on: boolean, intensity: 0 | 1 | 2 = 1) {
    client.current?.setRain(on, intensity);
    useSimStore.setState({ rain: on });
    track('rain_toggled', { on });
  }
  function addDisruption(d: Disruption) {
    client.current?.addDisruption(d);
    setNotice('Disruption added to the running scenario.');
  }
  async function share() {
    try {
      const worker = client.current;
      const current = worker
        ? await new Promise<ScenarioConfig>((resolve, reject) => {
            const timer = setTimeout(() => {
              unsubscribe();
              reject(new Error('Could not read the running scenario. Try again.'));
            }, 5000);
            const unsubscribe = worker.on((m) => {
              if (m.type === 'stats') {
                clearTimeout(timer);
                unsubscribe();
                resolve(m.stats.config);
              }
            });
            worker.requestStats();
          })
        : null;
      const c = current ?? sim.runConfig ?? config;
      await navigator.clipboard.writeText(`${location.origin}/s/${encode(c)}`);
      setNotice('Scenario link copied.');
      track('share_copied', { source: 'sim' });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not copy link');
    }
  }
  const title = presets.find((p) => p.id === presetId)?.name ?? 'Custom',
    runTitle = presets.find((p) => p.id === sim.runPreset)?.name ?? 'Custom',
    myStats = sim.latestStats?.cohorts.find(
      (c) => c.cohort === (sim.runConfig?.userCohort ?? config.userCohort),
    );
  return (
    <div className={`simulator ${ui.panelOpen ? 'with-panel' : ''}`}>
      <aside className="scenario-sidebar" aria-label="Scenario panel">
        <div className="sidebar-title">
          <div>
            <p className="eyebrow">THE EXPERIMENT</p>
            <h2>Your scenario</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close scenarios"
            onClick={() => useUiStore.setState({ panelOpen: false })}
          >
            <PanelLeftClose size={19} />
          </Button>
        </div>
        <div className="segmented">
          <button
            className={ui.mode === 'presets' ? 'active' : ''}
            onClick={() => useUiStore.setState({ mode: 'presets' })}
          >
            Presets
          </button>
          <button
            className={ui.mode === 'expert' ? 'active' : ''}
            onClick={() => {
              useUiStore.setState({ mode: 'expert' });
              track('expert_mode_toggled', { enabled: true });
            }}
          >
            <SlidersHorizontal size={14} /> Expert mode
          </button>
        </div>
        <div className="sidebar-scroll">
          {ui.mode === 'presets' ? (
            <>
              <p className="sidebar-intro">
                A familiar day on a familiar road.
                <br />
                Pick one and see what changes.
              </p>
              <FirstRunHint step={1} minimum={1} />
              <PresetPicker onSelect={choosePreset} />
            </>
          ) : (
            <ExpertPanel
              network={network}
              onApply={() => network && start(config, presetId, network)}
              onRain={rain}
              onDisruption={addDisruption}
            />
          )}
        </div>
        <div className="sidebar-bottom">
          <Button variant="ghost" onClick={() => setSaveOpen(true)}>
            <Bookmark size={15} /> Saved scenarios
          </Button>
          <span className="mono small">SEED {config.seed}</span>
        </div>
      </aside>
      <section className="simulation-stage" aria-label="Traffic simulation">
        <div className="sim-topbar">
          <div>
            {!ui.panelOpen && (
              <Button
                variant="secondary"
                size="icon"
                aria-label="Open scenarios"
                onClick={() => useUiStore.setState({ panelOpen: true })}
              >
                <SlidersHorizontal size={18} />
              </Button>
            )}
            <span className="live-dot" />
            <h1>{runTitle}</h1>
            <span className="status-pill">
              {sim.status === 'ready'
                ? 'READY'
                : sim.skipping
                  ? 'COMPUTING'
                  : sim.status.toUpperCase()}
            </span>
          </div>
          <div>
            <span className="cohort-chip">
              {cohortLabel(sim.runConfig?.userCohort ?? config.userCohort)}
            </span>
            <Button variant="ghost" size="icon" aria-label="Share scenario" onClick={share}>
              <Share2 size={17} />
            </Button>
          </div>
        </div>
        <div className="junction-strip">
          {network?.junctions.map((j, i) => {
            const q = Math.max(
              sim.latestStats?.queues[i * 2] ?? 0,
              sim.latestStats?.queues[i * 2 + 1] ?? 0,
            );
            return (
              <button
                key={j.id}
                className={ui.selectedJunction === j.id ? 'active' : ''}
                onClick={() =>
                  useUiStore.setState({ selectedJunction: j.id, cameraMode: 'junction' })
                }
                title={`${queueClass(q)} · ${Math.round(q)} m queue`}
              >
                <i style={{ background: queueColor(q) }} />
                {j.id === 'silkBoard' ? 'Silk Board' : j.name}
                <span className="mono">{Math.round(q)}m</span>
              </button>
            );
          })}
        </div>
        {network && sim.runConfig ? (
          <MapCanvas network={network} config={sim.runConfig} />
        ) : (
          <div className="map-loading">
            <LoaderCircle className="spin" /> Loading corridor…
          </div>
        )}
        <div className="hud">
          <div>
            <span>Corridor speed</span>
            <strong>
              {(sim.latestStats?.meanSpeedKmh ?? 0).toFixed(1)} <small>km/h</small>
            </strong>
          </div>
          <div>
            <span>On the road</span>
            <strong>
              {number(sim.latestStats?.activeVehicles ?? snapshotRef.current?.count ?? 0)}
            </strong>
          </div>
          <div>
            <span>Completed trips</span>
            <strong>{number(sim.latestStats?.completedTrips ?? 0)}</strong>
          </div>
          <div>
            <span>Waiting to enter</span>
            <strong>{number(sim.latestStats?.unservedDemand ?? 0)}</strong>
          </div>
          <div className="your-stat">
            <span>Your cohort speed</span>
            <strong>
              {(myStats?.meanSpeedKmh ?? 0).toFixed(1)} <small>km/h</small>
            </strong>
          </div>
        </div>
        {ui.selectedJunction && (
          <div className="junction-card">
            <button
              aria-label="Close junction details"
              onClick={() => useUiStore.setState({ selectedJunction: null })}
            >
              <X size={14} />
            </button>
            <strong>{network?.junctions.find((j) => j.id === ui.selectedJunction)?.name}</strong>
            <p className="small muted">
              Approach queues:{' '}
              {Array.from(
                sim.latestStats?.queues.slice(
                  (network?.junctions.findIndex((j) => j.id === ui.selectedJunction) ?? 0) * 2,
                  (network?.junctions.findIndex((j) => j.id === ui.selectedJunction) ?? 0) * 2 + 2,
                ) ?? [],
              )
                .map((n) => `${Math.round(n)} m (${queueClass(n)})`)
                .join(' / ') || 'No samples yet'}
            </p>
          </div>
        )}
        <div className="playback">
          <FirstRunHint step={2} minimum={1} />
          <div className="playback-progress">
            <i style={{ width: `${sim.progress * 100}%` }} />
          </div>
          <div className="playback-row">
            <Button
              className="play-button"
              aria-label={sim.status === 'running' ? 'Pause simulation' : 'Play simulation'}
              disabled={sim.status === 'loading' || sim.skipping}
              onClick={play}
            >
              {sim.status === 'running' ? <Pause size={19} /> : <Play size={19} />}
            </Button>
            <div className="sim-clock">
              <strong className="mono">
                {clock(sim.runConfig?.startClock ?? config.startClock, sim.simTime)}
              </strong>
              <span>
                {Math.floor(sim.simTime / 60)} / {sim.runConfig?.durationMin ?? config.durationMin}{' '}
                min
              </span>
            </div>
            <div className="speed-chips" aria-label="Playback speed">
              {SPEEDS.map((s) => (
                <button aria-pressed={sim.speed === s} key={s} onClick={() => setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </div>
            <span className="playback-divider" />
            <Button
              variant={sim.rain ? 'secondary' : 'ghost'}
              size="icon"
              aria-label="Toggle rain"
              aria-pressed={sim.rain}
              onClick={() => rain(!sim.rain)}
            >
              <CloudRain size={19} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Map layers"
              onClick={() => setLayersOpen(!layersOpen)}
            >
              <Layers size={18} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Live charts"
              onClick={() => useUiStore.setState({ chartsVisible: !ui.chartsVisible })}
            >
              <ChartNoAxesCombined size={18} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Help"
              onClick={() => {
                useUiStore.setState({ help: true });
                track('guide_opened', { source: 'playback' });
              }}
            >
              <HelpCircle size={18} />
            </Button>
            <div className="playback-actions">
              <Button
                variant="ghost"
                size="sm"
                disabled={sim.status === 'loading' || sim.skipping}
                onClick={() => {
                  client.current?.skipToEnd();
                  useSimStore.setState({ skipping: true, status: 'running' });
                }}
              >
                <FastForward size={16} />{' '}
                {sim.skipping ? `${Math.round(sim.progress * 100)}%` : 'Skip to end'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={sim.status === 'loading'}
                onClick={() => {
                  finishRequested.current = true;
                  client.current?.pause();
                  client.current?.requestStats();
                }}
              >
                Finish now <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </div>
        {layersOpen && (
          <div className="layers-popup">
            <label>
              Colour vehicles by
              <select
                value={ui.colorMode}
                onChange={(e) => useUiStore.setState({ colorMode: e.target.value as ColorMode })}
              >
                <option value="type">Vehicle type</option>
                <option value="behaviour">Behaviour</option>
                <option value="speed">Speed</option>
                <option value="cohort">My cohort</option>
              </select>
            </label>
            {(['heat', 'queues', 'legendVisible'] as const).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={ui[key]}
                  onChange={(e) => useUiStore.setState({ [key]: e.target.checked })}
                />
                {key === 'heat'
                  ? 'Speed heatmap'
                  : key === 'queues'
                    ? 'Queue extents'
                    : 'Vehicle legend'}
              </label>
            ))}
          </div>
        )}
        {sim.error && (
          <div role="alert" className="sim-error">
            <h3>Simulation could not run</h3>
            <p>{sim.error}</p>
            <Button onClick={() => network && start(config, presetId, network)}>Retry</Button>
            <Link href="/">Back to commute picker</Link>
          </div>
        )}
      </section>
      <HelpSheet />
      <Sheet
        open={ui.chartsVisible}
        onOpenChange={(chartsVisible) => useUiStore.setState({ chartsVisible })}
        title="Live traffic"
      >
        <LiveCharts />
      </Sheet>
      <Sheet open={saveOpen} onOpenChange={setSaveOpen} title="Saved scenarios">
        <p className="muted">Kept in this browser. Share a link to take a scenario elsewhere.</p>
        <label className="field">
          Scenario name
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={title}
          />
        </label>
        <Button
          onClick={() => {
            try {
              useScenarioStore.getState().save(saveName || title);
              setNotice('Scenario saved.');
            } catch (e) {
              setNotice(String(e));
            }
          }}
        >
          Save current scenario
        </Button>
        {saved.map((s) => (
          <div className="saved-row" key={s.name}>
            <Button
              variant="ghost"
              onClick={() => {
                const c = decode(s.code);
                useScenarioStore.getState().setConfig(c);
                if (network) start(c, 'custom', network);
                setSaveOpen(false);
              }}
            >
              {s.name}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${s.name}`}
              onClick={() => useScenarioStore.getState().removeSave(s.name)}
            >
              <X size={16} />
            </Button>
          </div>
        ))}
      </Sheet>
      {notice && (
        <div role="status" className="toast">
          {notice}
        </div>
      )}
    </div>
  );
}
