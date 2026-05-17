import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import StyledComponentsRegistry from '@/lib/StyledRegistry';
import Providers from '@/components/Providers';
import AppShell from '@/components/AppShell';
import BackgroundWatchers from '@/components/BackgroundWatchers';
import TopProgressBar from '@/components/TopProgressBar';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Gittensor Hub',
  description: 'Real-time dashboard for Bittensor Subnet 74 miners — track issues, pull requests, and contributor activity across all SN74 whitelisted repos.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-color-mode="dark"
      data-dark-theme="dark"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* Synchronously read the layout preference from localStorage and
         * set html data attributes BEFORE React paints any chrome. This is
         * what keeps the first-paint layout (padding-left, --header-height)
         * matching the user's saved preference instead of always falling
         * back to the server-default sidebar mode. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('gittensor.settings')||'{}');if(s.layout==='top-nav'){var h=document.documentElement;h.setAttribute('data-no-sidebar','');h.setAttribute('data-top-header','');}}catch(e){}})();`,
          }}
        />
        <StyledComponentsRegistry>
          <Providers>
            <Suspense fallback={null}>
              <TopProgressBar />
            </Suspense>
            <AppShell />
            <BackgroundWatchers />
            <main>{children}</main>
          </Providers>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
