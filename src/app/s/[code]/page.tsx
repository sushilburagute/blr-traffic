import type { Metadata } from 'next';
import { SharedScenario } from '@/components/panels/SharedScenario';
import { decode, encode } from '@/lib/share';
import { presets, presetConfig } from '@/lib/presets';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  try {
    const c = decode(code),
      p = presets.find(
        (p) => encode({ ...presetConfig(p.id), userCohort: c.userCohort }) === encode(c),
      );
    return {
      title: `${p?.name ?? 'Custom scenario'} · Shared commute`,
      alternates: { canonical: `/s/${code}` },
      robots: { index: false, follow: true },
    };
  } catch {
    return { title: 'Invalid scenario', robots: { index: false, follow: false } };
  }
}
export default async function SharedPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <SharedScenario code={code} />;
}
