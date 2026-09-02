import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { themeInitScript } from '@toolgraph/ui';

import { PostHogProvider } from '@/components/PostHogProvider';

import './globals.css';

/**
 * One clean sans-serif, self-hosted by next/font so there is no request to a
 * third-party font CDN — which also keeps the CSP's font-src at 'self'.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Toolgraph',
    template: '%s · Toolgraph',
  },
  description:
    'Wire MCP tools together on a canvas, type-checked against their real JSON Schemas, then export the result as code you own.',
  applicationName: 'Toolgraph',
  icons: { icon: '/toolgraph.png', apple: '/toolgraph.png' },
  openGraph: {
    title: 'Toolgraph',
    description:
      'Wire MCP tools together on a canvas, type-checked against their real JSON Schemas.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Both themes are declared so the browser paints its own chrome from the
  // right end of the ramp before the page renders.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The nonce the middleware minted for this request. The theme script must
  // carry it or the CSP will refuse to run it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme before first paint. Without it, a user who
          chose dark gets a white flash on every navigation. It is synchronous
          and tiny for exactly that reason.
        */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        {/* PostHogProvider reads useSearchParams, which opts the tree into
            client-side rendering unless it sits behind a Suspense boundary. */}
        <Suspense fallback={null}>
          <PostHogProvider>{children}</PostHogProvider>
        </Suspense>
      </body>
    </html>
  );
}
