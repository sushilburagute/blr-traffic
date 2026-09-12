import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { guideSections } from '@/content/guide';
export const metadata: Metadata = { title: 'Field guide', alternates: { canonical: '/guide' } };
export default function Guide() {
  return (
    <div className="guide-page">
      <Link className="back-link" href="/">
        <ArrowLeft size={16} /> Back to the simulator
      </Link>
      <p className="eyebrow">A LITTLE CONTEXT GOES A LONG WAY</p>
      <h1>The field guide.</h1>
      <p className="lead">
        How to read the road, run an experiment, and make sense of your commute.
      </p>
      <div className="guide-layout">
        <nav aria-label="Guide contents">
          {guideSections.map((s, i) => (
            <a key={s.id} href={`#${s.id}`}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span>
              {s.title}
            </a>
          ))}
        </nav>
        <article>
          {guideSections.map((s, i) => (
            <section id={s.id} key={s.id}>
              <p className="eyebrow">{String(i + 1).padStart(2, '0')}</p>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
            </section>
          ))}
          <section>
            <h2>Further reading</h2>
            {[
              ['IDM: car-following model', 'https://traffic-simulation.de/info/info_IDM.html'],
              ['MOBIL: lane-change model', 'https://traffic-simulation.de/info/info_MOBIL.html'],
              [
                'TomTom Bengaluru Traffic Index',
                'https://www.tomtom.com/traffic-index/city/bengaluru/',
              ],
              ['OpenStreetMap data licence', 'https://www.openstreetmap.org/copyright'],
              ['OpenFreeMap', 'https://openfreemap.org/'],
            ].map(([name, url]) => (
              <a className="source-link" key={url} href={url}>
                {name}
                <ArrowUpRight size={15} />
              </a>
            ))}
          </section>
        </article>
      </div>
    </div>
  );
}
