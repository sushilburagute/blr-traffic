'use client';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
  Cell,
  ReferenceArea,
} from 'recharts';
import type { SimStats, NetworkData } from '@/sim/types';
import { cohortLabel, PROFILE_COLORS } from '@/lib/colors';
export default function ReportCharts({
  stats,
  network,
}: {
  stats: SimStats;
  network: NetworkData | null;
}) {
  const cohorts = stats.cohorts
    .filter((c) => c.endToEndTrips > 0)
    .map((c) => ({
      name: cohortLabel(c.cohort),
      minutes: (c.meanTravelTimeS ?? 0) / 60,
      speed: c.meanSpeedKmh,
      cohort: c.cohort,
    }));
  const speed = Array.from(stats.speedSeries.values, (value, i) => ({
    minute: i + 1,
    speed: value,
  }));
  const mine = stats.cohorts.find((c) => c.cohort === stats.config.userCohort)?.travelTimesS ?? [],
    others = stats.cohorts
      .filter((c) => c.cohort !== stats.config.userCohort)
      .flatMap((c) => c.travelTimesS);
  const max = Math.max(30, ...mine.map((t) => t / 60), ...others.map((t) => t / 60));
  const histogram = Array.from({ length: Math.ceil(max / 5) }, (_, i) => ({
    bin: `${i * 5}–${(i + 1) * 5}`,
    you: mine.filter((t) => t / 60 >= i * 5 && t / 60 < (i + 1) * 5).length,
    others: others.filter((t) => t / 60 >= i * 5 && t / 60 < (i + 1) * 5).length,
  }));
  const tooltip = { background: '#1a241d', border: '1px solid #3b4c3e', color: '#e5ede2' };
  return (
    <div className="report-charts">
      <section className="chart-card chart-wide">
        <p className="eyebrow">THE COHORT COMPARISON</p>
        <h2>Different rides. Same road.</h2>
        <p className="muted small">
          Mean completed end-to-end trip time, minutes. Groups without a completed trip are omitted.
        </p>
        {cohorts.length ? (
          <ResponsiveContainer width="100%" height={Math.max(240, cohorts.length * 32)}>
            <BarChart data={cohorts} layout="vertical" margin={{ left: 0, right: 25 }}>
              <CartesianGrid stroke="#303c33" horizontal={false} />
              <XAxis type="number" stroke="#8e9f94" fontSize={11} />
              <YAxis
                type="category"
                dataKey="name"
                width={180}
                stroke="#b3c0b6"
                fontSize={11}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltip} />
              <Bar dataKey="minutes" radius={[0, 3, 3, 0]}>
                {cohorts.map((c, i) => (
                  <Cell
                    key={c.cohort}
                    fill={
                      c.cohort === stats.config.userCohort
                        ? '#a7e7b4'
                        : `rgb(${PROFILE_COLORS[i % 3]})`
                    }
                    fillOpacity={c.cohort === stats.config.userCohort ? 1 : 0.55}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="chart-empty">
            No end-to-end trips finished yet. The table below still shows completed local trips and
            observed speeds.
          </p>
        )}
      </section>
      <section className="chart-card">
        <p className="eyebrow">THE ROAD OVER TIME</p>
        <h2>When things slowed down.</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={speed}>
            <CartesianGrid stroke="#303c33" vertical={false} />
            <XAxis dataKey="minute" stroke="#8e9f94" fontSize={11} />
            <YAxis stroke="#8e9f94" fontSize={11} unit=" km/h" />
            <Tooltip contentStyle={tooltip} />
            <Line dataKey="speed" stroke="#a7e7b4" dot={false} isAnimationActive={false} />
            {stats.events
              .filter((e) => e.simTime <= stats.simTime)
              .map((e, i) => (
                <ReferenceLine
                  key={i}
                  x={Math.ceil(e.simTime / 60) || 1}
                  stroke="#e5b86c"
                  strokeDasharray="3 3"
                  label={{
                    value: e.label,
                    fill: '#e5b86c',
                    fontSize: 10,
                    position: 'insideTopRight',
                  }}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section className="chart-card">
        <p className="eyebrow">THE DISTRIBUTION</p>
        <h2>Not every trip is average.</h2>
        <p className="muted small">Completed end-to-end trip counts in five-minute bins.</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={histogram}>
            <CartesianGrid stroke="#303c33" vertical={false} />
            <XAxis dataKey="bin" stroke="#8e9f94" fontSize={11} />
            <YAxis stroke="#8e9f94" fontSize={11} />
            <Tooltip contentStyle={tooltip} />
            <Legend />
            <Bar name="Your cohort" dataKey="you" fill="#a7e7b4" />
            <Bar name="Other cohorts" dataKey="others" fill="#658373" />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="chart-card chart-wide">
        <p className="eyebrow">AT THE JUNCTIONS</p>
        <h2>Where the queues built up.</h2>
        <div className="queue-chart-grid">
          {Array.from({ length: 6 }, (_, j) => {
            const a = stats.queueSeries[j * 2],
              b = stats.queueSeries[j * 2 + 1];
            const data = Array.from(a.values, (v, i) => ({
              minute: i + 1,
              towardMarathahalli: v,
              towardSilkBoard: b.values[i] ?? 0,
            }));
            return (
              <div key={j}>
                <h3>
                  {network?.junctions[j].name ??
                    [
                      'Silk Board',
                      'Agara',
                      'Iblur',
                      'Bellandur',
                      'Kadubeesanahalli',
                      'Marathahalli',
                    ][j]}
                </h3>
                <ResponsiveContainer width="100%" height={155}>
                  <LineChart data={data}>
                    <ReferenceArea y1={250} y2={500} fill="#f5c362" fillOpacity={0.07} />
                    <ReferenceArea y1={500} y2={750} fill="#ef9754" fillOpacity={0.07} />
                    <CartesianGrid stroke="#303c33" vertical={false} />
                    <XAxis dataKey="minute" stroke="#8e9f94" fontSize={10} />
                    <YAxis stroke="#8e9f94" fontSize={10} unit="m" domain={[0, 'auto']} />
                    <Tooltip contentStyle={tooltip} />
                    <Line
                      dataKey="towardMarathahalli"
                      name="To Marathahalli"
                      stroke="#a7e7b4"
                      dot={false}
                    />
                    <Line
                      dataKey="towardSilkBoard"
                      name="To Silk Board"
                      stroke="#e6bb76"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
