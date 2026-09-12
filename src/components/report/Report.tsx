'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Download, RotateCcw, Share2, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSimStore } from '@/store/simStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { createHeadlessRun, fetchNetwork } from '@/lib/simClient';
import { compare, type Comparison } from '@/lib/compare';
import { scenarioConfigSchema } from '@/lib/schema';
import { verdicts } from '@/lib/verdict';
import { presets } from '@/lib/presets';
import { cohortLabel, queueColor } from '@/lib/colors';
import { minutes, number } from '@/lib/units';
import { queueClass } from '@/sim/stats';
import { encode } from '@/lib/share';
import { track } from '@/lib/analytics';
import type { SimStats, NetworkData } from '@/sim/types';
const Charts = dynamic(() => import('./ReportCharts'), {
  ssr: false,
  loading: () => <p className="muted">Loading charts…</p>,
});
export function Report() {
  const stats = useSimStore((s) => s.latestStats),
    hydrated = useScenarioStore((s) => s.hydrated),
    runPreset = useSimStore((s) => s.runPreset);
  const [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [network, setNetwork] = useState<NetworkData | null>(null),
    [comparison, setComparison] = useState<SimStats | null>(null),
    [compareKind, setCompareKind] = useState<Comparison>('no-squeeze'),
    [comparing, setComparing] = useState(false),
    [compareProgress, setCompareProgress] = useState(0),
    [notice, setNotice] = useState('');
  const comparisonAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchNetwork(controller.signal)
      .then(setNetwork)
      .catch(() => {});
    return () => {
      controller.abort();
      comparisonAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (stats || !hydrated) return;
    const controller = new AbortController();
    let config = useScenarioStore.getState().config;
    let untilS: number | undefined;
    try {
      const raw = sessionStorage.getItem('blr-last-run');
      if (raw) {
        const stored = JSON.parse(raw);
        config = scenarioConfigSchema.parse(stored.config);
        if (
          typeof stored.untilS === 'number' &&
          stored.untilS >= 0 &&
          stored.untilS <= config.durationMin * 60
        )
          untilS = stored.untilS;
        useSimStore.setState({ runPreset: stored.preset ?? 'custom', runConfig: config });
      }
    } catch {
      /* Invalid local cache falls back to the validated scenario store. */
    }
    createHeadlessRun(config, setProgress, controller.signal, untilS)
      .then((stats) => useSimStore.setState({ latestStats: stats, status: 'finished' }))
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [stats, hydrated]);
  useEffect(() => {
    if (stats) track('report_viewed', { cohort: stats.config.userCohort });
  }, [stats]);
  if (!stats)
    return (
      <div className="empty-state">
        <p className="eyebrow">REBUILDING YOUR REPORT</p>
        <h1>{error ? 'The run could not finish.' : 'Replaying your commute.'}</h1>
        <p className="muted">
          {error || 'Results live in memory. We’re rerunning your saved configuration and seed.'}
        </p>
        {!error && (
          <>
            <LoaderCircle className="spin" />
            <div className="progress-track">
              <i style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="mono">{Math.round(progress * 100)}%</p>
          </>
        )}
        <Link href="/sim">Back to the simulator</Link>
      </div>
    );
  const user = stats.cohorts.find((c) => c.cohort === stats.config.userCohort)!,
    title = presets.find((p) => p.id === runPreset)?.name ?? 'Custom scenario',
    peak = Math.max(...stats.maxQueues),
    verdict = verdicts(stats, comparison ?? undefined);
  async function share() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/s/${encode(stats!.config)}?result=1&until=${stats!.simTime.toFixed(1)}`,
      );
      setNotice('Result link copied. Opening it replays this scenario.');
      track('share_copied', { source: 'report' });
    } catch (e) {
      setNotice(String(e));
    }
  }
  function download() {
    const json = JSON.stringify(
      { config: stats!.config, stats },
      (_, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v),
      2,
    );
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })),
      a = document.createElement('a');
    a.href = url;
    a.download = `blr-traffic-${stats!.config.seed}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function deepCompare() {
    comparisonAbort.current?.abort();
    const controller = new AbortController();
    comparisonAbort.current = controller;
    setComparing(true);
    setCompareProgress(0);
    setError('');
    try {
      setComparison(
        await compare(
          stats!.config,
          compareKind,
          setCompareProgress,
          controller.signal,
          stats!.simTime,
        ),
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(String(e));
    } finally {
      if (!controller.signal.aborted) setComparing(false);
    }
  }
  return (
    <div className="report-page">
      <div className="report-heading">
        <p className="eyebrow">YOUR COMMUTE, UNPACKED</p>
        <span className="mono small muted">
          SEED {stats.config.seed} · {(stats.simTime / 60).toFixed(0)} SIMULATED MINUTES
        </span>
      </div>
      <h1>So, how was the drive?</h1>
      <p className="lead">
        You commuted as <strong>{cohortLabel(stats.config.userCohort)}</strong>
        <br />
        on <strong>{title}</strong>.
      </p>
      <div className="report-hero">
        <div className="trip-hero">
          <span>YOUR AVERAGE END-TO-END TRIP</span>
          <strong>
            {user.meanTravelTimeS === null ? '—' : (user.meanTravelTimeS / 60).toFixed(1)}
            <small>{user.meanTravelTimeS === null ? 'No completed trips' : 'minutes'}</small>
          </strong>
          <p>
            {user.endToEndTrips} completed end-to-end trips · median{' '}
            {minutes(user.medianTravelTimeS)} · p90 {minutes(user.p90TravelTimeS)}
          </p>
        </div>
        <div className="report-kpis">
          <div>
            <span>Average speed</span>
            <strong>
              {user.meanSpeedKmh.toFixed(1)} <small>km/h</small>
            </strong>
          </div>
          <div>
            <span>Stops / trip</span>
            <strong>{user.stopsPerTrip.toFixed(1)}</strong>
          </div>
          <div>
            <span>Lane changes / trip</span>
            <strong>{user.laneChangesPerTrip.toFixed(1)}</strong>
          </div>
          <div>
            <span>Hard brakes / trip</span>
            <strong>{user.hardBrakesPerTrip.toFixed(1)}</strong>
          </div>
          <div>
            <span>Time in a queue</span>
            <strong>
              {(user.queueTimeShare * 100).toFixed(0)}
              <small>%</small>
            </strong>
          </div>
          <div>
            <span>Peak approach queue</span>
            <strong style={{ color: queueColor(peak) }}>
              {queueClass(peak)}
              <small> · {Math.round(peak)} m</small>
            </strong>
          </div>
        </div>
      </div>
      <p className="report-note">
        Travel-time statistics include completed end-to-end trips only; unfinished trips can bias
        these averages. Speed and queue share include active trips. Stops, lane changes and hard
        brakes use all completed trips.{' '}
        <Link href="/guide#report">
          How to read the report <ArrowUpRight size={12} />
        </Link>
      </p>
      <div className="verdict-panel">
        <p className="eyebrow">WHAT THE EXPERIMENT SAYS</p>
        {verdict.map((v) => (
          <p key={v}>{v}</p>
        ))}
      </div>
      <Charts stats={stats} network={network} />
      <div className="report-secondary">
        <section className="chart-card">
          <p className="eyebrow">IF THIS WERE YOUR EVERYDAY</p>
          <h2>
            {user.hoursLostPerYear === null ? '—' : Math.round(user.hoursLostPerYear)}{' '}
            <span className="muted">hours lost / year</span>
          </h2>
          <p className="muted small">
            max(0, average trip − {minutes(stats.freeFlowTravelTimeS)} free flow) × 2 trips × 250
            days ÷ 60. An illustrative extrapolation of this run.
          </p>
        </section>
        <section className="chart-card">
          <p className="eyebrow">THROUGH THE CORRIDOR</p>
          <h2>{number(stats.completedTrips)} completed trips</h2>
          <div className="throughput">
            <span>
              To Marathahalli <strong>{number(stats.throughput.toMarathahalli)}</strong>
            </span>
            <span>
              To Silk Board <strong>{number(stats.throughput.toSilkBoard)}</strong>
            </span>
          </div>
          <p className="muted small">
            {number(stats.activeVehicles)} still travelling · {number(stats.unservedDemand)}{' '}
            unserved arrivals.
          </p>
        </section>
      </div>
      <div className="context-note">
        <strong>A citywide point of reference.</strong> TomTom’s 2025 Bengaluru index reports 74.4%
        congestion and 13.9 km/h rush-hour speed. This run’s end-to-end congestion is{' '}
        {stats.congestionPct === null ? 'not available' : `${stats.congestionPct.toFixed(1)}%`};
        final corridor speed is {stats.meanSpeedKmh.toFixed(1)} km/h. Different geography and
        methods; this is not a calibration target.{' '}
        <a href="https://www.tomtom.com/traffic-index/city/bengaluru/">
          Source <ArrowUpRight size={12} />
        </a>
      </div>
      <section className="chart-card cohort-table">
        <p className="eyebrow">ALL THE NUMBERS</p>
        <h2>Your cohort in context.</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  'Cohort',
                  'Trips',
                  'Full corridor',
                  'Mean min',
                  'Median',
                  'p90',
                  'km/h',
                  'Stops',
                  'Changes',
                  'Brakes',
                  'Queue %',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.cohorts.map((c) => (
                <tr key={c.cohort} className={c.cohort === user.cohort ? 'highlight' : ''}>
                  <td>{cohortLabel(c.cohort)}</td>
                  <td>{c.completedTrips}</td>
                  <td>{c.endToEndTrips}</td>
                  <td>{c.meanTravelTimeS === null ? '—' : (c.meanTravelTimeS / 60).toFixed(1)}</td>
                  <td>{minutes(c.medianTravelTimeS)}</td>
                  <td>{minutes(c.p90TravelTimeS)}</td>
                  <td>{c.meanSpeedKmh.toFixed(1)}</td>
                  <td>{c.stopsPerTrip.toFixed(1)}</td>
                  <td>{c.laneChangesPerTrip.toFixed(1)}</td>
                  <td>{c.hardBrakesPerTrip.toFixed(1)}</td>
                  <td>{(c.queueTimeShare * 100).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="deep-compare">
        <div>
          <p className="eyebrow">ONE CHANGE. SAME SEED.</p>
          <h2>What if the rules changed?</h2>
          <p className="muted">Run a second experiment in the background.</p>
        </div>
        <div>
          <label className="sr-only" htmlFor="comparison">
            Comparison scenario
          </label>
          <select
            id="comparison"
            disabled={comparing}
            value={compareKind}
            onChange={(e) => {
              setCompareKind(e.target.value as Comparison);
              setComparison(null);
            }}
          >
            <option value="no-squeeze">Without lane squeezing</option>
            <option value="no-rain">Without rain and waterlogging</option>
            <option value="disciplined">Everyone follows their lane</option>
          </select>
          <Button disabled={comparing} onClick={deepCompare}>
            {comparing ? (
              <>
                <LoaderCircle className="spin" size={16} />
                {Math.round(compareProgress * 100)}%
              </>
            ) : (
              <>
                Deep compare <ArrowRight size={16} />
              </>
            )}
          </Button>
        </div>
        {comparison && (
          <p className="comparison-result">
            Comparison completed: {comparison.completedTrips} trips, {comparison.activeVehicles}{' '}
            still travelling. {verdicts(stats, comparison).at(-1)}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      <div className="report-actions">
        <Button asChild>
          <Link
            href="/sim"
            onClick={() => useScenarioStore.getState().setConfig(stats.config, runPreset)}
          >
            <RotateCcw size={16} /> Run again
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Change my commute</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sim" onClick={() => useScenarioStore.getState().setPreset('sunday-morning')}>
            Try Sunday morning
          </Link>
        </Button>
        <Button variant="ghost" onClick={share}>
          <Share2 size={16} /> Share result
        </Button>
        <Button variant="ghost" onClick={download}>
          <Download size={16} /> Download JSON
        </Button>
      </div>
      {notice && (
        <p role="status" className="context-note">
          {notice}
        </p>
      )}
    </div>
  );
}
