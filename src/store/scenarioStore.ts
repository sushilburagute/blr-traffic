'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { defaults, mergeConfig, scenarioConfigSchema } from '@/lib/schema';
import { presetConfig } from '@/lib/presets';
import { encode, decode } from '@/lib/share';
import type { ScenarioConfig, DeepPartial, Cohort } from '@/sim/types';
interface ScenarioState {
  config: ScenarioConfig;
  presetId: string;
  hydrated: boolean;
  savedScenarios: { name: string; code: string }[];
  setConfig: (config: ScenarioConfig, presetId?: string) => void;
  setPreset: (id: string) => void;
  patch: (patch: DeepPartial<ScenarioConfig>) => void;
  setCohort: (cohort: Cohort) => void;
  reset: () => void;
  save: (name: string) => void;
  removeSave: (name: string) => void;
}
export const useScenarioStore = create<ScenarioState>()(
  persist(
    (set, get) => ({
      config: defaults(),
      presetId: 'monday-9am',
      hydrated: false,
      savedScenarios: [],
      setConfig: (config, presetId = 'custom') =>
        set({ config: scenarioConfigSchema.parse(config), presetId }),
      setPreset: (id) =>
        set({ config: { ...presetConfig(id), userCohort: get().config.userCohort }, presetId: id }),
      patch: (patch) => set({ config: mergeConfig(get().config, patch), presetId: 'custom' }),
      setCohort: (userCohort) => set({ config: { ...get().config, userCohort } }),
      reset: () => set({ config: defaults(), presetId: 'monday-9am' }),
      save: (name) => {
        const clean = name.trim().slice(0, 60);
        if (!clean) throw new Error('Enter a name');
        set({
          savedScenarios: [
            ...get().savedScenarios.filter((s) => s.name !== clean),
            { name: clean, code: encode(get().config) },
          ].slice(-20),
        });
      },
      removeSave: (name) =>
        set({ savedScenarios: get().savedScenarios.filter((s) => s.name !== name) }),
    }),
    {
      name: 'blr-scenario-v1',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        config: state.config,
        presetId: state.presetId,
        savedScenarios: state.savedScenarios,
      }),
      merge: (saved, current) => {
        const s = saved as Partial<ScenarioState> | undefined;
        const config = scenarioConfigSchema.safeParse(s?.config);
        return {
          ...current,
          config: config.success ? config.data : defaults(),
          presetId: typeof s?.presetId === 'string' ? s.presetId : current.presetId,
          savedScenarios: Array.isArray(s?.savedScenarios)
            ? s.savedScenarios
                .filter((v) => {
                  try {
                    return typeof v.name === 'string' && Boolean(decode(v.code));
                  } catch {
                    return false;
                  }
                })
                .slice(-20)
            : [],
          hydrated: true,
        };
      },
      onRehydrateStorage: () => () => useScenarioStore.setState({ hydrated: true }),
    },
  ),
);
