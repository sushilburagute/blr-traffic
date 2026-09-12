'use client';
import type { NetworkData } from '@/sim/types';
import { speedColor } from '@/lib/colors';
export function Minimap({
  network,
  bounds,
  speeds,
  onJump,
}: {
  network: NetworkData;
  bounds: [number, number, number, number] | null;
  speeds: Float32Array | undefined;
  onJump: (lon: number, lat: number) => void;
}) {
  const points = network.junctions.map((j) => j.lonlat),
    minX = Math.min(...points.map((p) => p[0])) - 0.005,
    maxX = Math.max(...points.map((p) => p[0])) + 0.005,
    minY = Math.min(...points.map((p) => p[1])) - 0.008,
    maxY = Math.max(...points.map((p) => p[1])) + 0.008;
  const xy = (lon: number, lat: number) => [
    ((lon - minX) / (maxX - minX)) * 210,
    85 - ((lat - minY) / (maxY - minY)) * 85,
  ];
  return (
    <div className="minimap">
      <div className="minimap-caption">
        CORRIDOR OVERVIEW <span>↗ N</span>
      </div>
      <svg
        viewBox="0 0 210 85"
        role="button"
        aria-label="Return to corridor overview using minimap"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onJump((minX + maxX) / 2, (minY + maxY) / 2);
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onJump(
            minX + ((e.clientX - rect.left) / rect.width) * (maxX - minX),
            maxY - ((e.clientY - rect.top) / rect.height) * (maxY - minY),
          );
        }}
      >
        {network.segments
          .filter((s) => s.kind === 'main')
          .map((s) => {
            const index = network.segments.indexOf(s);
            return (
              <polyline
                key={s.id}
                points={s.polyline.map((p) => xy(...p).join(',')).join(' ')}
                fill="none"
                stroke={`rgb(${speedColor(speeds?.[index] ?? -1).join(',')})`}
                strokeWidth={2}
              />
            );
          })}
        {network.junctions.map((j) => {
          const [x, y] = xy(...j.lonlat);
          return <circle key={j.id} cx={x} cy={y} r={2.5} fill="#dfe8da" />;
        })}
        {bounds &&
          (() => {
            const a = xy(bounds[0], bounds[3]),
              b = xy(bounds[2], bounds[1]);
            return (
              <rect
                x={Math.max(0, a[0])}
                y={Math.max(0, a[1])}
                width={Math.max(0, Math.min(210, b[0]) - Math.max(0, a[0]))}
                height={Math.max(0, Math.min(85, b[1]) - Math.max(0, a[1]))}
                fill="#a7e7b411"
                stroke="#d6e9db"
                strokeDasharray="3 2"
              />
            );
          })()}
      </svg>
    </div>
  );
}
