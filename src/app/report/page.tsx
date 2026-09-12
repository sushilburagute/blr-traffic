import type { Metadata } from 'next';
import { Report } from '@/components/report/Report';
export const metadata: Metadata = {
  title: 'Your commute report',
  alternates: { canonical: '/report' },
  robots: { index: false, follow: true },
};
export default function ReportPage() {
  return <Report />;
}
