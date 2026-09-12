import type { Metadata } from 'next';
import { Simulator } from '@/components/panels/Simulator';
export const metadata: Metadata = {
  title: 'Explore the corridor',
  alternates: { canonical: '/sim' },
};
export default function SimPage() {
  return <Simulator />;
}
