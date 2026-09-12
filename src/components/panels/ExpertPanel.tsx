'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useScenarioStore } from '@/store/scenarioStore';
import { useUiStore } from '@/store/uiStore';
import {
  JUNCTION_IDS,
  VEHICLE_TYPES,
  PROFILES,
  type NetworkData,
  type DeepPartial,
  type ScenarioConfig,
  type Disruption,
  type BehaviourParams,
} from '@/sim/types';
import { VEHICLE_LABELS, PROFILE_LABELS } from '@/lib/colors';
import { scenarioConfigSchema } from '@/lib/schema';
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="field">
      <span>
        {label}
        <output>
          {Number.isInteger(value) ? value : value.toFixed(2)} {unit}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function JsonField({
  label,
  value,
  onApply,
}: {
  label: string;
  value: unknown;
  onApply: (value: unknown) => void;
}) {
  const [text, setText] = useState<string | null>(null),
    [error, setError] = useState('');
  return (
    <details className="json-field">
      <summary>{label}</summary>
      <textarea
        aria-label={label}
        value={text ?? JSON.stringify(value, null, 2)}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={7}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          try {
            onApply(JSON.parse(text ?? JSON.stringify(value)));
            setText(null);
            setError('');
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Use these values
      </Button>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </details>
  );
}
function Section({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="expert-section" open={open}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
export function ExpertPanel({
  network,
  onApply,
  onRain,
  onDisruption,
}: {
  network: NetworkData | null;
  onApply: () => void;
  onRain: (on: boolean, intensity: 0 | 1 | 2) => void;
  onDisruption: (d: Disruption) => void;
}) {
  const c = useScenarioStore((s) => s.config),
    patch = useScenarioStore((s) => s.patch);
  const [dType, setDType] = useState<Disruption['type']>('accident'),
    [junction, setJunction] = useState<(typeof JUNCTION_IDS)[number]>('iblur'),
    [start, setStart] = useState(0),
    [duration, setDuration] = useState(15),
    [blocked, setBlocked] = useState(1),
    [error, setError] = useState('');
  function change(p: DeepPartial<ScenarioConfig>) {
    try {
      patch(p);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function normalizeMix(key: 'mix' | 'behaviourMix', name: string, n: number) {
    const current = c.demand[key];
    const entries = Object.entries(current);
    const remaining = entries.filter(([k]) => k !== name).reduce((s, [, v]) => s + v, 0);
    const next = Object.fromEntries(
      entries.map(([k, v]) => [
        k,
        k === name ? n : (100 - n) * (remaining ? v / remaining : 1 / (entries.length - 1)),
      ]),
    );
    change({ demand: { [key]: next } });
  }
  return (
    <div className="expert-panel">
      <p className="small muted">
        Edit the experiment, then restart. Rain and new disruptions can also be applied live.
      </p>
      <Section title="Demand" open>
        <RangeField
          label="Vehicles per hour"
          value={c.demand.vehPerHour}
          min={0}
          max={20000}
          step={250}
          onChange={(vehPerHour) => change({ demand: { vehPerHour } })}
        />
        <label className="field">
          Demand profile
          <select
            value={c.demand.profile}
            onChange={(e) =>
              change({
                demand: {
                  profile: e.target.value as ScenarioConfig['demand']['profile'],
                  ...(e.target.value === 'custom' ? { customCurve: Array(60).fill(1) } : {}),
                },
              })
            }
          >
            {['morning', 'evening', 'flat', 'custom'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {c.demand.profile === 'custom' && (
          <JsonField
            label="60-minute demand curve"
            value={c.demand.customCurve}
            onApply={(v) => change({ demand: { customCurve: v as number[] } })}
          />
        )}
        <details>
          <summary>Vehicle mix</summary>
          {VEHICLE_TYPES.map((t) => (
            <RangeField
              key={t}
              label={VEHICLE_LABELS[t]}
              value={c.demand.mix[t]}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => normalizeMix('mix', t, v)}
            />
          ))}
        </details>
        <details>
          <summary>Behaviour mix</summary>
          {PROFILES.map((p) => (
            <RangeField
              key={p}
              label={PROFILE_LABELS[p]}
              value={c.demand.behaviourMix[p]}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => normalizeMix('behaviourMix', p, v)}
            />
          ))}
        </details>
        <RangeField
          label="Through share"
          value={c.demand.throughShare}
          min={0}
          max={1}
          step={0.05}
          onChange={(throughShare) => change({ demand: { throughShare } })}
        />
        <JsonField
          label="Demand pulses"
          value={c.demand.pulses}
          onApply={(v) => change({ demand: { pulses: v as ScenarioConfig['demand']['pulses'] } })}
        />
        <JsonField
          label="Origin–destination matrix"
          value={c.demand.od ?? []}
          onApply={(v) => change({ demand: { od: v as number[][] } })}
        />
        <p className="small muted">
          Pulse fields: sourceId, startMin, durationMin, vehPerHour. Source IDs follow the network’s
          source list.
        </p>
      </Section>
      <Section title="Infrastructure">
        <RangeField
          label="Speed limit"
          value={c.infra.speedLimitKmh}
          min={10}
          max={100}
          step={5}
          unit="km/h"
          onChange={(speedLimitKmh) => change({ infra: { speedLimitKmh } })}
        />
        <Toggle
          label="Dedicated bus lane"
          value={c.infra.busLane}
          onChange={(busLane) => change({ infra: { busLane } })}
        />
        <details>
          <summary>Lanes by segment</summary>
          {network?.segments
            .filter((s) => s.kind === 'main')
            .map((s) => (
              <RangeField
                key={s.id}
                label={`${s.fromJunction} → ${s.toJunction}`}
                value={c.infra.lanesOverride?.[s.id] ?? s.lanes}
                min={1}
                max={5}
                onChange={(v) => change({ infra: { lanesOverride: { [s.id]: v } } })}
              />
            ))}
        </details>
        <details>
          <summary>Flyovers & U-turns</summary>
          {JUNCTION_IDS.map((j) => (
            <div key={j}>
              <Toggle
                label={`${j} flyover`}
                value={c.infra.flyovers[j]}
                onChange={(v) => change({ infra: { flyovers: { [j]: v } } })}
              />
              <Toggle
                label={`${j} U-turn merge`}
                value={c.infra.uTurns[j]}
                onChange={(v) => change({ infra: { uTurns: { [j]: v } } })}
              />
            </div>
          ))}
          <p className="small muted">
            Flyovers only operate where the network has a verified bypass. The fallback network has
            none.
          </p>
        </details>
        <JsonField
          label="Encroachment sections"
          value={c.infra.encroachment}
          onApply={(v) =>
            change({ infra: { encroachment: v as ScenarioConfig['infra']['encroachment'] } })
          }
        />
        <JsonField
          label="Bus stops & dwell times"
          value={c.infra.busStops}
          onApply={(v) => change({ infra: { busStops: v as ScenarioConfig['infra']['busStops'] } })}
        />
      </Section>
      <Section title="Signal plans">
        {JUNCTION_IDS.map((j) => (
          <details key={j}>
            <summary>{network?.junctions.find((n) => n.id === j)?.name ?? j}</summary>
            <RangeField
              label={`${j} cycle`}
              value={c.infra.signals[j].cycleS}
              min={30}
              max={240}
              step={10}
              unit="s"
              onChange={(cycleS) => {
                const old = c.infra.signals[j];
                const factor = cycleS / old.cycleS;
                change({
                  infra: {
                    signals: {
                      [j]: {
                        ...old,
                        cycleS,
                        phases: old.phases.map((p) => ({
                          ...p,
                          greenS: p.greenS * factor,
                          amberS: p.amberS * factor,
                        })),
                      },
                    },
                  },
                });
              }}
            />
            <RangeField
              label={`${j} ORR green share`}
              min={0.15}
              max={0.8}
              step={0.05}
              value={c.infra.signals[j].phases[0].greenS / c.infra.signals[j].cycleS}
              onChange={(share) => {
                const plan = c.infra.signals[j],
                  green = plan.cycleS * share,
                  other = plan.phases.slice(1).reduce((a, p) => a + p.greenS + p.amberS, 0),
                  factor = (plan.cycleS - green - plan.phases[0].amberS) / other;
                change({
                  infra: {
                    signals: {
                      [j]: {
                        ...plan,
                        phases: [
                          { ...plan.phases[0], greenS: green },
                          ...plan.phases.slice(1).map((p) => ({
                            ...p,
                            greenS: p.greenS * factor,
                            amberS: p.amberS * factor,
                          })),
                        ],
                      },
                    },
                  },
                });
              }}
            />
            <JsonField
              label={`${j} phase plan`}
              value={c.infra.signals[j]}
              onApply={(v) =>
                change({
                  infra: { signals: { [j]: v as ScenarioConfig['infra']['signals'][typeof j] } },
                })
              }
            />
          </details>
        ))}
      </Section>
      <Section title="Disruptions">
        {c.disruptions.map((d) => (
          <div className="disruption-row" key={d.id}>
            <span>
              <strong>{d.type}</strong>
              <small>
                {d.junctionId ?? d.segmentId} · {d.startMin}–{d.startMin + d.durationMin} min
              </small>
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove ${d.type}`}
              onClick={() => change({ disruptions: c.disruptions.filter((x) => x.id !== d.id) })}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
        <label className="field">
          Incident type
          <select value={dType} onChange={(e) => setDType(e.target.value as Disruption['type'])}>
            {[
              'accident',
              'breakdown',
              'construction',
              'waterlogging',
              'illegalParking',
              'brokenSignal',
              'event',
              'closure',
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Junction
          <select value={junction} onChange={(e) => setJunction(e.target.value as typeof junction)}>
            {JUNCTION_IDS.map((j) => (
              <option key={j} value={j}>
                {network?.junctions.find((n) => n.id === j)?.name ?? j}
              </option>
            ))}
          </select>
        </label>
        <RangeField label="Start minute" value={start} min={0} max={60} onChange={setStart} />
        <RangeField
          label="Incident duration"
          value={duration}
          min={1}
          max={60}
          unit="min"
          onChange={setDuration}
        />
        <RangeField label="Lanes blocked" value={blocked} min={1} max={3} onChange={setBlocked} />
        <Button
          variant="outline"
          onClick={() => {
            const d: Disruption = {
              id: `incident-${c.disruptions.length}-${junction}-${start}`,
              type: dType,
              junctionId: junction,
              startMin: start,
              durationMin: duration,
              sOffset: 0,
              params: { lanesBlocked: blocked },
            };
            change({ disruptions: [...c.disruptions, d] });
            onDisruption(d);
          }}
        >
          <Plus size={15} /> Add disruption live
        </Button>
        <JsonField
          label="Detailed disruption locations"
          value={c.disruptions}
          onApply={(v) => change({ disruptions: v as Disruption[] })}
        />
      </Section>
      <Section title="Environment">
        <Toggle
          label="Rain"
          value={c.environment.rain}
          onChange={(rain) => {
            change({ environment: { rain, rainIntensity: rain ? 1 : 0 } });
            onRain(rain, rain ? 1 : 0);
          }}
        />
        <RangeField
          label="Rain intensity"
          value={c.environment.rainIntensity}
          min={0}
          max={2}
          onChange={(v) => {
            const rainIntensity = v as 0 | 1 | 2;
            change({ environment: { rain: v > 0, rainIntensity } });
            onRain(v > 0, rainIntensity);
          }}
        />
        <RangeField
          label="Potholes"
          value={c.environment.potholes}
          min={0}
          max={60}
          onChange={(potholes) => change({ environment: { potholes } })}
        />
        <RangeField
          label="Speed breakers"
          value={c.environment.speedBreakers}
          min={0}
          max={30}
          onChange={(speedBreakers) => change({ environment: { speedBreakers } })}
        />
        <Button
          variant="outline"
          onClick={() => useUiStore.setState({ pinObstacle: true, panelOpen: false })}
        >
          Pin a pothole on the map
        </Button>
        <JsonField
          label="Pinned obstacles"
          value={c.environment.pinnedObstacles ?? []}
          onApply={(v) =>
            change({
              environment: {
                pinnedObstacles: v as ScenarioConfig['environment']['pinnedObstacles'],
              },
            })
          }
        />
      </Section>
      <Section title="Driving behaviour">
        {PROFILES.map((p) => (
          <details key={p}>
            <summary>{PROFILE_LABELS[p]}</summary>
            {[
              ['politeness', 0, 1, 0.05],
              ['bSafe', 0.5, 6, 0.1],
              ['aThr', 0, 2, 0.05],
              ['lcCooldown', 0.5, 30, 0.5],
              ['gapFactor', 0.3, 2, 0.05],
              ['filterProb', 0, 1, 0.05],
              ['amberRunProb', 0, 1, 0.05],
              ['redRunProb', 0, 1, 0.05],
              ['reactionTime', 0.1, 1, 0.1],
              ['routeChangeProb', 0, 1, 0.05],
              ['busLaneViolationProb', 0, 1, 0.05],
            ].map(([name, min, max, step]) => (
              <label className="field" key={name}>
                <span>
                  {name} <small>leave blank for default</small>
                </span>
                <input
                  aria-label={`${p} ${name}`}
                  type="number"
                  min={Number(min)}
                  max={Number(max)}
                  step={Number(step)}
                  value={c.behaviour[p][name as keyof BehaviourParams] ?? ''}
                  onChange={(e) =>
                    change({
                      behaviour: {
                        [p]: { [name]: e.target.value === '' ? undefined : Number(e.target.value) },
                      },
                    })
                  }
                />
              </label>
            ))}
          </details>
        ))}
      </Section>
      <Section title="Lane squeeze">
        <Toggle
          label="Allow virtual extra lane"
          value={c.squeeze.enabled}
          onChange={(enabled) => change({ squeeze: { enabled } })}
        />
        <RangeField
          label="Density threshold"
          value={c.squeeze.densityThreshold}
          min={10}
          max={400}
          step={10}
          unit="veh/km"
          onChange={(densityThreshold) => change({ squeeze: { densityThreshold } })}
        />
        <RangeField
          label="Virtual lane speed cap"
          value={c.squeeze.virtualLaneSpeedCapKmh}
          min={5}
          max={40}
          unit="km/h"
          onChange={(virtualLaneSpeedCapKmh) => change({ squeeze: { virtualLaneSpeedCapKmh } })}
        />
      </Section>
      <Section title="Run settings" open>
        <RangeField
          label="Duration"
          value={c.durationMin}
          min={5}
          max={60}
          step={5}
          unit="min"
          onChange={(durationMin) => change({ durationMin })}
        />
        <label className="field">
          Random seed
          <input
            aria-label="Random seed"
            type="number"
            min={0}
            max={4294967295}
            value={c.seed}
            onChange={(e) => change({ seed: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          Start clock
          <input
            aria-label="Start clock"
            type="time"
            value={c.startClock}
            onChange={(e) => change({ startClock: e.target.value })}
          />
        </label>
      </Section>
      <JsonField
        label="Complete scenario JSON"
        value={c}
        onApply={(v) => useScenarioStore.getState().setConfig(scenarioConfigSchema.parse(v))}
      />
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <Button className="apply-button" onClick={onApply}>
        Apply & restart
      </Button>
    </div>
  );
}
