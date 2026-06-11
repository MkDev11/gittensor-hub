'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { PageLayout, Heading, Text, Box } from '@primer/react';
import PullsTable from '@/components/PullsTable';

const PULLS_CONTENT_MAX_WIDTH = 1480;

export default function PullsPage() {
  return (
    <Suspense fallback={null}>
      <AllPullsPage />
    </Suspense>
  );
}

function AllPullsPage() {
  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Box sx={{ width: '100%', maxWidth: PULLS_CONTENT_MAX_WIDTH, mx: 'auto' }}>
          <Heading sx={{ fontSize: 4, mb: 1 }}>Pull Requests</Heading>
          <Text sx={{ color: 'fg.muted' }}>
            Live aggregated view across current Gittensor-listed repositories. Star a repo to highlight its PRs; toggle{' '}
            <strong>Tracked only</strong> to filter to your watchlist.
          </Text>
        </Box>
      </PageLayout.Header>
      <PageLayout.Content>
        <PullsTable />
      </PageLayout.Content>
    </PageLayout>
  );
}
