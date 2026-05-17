import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import StyledComponentsRegistry from '@/lib/StyledRegistry';
import Providers from '@/components/Providers';
import AppHeader from '@/components/AppHeader';
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
        <StyledComponentsRegistry>
          <Providers>
            <Suspense fallback={null}>
              <TopProgressBar />
            </Suspense>
            <AppHeader />
            <BackgroundWatchers />
            <main>{children}</main>
          </Providers>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
