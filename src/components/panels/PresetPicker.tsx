'use client';
import {
  Sun,
  CloudRain,
  TriangleAlert,
  Construction,
  TrafficCone,
  Building2,
  Coffee,
  Sparkles,
  Zap,
  Check,
} from 'lucide-react';
import { presets } from '@/lib/presets';
import { useScenarioStore } from '@/store/scenarioStore';
const icons = [
  Sun,
  CloudRain,
  TriangleAlert,
  Construction,
  TrafficCone,
  Building2,
  Coffee,
  Sparkles,
  Zap,
];
export function PresetPicker({ onSelect }: { onSelect: (id: string) => void }) {
  const current = useScenarioStore((s) => s.presetId);
  return (
    <div className="presets-list">
      {presets.map((p, i) => {
        const Icon = icons[i];
        return (
          <button
            key={p.id}
            className={`preset-card ${current === p.id ? 'selected' : ''}`}
            onClick={() => onSelect(p.id)}
            aria-pressed={current === p.id}
          >
            <div className="preset-top">
              <Icon size={20} strokeWidth={1.6} />
              <strong>{p.name}</strong>
              {current === p.id && <Check size={15} />}
            </div>
            <p>{p.tagline}</p>
            <div className="tags">
              {p.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}
