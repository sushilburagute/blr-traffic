import LZString from 'lz-string';
import { defaults, mergeConfig } from './schema';
import type { DeepPartial, ScenarioConfig } from '@/sim/types';
function diff(value: unknown, base: unknown): unknown {
  if (JSON.stringify(value) === JSON.stringify(base)) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const d = diff(v, (base as Record<string, unknown> | undefined)?.[key]);
      if (d !== undefined) out[key] = d;
    }
    return out;
  }
  return value;
}
export function encode(config: ScenarioConfig) {
  const code = LZString.compressToEncodedURIComponent(
    JSON.stringify(diff(config, defaults()) ?? {}),
  ).replace(/\+/g, '_');
  if (code.length >= 2000)
    throw new Error('This scenario is too large for a share link. Download its JSON instead.');
  return code;
}
export function decode(code: string): ScenarioConfig {
  if (!code || code.length >= 2000 || !/^[A-Za-z0-9_+\-$]+$/.test(code))
    throw new Error('Invalid share link');
  const raw = LZString.decompressFromEncodedURIComponent(code.replace(/_/g, '+'));
  if (!raw || raw.length > 150000) throw new Error('Invalid or oversized scenario');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('This share link is corrupted');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid scenario');
  return mergeConfig(defaults(), value as DeepPartial<ScenarioConfig>);
}
