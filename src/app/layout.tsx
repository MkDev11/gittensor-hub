import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import './globals.css';
import StyledComponentsRegistry from '@/lib/StyledRegistry';
import Providers from '@/components/Providers';
import AppHeader from '@/components/AppHeader';
import NewIssuesWatcher from '@/components/NewIssuesWatcher';
import NewPendingUsersWatcher from '@/components/NewPendingUsersWatcher';
import PollerStatusBar from '@/components/PollerStatusBar';
import TopProgressBar from '@/components/TopProgressBar';

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
    <html lang="en" data-color-mode="dark" data-dark-theme="dark">
      <body>
        <StyledComponentsRegistry>
          <Providers>
            <Suspense fallback={null}>
              <TopProgressBar />
            </Suspense>
            <AppHeader />
            <NewIssuesWatcher />
            <NewPendingUsersWatcher />
            <main>{children}</main>
            <PollerStatusBar />
          </Providers>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
