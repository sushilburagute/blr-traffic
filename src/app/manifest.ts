import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BLR Traffic Sim',
    short_name: 'BLR Traffic',
    description: 'Explore your Outer Ring Road commute',
    start_url: '/',
    display: 'standalone',
    background_color: '#111716',
    theme_color: '#111716',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
