import { describe, it, expect } from 'vitest';
import { defaults, mergeConfig, scenarioConfigSchema } from '@/lib/schema';
import { presets, presetConfig } from '@/lib/presets';
import LZString from 'lz-string';
import { encode, decode } from '@/lib/share';
describe('config and shares', () => {
  it('uses only route-safe characters even when compression produces plus signs', () => {
    const config = { ...presetConfig('sunday-morning'), durationMin: 5 };
    const code = encode(config);
    expect(code).not.toContain('+');
    expect(decode(code)).toEqual(config);
  });
  it('defaults produce a complete valid scenario', () =>
    expect(scenarioConfigSchema.parse(defaults())).toEqual(defaults()));
  for (const preset of presets)
    it(`round trips ${preset.name}`, () => {
      const c = presetConfig(preset.id),
        code = encode(c);
      expect(code.length).toBeLessThan(600);
      expect(decode(code)).toEqual(c);
    });
  it('rejects invalid weights, versions, signal timing and malformed links', () => {
    expect(() => mergeConfig(defaults(), { version: 3 as 2 })).toThrow();
    expect(() => mergeConfig(defaults(), { demand: { vehPerHour: -1 } })).toThrow();
    expect(() =>
      mergeConfig(defaults(), { infra: { signals: { iblur: { cycleS: 100 } } } }),
    ).toThrow();
    expect(() => decode('!')).toThrow();
    expect(() => decode('a'.repeat(2000))).toThrow();
  });
  it('reads unversioned (v1) share links against the v1 defaults', () => {
    const v1 = (patch: object) => LZString.compressToEncodedURIComponent(JSON.stringify(patch));
    const plain = decode(v1({}));
    expect(plain.version).toBe(2);
    expect(plain.demand.vehPerHour).toBe(12000);
    expect(plain.infra.speedLimitKmh).toBe(60);
    expect(decode(v1({ demand: { vehPerHour: 9000 } })).demand.vehPerHour).toBe(9000);
    expect(decode(v1({ version: 1 })).infra.speedLimitKmh).toBe(60);
    expect(decode(encode(defaults()))).toEqual(defaults());
  });
  it('preserves nested siblings when patching', () => {
    const c = mergeConfig(defaults(), { environment: { rain: true } });
    expect(c.environment.potholes).toBe(6);
  });
});
