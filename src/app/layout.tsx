import type { Metadata, Viewport } from 'next';
import { GoogleAnalytics } from '@next/third-parties/google';
import { AppShell } from '@/components/ui/AppShell';
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/site';
import { env } from '@/lib/env';
import './globals.css';
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  keywords: ['Bengaluru', 'traffic simulator', 'Outer Ring Road', 'IDM', 'MOBIL'],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ['/opengraph-image'],
  },
  robots: { index: true, follow: true },
  authors: [{ name: 'sush.dev', url: 'https://sush.dev' }],
  creator: 'sush.dev',
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { themeColor: '#111716', width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <AppShell>{children}</AppShell>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: SITE_NAME,
              url: SITE_URL,
              description: SITE_DESCRIPTION,
              applicationCategory: 'EducationalApplication',
              operatingSystem: 'Web',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
              author: { '@type': 'Person', name: 'sush.dev', url: 'https://sush.dev' },
            }),
          }}
        />
        {env.ga && <GoogleAnalytics gaId={env.ga} />}
      </body>
    </html>
  );
}
