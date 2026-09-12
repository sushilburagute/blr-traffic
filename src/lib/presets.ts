import { defaults, mergeConfig } from './schema';
import type { DeepPartial, ScenarioConfig } from '@/sim/types';
export interface Preset {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  tags: string[];
  config: DeepPartial<ScenarioConfig>;
}
export const presets: Preset[] = [
  {
    id: 'monday-9am',
    name: 'Monday 9 AM',
    tagline: 'The ORR, in its natural habitat.',
    icon: 'Sun',
    tags: ['Rush hour', '12,000 veh/h'],
    config: {},
  },
  {
    id: 'friday-rain',
    name: 'Friday evening rain',
    tagline: 'One downpour. A thousand brake lights.',
    icon: 'CloudRain',
    tags: ['Heavy rain', 'Waterlogging'],
    config: {
      startClock: '18:00',
      demand: { profile: 'evening' },
      environment: { rain: true, rainIntensity: 2 },
      disruptions: [
        {
          id: 'rain-iblur',
          type: 'waterlogging',
          junctionId: 'iblur',
          startMin: 0,
          durationMin: 60,
          sOffset: 0,
          params: { lengthM: 150 },
        },
        {
          id: 'rain-bellandur',
          type: 'waterlogging',
          junctionId: 'bellandur',
          startMin: 0,
          durationMin: 60,
          sOffset: 0,
          params: { lengthM: 150 },
        },
      ],
    },
  },
  {
    id: 'silk-board-pileup',
    name: 'Silk Board pile-up',
    tagline: 'Two lanes disappear. The queue does not.',
    icon: 'TriangleAlert',
    tags: ['Accident', '2 lanes blocked'],
    config: {
      disruptions: [
        {
          id: 'pileup',
          type: 'accident',
          junctionId: 'silkBoard',
          startMin: 10,
          durationMin: 25,
          sOffset: 0,
          params: { lanesBlocked: 2 },
        },
      ],
    },
  },
  {
    id: 'metro-construction',
    name: 'Metro construction',
    tagline: 'A better tomorrow. A narrower today.',
    icon: 'Construction',
    tags: ['Construction', 'Lane closures'],
    config: {
      disruptions: ['toMarathahalli-agara-iblur', 'toMarathahalli-bellandur-kadubeesanahalli'].map(
        (segmentId, i) => ({
          id: `metro-${i}`,
          type: 'construction' as const,
          segmentId,
          startMin: 0,
          durationMin: 60,
          sOffset: 350,
          params: { lanesBlocked: 1, lengthM: 400 },
        }),
      ),
    },
  },
  {
    id: 'signal-down',
    name: 'Signal down at Marathahalli',
    tagline: 'Everyone has the right of way. Apparently.',
    icon: 'TrafficCone',
    tags: ['Broken signal'],
    config: {
      disruptions: [
        {
          id: 'signal',
          type: 'brokenSignal',
          junctionId: 'marathahalli',
          startMin: 5,
          durationMin: 55,
          sOffset: 0,
          params: {},
        },
      ],
    },
  },
  {
    id: 'office-exit',
    name: 'Office exit pulse',
    tagline: 'The entire tech park has logged off.',
    icon: 'Building2',
    tags: ['Demand surge'],
    config: {
      startClock: '18:00',
      demand: {
        profile: 'flat',
        pulses: ['bellandur', 'kadubeesanahalli'].map((id) => ({
          sourceId: `source-toMarathahalli-${id}`,
          startMin: 0,
          durationMin: 30,
          vehPerHour: 1600,
        })),
      },
    },
  },
  {
    id: 'sunday-morning',
    name: 'Sunday morning',
    tagline: 'This is what the road could feel like.',
    icon: 'Coffee',
    tags: ['Light traffic', '2,000 veh/h'],
    config: {
      startClock: '07:00',
      demand: { vehPerHour: 2000, profile: 'flat' },
      environment: { potholes: 0, speedBreakers: 0 },
      disruptions: [],
    },
  },
  {
    id: 'utopia',
    name: 'Utopia',
    tagline: 'Same demand. Everyone follows their lane.',
    icon: 'Sparkles',
    tags: ['Disciplined', 'Bus lane'],
    config: {
      demand: { behaviourMix: { disciplined: 100, opportunist: 0, aggressive: 0 } },
      squeeze: { enabled: false },
      environment: { potholes: 0, speedBreakers: 0 },
      infra: { busLane: true },
    },
  },
  {
    id: 'free-for-all',
    name: 'Free-for-all',
    tagline: 'Every gap is an invitation.',
    icon: 'Zap',
    tags: ['Aggressive', 'Squeeze'],
    config: {
      demand: { behaviourMix: { disciplined: 0, opportunist: 0, aggressive: 100 } },
      environment: { potholes: 12 },
    },
  },
];
export function presetConfig(id: string) {
  const p = presets.find((p) => p.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return mergeConfig(defaults(), p.config);
}
