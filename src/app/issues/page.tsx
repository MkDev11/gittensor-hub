'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { PageLayout, Heading, Text } from '@primer/react';
import IssuesTable from '@/components/IssuesTable';

export default function IssuesPage() {
  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>Issues</Heading>
        <Text sx={{ color: 'fg.muted' }}>
          Live aggregated view across all cached repositories. Star a repo to highlight its issues; toggle{' '}
          <strong>Tracked only</strong> to filter to your watchlist.
        </Text>
      </PageLayout.Header>
      <PageLayout.Content>
        <IssuesTable />
      </PageLayout.Content>
    </PageLayout>
  );
}
