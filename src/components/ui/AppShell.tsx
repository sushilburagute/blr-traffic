'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { ArrowUpRight, Route } from 'lucide-react';
import { useScenarioStore } from '@/store/scenarioStore';
import { GITHUB_URL } from '@/lib/site';
import pkg from '../../../package.json';
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    sim = path === '/sim';
  useEffect(() => {
    void useScenarioStore.persist.rehydrate();
  }, []);
  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Route size={21} />
          </span>
          blr<span className="brand-light">/ traffic sim</span>
          <span className="beta">BETA</span>
        </Link>
        <nav aria-label="Main navigation">
          <span className="header-note">
            <i /> BENGALURU · OUTER RING ROAD
          </span>
          <Link href="/guide">
            Field guide <ArrowUpRight size={14} />
          </Link>
        </nav>
      </header>
      <main className={sim ? 'sim-main' : 'page-main'}>{children}</main>
      {!sim && (
        <footer className="site-footer">
          <span>
            Built by{' '}
            <a href="https://sush.dev" target="_blank" rel="noreferrer">
              sush.dev <ArrowUpRight size={12} />
            </a>
          </span>
          <span>
            Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>{' '}
            · Tiles <a href="https://openfreemap.org">OpenFreeMap</a>
          </span>
          <span>
            <Link href="/guide">Guide</Link>
            <a href={GITHUB_URL}>GitHub</a>
            <span className="mono">v{pkg.version}</span>
          </span>
        </footer>
      )}
    </>
  );
}
