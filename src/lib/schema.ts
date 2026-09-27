import { z } from 'zod';
import {
  JUNCTION_IDS,
  PROFILES,
  VEHICLE_TYPES,
  type ScenarioConfig,
  type DeepPartial,
  type JunctionId,
  type SignalPlan,
} from '@/sim/types';
/** Four-phase plan: ORR through movement, each cross-road approach, then a 3 s all-red clearance. */
export function signalPlan(cycleS: number, orrGreenS: number, offsetS = 0): SignalPlan {
  const cross = cycleS - orrGreenS - 3 * 4;
  return {
    cycleS,
    offsetS,
    phases: [
      { approaches: [0, 1], greenS: orrGreenS, amberS: 3 },
      { approaches: [2], greenS: Math.ceil(cross / 2), amberS: 3 },
      { approaches: [3], greenS: Math.floor(cross / 2), amberS: 3 },
      { approaches: [], greenS: 3, amberS: 0 },
    ],
  };
}
/** 120 s cycle, 45 % green to the ORR — the plan for the mid-corridor junctions. */
export const defaultSignal: SignalPlan = signalPlan(120, 54);
/**
 * Silk Board (Hosur Road) and Marathahalli (Old Airport Road) are the corridor's big cross-junctions:
 * long cycles and a small ORR share, so the terminal approaches back up the way they do in real life.
 */
export const defaultSignals: Record<JunctionId, SignalPlan> = {
  silkBoard: signalPlan(180, 45),
  agara: defaultSignal,
  iblur: defaultSignal,
  bellandur: defaultSignal,
  kadubeesanahalli: defaultSignal,
  marathahalli: signalPlan(150, 45),
};
/**
 * Scenario format version. Version 2 (2026-09) recalibrated the Monday 9 AM defaults (demand 13,000 veh/h,
 * speed limit 50 km/h; see plan/implementation-notes.md, Calibration). Share links store only differences
 * from the defaults, so an unversioned (v1) link is read against the v1 defaults to keep its meaning.
 */
export const CONFIG_VERSION = 2;
const V1_DEFAULTS = {
  demand: { vehPerHour: 12000 },
  infra: { speedLimitKmh: 60 },
} satisfies DeepPartial<ScenarioConfig>;
const nonnegative = z.number().finite().min(0);
const junctionRecord = <T extends z.ZodTypeAny>(schema: T) =>
  z.object(
    Object.fromEntries(JUNCTION_IDS.map((id) => [id, schema])) as {
      [K in (typeof JUNCTION_IDS)[number]]: T;
    },
  );
const signal = z
  .object({
    cycleS: z.number().min(20).max(600),
    offsetS: nonnegative.max(600),
    phases: z
      .array(
        z.object({
          approaches: z.array(z.number().int().min(0).max(3)).max(4),
          greenS: nonnegative.max(600),
          amberS: nonnegative.max(20),
        }),
      )
      .min(1)
      .max(8),
  })
  .refine(
    (p) => Math.abs(p.phases.reduce((sum, p) => sum + p.greenS + p.amberS, 0) - p.cycleS) < 0.01,
    'Phase durations must sum to cycle length',
  );
export const disruptionSchema = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum([
      'accident',
      'breakdown',
      'construction',
      'waterlogging',
      'illegalParking',
      'brokenSignal',
      'event',
      'closure',
    ]),
    startMin: nonnegative.max(120),
    durationMin: z.number().positive().max(120),
    junctionId: z.enum(JUNCTION_IDS).optional(),
    segmentId: z.string().max(80).optional(),
    sOffset: nonnegative.max(20000).default(0),
    params: z
      .object({
        lanesBlocked: z.number().int().min(1).max(6).optional(),
        lengthM: z.number().positive().max(20000).optional(),
        vehPerHour: nonnegative.max(20000).optional(),
        sourceId: z.string().max(80).optional(),
      })
      .default({}),
  })
  .refine((d) => Boolean(d.junctionId || d.segmentId), 'Choose a junction or segment');
const obstacle = z.object({
  id: z.string().max(80),
  segmentId: z.string().max(80),
  lanes: z.array(z.number().int().min(0).max(5)).min(1),
  s: nonnegative.max(20000),
  type: z.enum(['pothole', 'speedBreaker']),
  speedCapKmh: z.number().min(1).max(60),
});
const pulse = z.object({
  sourceId: z.string().max(80),
  startMin: nonnegative.max(120),
  durationMin: z.number().positive().max(120),
  vehPerHour: nonnegative.max(20000),
});
const behaviour = z.object({
  politeness: nonnegative.max(1).optional(),
  bSafe: z.number().min(0.5).max(6).optional(),
  aThr: nonnegative.max(2).optional(),
  lcCooldown: z.number().min(0.5).max(30).optional(),
  gapFactor: z.number().min(0.3).max(2).optional(),
  filterProb: nonnegative.max(1).optional(),
  amberRunProb: nonnegative.max(1).optional(),
  redRunProb: nonnegative.max(1).optional(),
  reactionTime: z.number().min(0.1).max(1).optional(),
  routeChangeProb: nonnegative.max(1).optional(),
  busLaneViolationProb: nonnegative.max(1).optional(),
});
const mix = z
  .object({
    twoWheeler: nonnegative.max(100).default(40),
    auto: nonnegative.max(100).default(10),
    car: nonnegative.max(100).default(25),
    cab: nonnegative.max(100).default(12),
    bus: nonnegative.max(100).default(8),
    truck: nonnegative.max(100).default(5),
  })
  .refine((v) => Object.values(v).reduce((a, b) => a + b, 0) > 0, 'Mix cannot be empty');
