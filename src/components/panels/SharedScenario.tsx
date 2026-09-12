'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { decode, encode } from '@/lib/share';
import { presets, presetConfig } from '@/lib/presets';
import { useScenarioStore } from '@/store/scenarioStore';
export function SharedScenario({ code }: { code: string }) {
  const router = useRouter(),
    hydrated = useScenarioStore((s) => s.hydrated);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!hydrated) return;
    try {
      const config = decode(code);
      const preset = presets.find(
        (p) => encode({ ...presetConfig(p.id), userCohort: config.userCohort }) === encode(config),
      );
      useScenarioStore.getState().setConfig(config, preset?.id ?? 'custom');
      if (new URLSearchParams(location.search).get('result') === '1') {
        sessionStorage.setItem('blr-shared-result', '1');
        const until = new URLSearchParams(location.search).get('until');
        if (
          until !== null &&
          Number.isFinite(Number(until)) &&
          Number(until) >= 0 &&
          Number(until) <= config.durationMin * 60
        )
          sessionStorage.setItem('blr-shared-until', until);
        else sessionStorage.removeItem('blr-shared-until');
      }
      router.replace('/sim');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, hydrated, router]);
  return (
    <div className="empty-state">
      <h1>{error ? 'This link could not be opened' : 'Loading shared scenario…'}</h1>
      {error && (
        <>
          <p role="alert">{error}</p>
          <Link className="btn" href="/">
            Create a new scenario
          </Link>
        </>
      )}
    </div>
  );
}
