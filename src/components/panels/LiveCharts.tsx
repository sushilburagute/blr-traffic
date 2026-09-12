'use client';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useSimStore } from '@/store/simStore';
import { queueColor } from '@/lib/colors';
import { PROFILE_COLORS, PROFILE_LABELS } from '@/lib/colors';
import { PROFILES, type Cohort } from '@/sim/types';
export default function LiveCharts() {
  const stats = useSimStore((s) => s.latestStats);
  if (!stats || !stats.speedSeries.values.length)
    return <p className="muted small">Charts begin after the first simulated minute.</p>;
  const speeds = Array.from(stats.speedSeries.values, (speed, i) => ({ minute: i + 1, speed }));
  const type = stats.config.userCohort.split(':')[0];
  const cohortSpeeds = speeds.map((point, i) => ({
    ...point,
    ...Object.fromEntries(
      PROFILES.map((p) => [p, stats.cohortSpeedSeries[`${type}:${p}` as Cohort]?.values[i] ?? 0]),
    ),
  }));
  return (
    <div className="live-charts">
      <h3>Corridor speed</h3>
      <p className="small muted">km/h · sampled every simulated minute</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={speeds}>
          <CartesianGrid stroke="#303c33" vertical={false} />
          <XAxis dataKey="minute" stroke="#8e9f94" fontSize={11} />
          <YAxis stroke="#8e9f94" fontSize={11} />
          <Tooltip contentStyle={{ background: '#1a241d', borderColor: '#3b4c3e' }} />
          <Line dataKey="speed" stroke="#a7e7b4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <h3>Your ride, three driving styles</h3>
      <p className="small muted">
        Observed cohort speed, km/h. Zero means no vehicles in that cohort during the sampled
        minute.
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={cohortSpeeds}>
          <CartesianGrid stroke="#303c33" vertical={false} />
          <XAxis dataKey="minute" stroke="#8e9f94" fontSize={11} />
          <YAxis stroke="#8e9f94" fontSize={11} />
          <Tooltip contentStyle={{ background: '#1a241d', borderColor: '#3b4c3e' }} />
          {PROFILES.map((p, i) => (
            <Line
              key={p}
              dataKey={p}
              name={PROFILE_LABELS[p]}
              stroke={`rgb(${PROFILE_COLORS[i]})`}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <h3>Approach queues</h3>
      {['Silk Board', 'Agara', 'Iblur', 'Bellandur', 'Kadubeesanahalli', 'Marathahalli'].map(
        (name, i) => (
          <div className="queue-mini" key={name}>
            <span>{name}</span>
            <span
              className="mono"
              style={{ color: queueColor(Math.max(stats.queues[i * 2], stats.queues[i * 2 + 1])) }}
            >
              {Math.round(Math.max(stats.queues[i * 2], stats.queues[i * 2 + 1]))} m
            </span>
            <div className="progress-track">
              <i
                style={{
                  width: `${Math.min(100, Math.max(stats.queues[i * 2], stats.queues[i * 2 + 1]) / 10)}%`,
                  background: queueColor(Math.max(stats.queues[i * 2], stats.queues[i * 2 + 1])),
                }}
              />
            </div>
          </div>
        ),
      )}
    </div>
  );
}
