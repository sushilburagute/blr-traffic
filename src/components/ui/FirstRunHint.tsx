'use client';
import { useEffect, useState } from 'react';
import { firstRunHints } from '@/content/guide';

export function FirstRunHint({ step, minimum = 0 }: { step: number; minimum?: number }) {
  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    const sync = () => {
      const saved = localStorage.getItem('blr-hints-step');
      setCurrent(localStorage.getItem('blr-hints') ? 3 : Math.max(minimum, Number(saved ?? 0)));
    };
    sync();
    window.addEventListener('blr-hints-change', sync);
    return () => window.removeEventListener('blr-hints-change', sync);
  }, [minimum]);
  function advance(next: number) {
    localStorage.setItem('blr-hints-step', String(next));
    if (next >= firstRunHints.length) localStorage.setItem('blr-hints', '1');
    window.dispatchEvent(new Event('blr-hints-change'));
  }
  if (current !== step) return null;
  return (
    <div className="hint" role="note" aria-label={`Getting started ${step + 1} of 3`}>
      <span>{firstRunHints[step]}</span>
      <button onClick={() => advance(step + 1)}>{step === 2 ? 'Got it' : 'Next tip'}</button>
      <button onClick={() => advance(3)}>Don’t show again</button>
    </div>
  );
}
