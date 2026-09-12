import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
const config: NextConfig = {
  async headers() {
    // Corridor data and the vehicle atlas are fetched once per session and change only on a data rebuild.
    // Their URLs are not content-hashed, so a bounded max-age with stale-while-revalidate is used instead of
    // an immutable year-long cache: a regenerated network.json reaches returning visitors within a day.
    const cached = {
      key: 'Cache-Control',
      value: 'public, max-age=86400, stale-while-revalidate=604800',
    };
    return [
      { source: '/data/corridor/:path*', headers: [cached] },
      { source: '/sprites/:path*', headers: [cached] },
    ];
  },
};
export default function nextConfig(phase: string): NextConfig {
  return {
    ...config,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next-production',
  };
}