export const scenarioConfigSchema = z
  .object({
    // Version 1 configs (older defaults) are still accepted; see `defaultsFor`.
    version: z
      .union([z.literal(1), z.literal(CONFIG_VERSION)])
      .default(CONFIG_VERSION)
      .transform((): typeof CONFIG_VERSION => CONFIG_VERSION),
    seed: z.number().int().min(0).max(4294967295).default(42),
    durationMin: z.number().min(1).max(60).default(45),
    startClock: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('08:30'),
    demand: z
      .object({
        vehPerHour: nonnegative.max(20000).default(13000),
        profile: z.enum(['morning', 'evening', 'flat', 'custom']).default('morning'),
        customCurve: z.array(nonnegative.max(5)).length(60).optional(),
        mix: mix.default({}),
        behaviourMix: z
          .object({
            disciplined: nonnegative.max(100).default(25),
            opportunist: nonnegative.max(100).default(50),
            aggressive: nonnegative.max(100).default(25),
          })
          .refine((v) => Object.values(v).reduce((a, b) => a + b, 0) > 0)
          .default({}),
        throughShare: nonnegative.max(1).default(0.65),
        od: z
          .array(z.array(nonnegative.max(100)).min(1).max(20))
          .min(1)
          .max(20)
          .optional(),
        pulses: z.array(pulse).max(30).default([]),
      })
      .default({}),
    infra: z
      .object({
        lanesOverride: z.record(z.number().int().min(1).max(5)).optional(),
        speedLimitKmh: z.number().min(10).max(100).default(50),
        busLane: z.boolean().default(false),
        flyovers: junctionRecord(z.boolean().default(false)).default({
          agara: true,
          bellandur: true,
          iblur: true,
          kadubeesanahalli: true,
          marathahalli: true,
          silkBoard: true,
        }),
        uTurns: junctionRecord(z.boolean().default(false)).default({}),
        encroachment: z
          .array(
            z.object({
              segmentId: z.string(),
              s: nonnegative,
              lengthM: z.number().positive(),
              widthReductionM: nonnegative.max(10),
            }),
          )
          .max(30)
          .default([]),
        busStops: z
          .array(z.object({ segmentId: z.string(), s: nonnegative, dwellS: nonnegative.max(120) }))
          .max(30)
          .default([]),
        signals: z
          .object(
            Object.fromEntries(
              JUNCTION_IDS.map((id) => [id, signal.default(defaultSignals[id])]),
            ) as { [K in JunctionId]: z.ZodDefault<typeof signal> },
          )
          .default({}),
      })
      .default({}),
    disruptions: z.array(disruptionSchema).max(30).default([]),
    liveEvents: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({
            tick: z.number().int().min(0).max(36000),
            kind: z.literal('rain'),
            on: z.boolean(),
            intensity: z.union([z.literal(0), z.literal(1), z.literal(2)]),
          }),
          z.object({
            tick: z.number().int().min(0).max(36000),
            kind: z.literal('disruption'),
            disruption: disruptionSchema,
          }),
        ]),
      )
      .max(60)
      .optional(),
    environment: z
      .object({
        rain: z.boolean().default(false),
        rainIntensity: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
        potholes: z.number().int().min(0).max(60).default(6),
        speedBreakers: z.number().int().min(0).max(30).default(3),
        pinnedObstacles: z.array(obstacle).max(60).optional(),
      })
      .default({}),
    behaviour: z
      .object({
        disciplined: behaviour.default({}),
        opportunist: behaviour.default({}),
        aggressive: behaviour.default({}),
      })
      .default({}),
    squeeze: z
      .object({
        enabled: z.boolean().default(true),
        densityThreshold: z.number().min(10).max(1000).default(90),
        virtualLaneSpeedCapKmh: z.number().min(5).max(40).default(25),
      })
      .default({}),
    userCohort: z
      .custom<ScenarioConfig['userCohort']>(
        (v) =>
          typeof v === 'string' &&
          VEHICLE_TYPES.some((t) => PROFILES.some((p) => v === `${t}:${p}`)),
      )
      .default('twoWheeler:opportunist'),
  })
  .superRefine((v, ctx) => {
    if (v.demand.profile === 'custom' && !v.demand.customCurve)
      ctx.addIssue({
        code: 'custom',
        path: ['demand', 'customCurve'],
        message: 'A custom profile needs 60 minute weights',
      });
    if (v.demand.od && v.demand.od.some((r) => r.length !== v.demand.od!.length))
      ctx.addIssue({ code: 'custom', path: ['demand', 'od'], message: 'OD matrix must be square' });
  });
export const defaults = (): ScenarioConfig => scenarioConfigSchema.parse({});
function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (patch === null || Array.isArray(patch) || typeof patch !== 'object') return patch;
  const result: Record<string, unknown> = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new Error('Invalid configuration key');
    result[key] = merge(result[key], value);
  }
  return result;
}
export function mergeConfig(
  base: ScenarioConfig,
  patch: DeepPartial<ScenarioConfig>,
): ScenarioConfig {
  return scenarioConfigSchema.parse(merge(base, patch));
}
/** Defaults as they were in a given scenario version (the current defaults for the current version). */
export function defaultsFor(version: unknown): ScenarioConfig {
  return version === undefined || version === 1 ? mergeConfig(defaults(), V1_DEFAULTS) : defaults();
}
export function migrate(value: unknown): ScenarioConfig {
  return scenarioConfigSchema.parse(value);
}
