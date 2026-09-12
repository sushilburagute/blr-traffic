'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  LoaderCircle,
  RotateCw,
  Route,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommutePicker } from '@/components/panels/CommutePicker';
import { loadAssets, type Asset } from '@/lib/assetLoader';
import { useScenarioStore } from '@/store/scenarioStore';
import { FirstRunHint } from '@/components/ui/FirstRunHint';
export function Landing() {
  const router = useRouter(),
    config = useScenarioStore((s) => s.config),
    hydrated = useScenarioStore((s) => s.hydrated);
  const [assets, setAssets] = useState<Asset[]>([]),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    void loadAssets(useScenarioStore.getState().config, setAssets, controller.signal);
    return () => controller.abort();
  }, [hydrated, attempt]);
  const complete = assets.filter((a) => a.state === 'ready' || a.state === 'fallback').length,
    ready = assets.length > 0 && complete === assets.length,
    pct = Math.round((complete / Math.max(1, assets.length)) * 100),
    failed = assets.some((a) => a.state === 'error');
  return (
    <div className="landing">
      <section className="landing-story">
        <div className="eyebrow">
          <i /> A BENGALURU COMMUTE EXPERIMENT
        </div>
        <h1>
          Your commute.
          <br />A thousand
          <br />
          <em>moving parts.</em>
        </h1>
        <p className="lead">
          Same road. Different rules. See how the way we drive changes the way we all get home.
        </p>
        <div className="corridor-preview">
          <div className="route-caption">
            <span>
              <Route size={15} /> THE OUTER RING ROAD
            </span>
            <span className="mono">~11 KM · BOTH WAYS</span>
          </div>
          <svg
            viewBox="0 0 560 145"
            role="img"
            aria-label="Corridor from Silk Board through Agara, Iblur, Bellandur and Kadubeesanahalli to Marathahalli"
          >
            <defs>
              <linearGradient id="road-gradient">
                <stop stopColor="#a7e7b4" />
                <stop offset="1" stopColor="#e8c884" />
              </linearGradient>
            </defs>
            <path
              d="M24 97 L111 97 Q137 97 156 77 L203 49 Q219 39 247 39 L315 39 Q332 39 348 62 L370 86 Q380 96 400 96 L465 96 Q489 96 532 29"
              fill="none"
              stroke="#2f3933"
              strokeWidth="14"
            />
            <path
              d="M24 97 L111 97 Q137 97 156 77 L203 49 Q219 39 247 39 L315 39 Q332 39 348 62 L370 86 Q380 96 400 96 L465 96 Q489 96 532 29"
              fill="none"
              stroke="url(#road-gradient)"
              strokeWidth="2"
              strokeDasharray="3 5"
            />
            {[
              [24, 97, 'Silk Board'],
              [129, 92, 'Agara'],
              [232, 39, 'Iblur'],
              [336, 49, 'Bellandur'],
              [420, 96, 'Kadubeesanahalli'],
              [532, 29, 'Marathahalli'],
            ].map(([x, y, label], i) => (
              <g key={label}>
                <circle
                  cx={x}
                  cy={y}
                  r={6}
                  fill="#171e19"
                  stroke={i === 5 ? '#e8c884' : '#a7e7b4'}
                  strokeWidth={2}
                />
                <text
                  x={x}
                  y={Number(y) + (i === 5 ? -17 : 28)}
                  textAnchor={i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}
                  fill="#a5b0a8"
                  fontSize={11}
                >
                  {label}
                </text>
              </g>
            ))}
          </svg>
          <p className="map-disclaimer">Schematic route · approximate corridor geometry</p>
        </div>
        <div className="landing-bottom">
          <span>
            <ShieldCheck size={16} /> Runs in your browser. Free to explore.
          </span>
          <Link href="/guide">
            How does it work? <ArrowUpRight size={15} />
          </Link>
        </div>
      </section>
      <section className="commute-panel">
        <div className="panel-kicker">
          <span className="eyebrow">MAKE IT YOUR COMMUTE</span>
          <span className="mono muted">01 / 02</span>
        </div>
        <h2>How do you get there?</h2>
        <p className="muted">Pick your ride. Be honest about the rest.</p>
        <CommutePicker value={config.userCohort} onChange={useScenarioStore.getState().setCohort} />
        <FirstRunHint step={0} />
        <div className="asset-loader">
          <div className="asset-heading">
            <span>
              {ready
                ? 'The corridor is ready'
                : failed
                  ? 'Something needs a retry'
                  : 'Getting the corridor ready'}
            </span>
            <strong className="mono">{pct}%</strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Asset loading"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="asset-list">
            {assets.map((a) => (
              <span title={a.detail} key={a.name}>
                {a.state === 'ready' ? (
                  <Check size={12} />
                ) : a.state === 'fallback' ? (
                  <TriangleAlert size={12} />
                ) : (
                  <LoaderCircle size={12} className={a.state === 'loading' ? 'spin' : ''} />
                )}{' '}
                {a.name}
                {a.state === 'fallback' ? ' (offline fallback)' : ''}
              </span>
            ))}
          </div>
        </div>
        {failed ? (
          <Button className="start-button" onClick={() => setAttempt((a) => a + 1)}>
            <RotateCw size={18} /> Retry loading
          </Button>
        ) : (
          <Button className="start-button" disabled={!ready} onClick={() => router.push('/sim')}>
            Let’s hit the road <ArrowRight size={19} />
          </Button>
        )}
        <p className="under-button">Next up: choose your traffic scenario.</p>
      </section>
    </div>
  );
}
