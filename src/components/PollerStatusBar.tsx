'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Text } from '@primer/react';
import { SyncIcon, DatabaseIcon } from '@primer/octicons-react';
import { formatRelativeTime } from '@/lib/format';

interface PollerStatus {
  repos_cached: number;
  repos_total: number;
  issues_cached: number;
  pulls_cached: number;
  last_fetch: string | null;
}

export default function PollerStatusBar() {
  const { data } = useQuery<PollerStatus>({
    queryKey: ['poller-status'],
    queryFn: async () => {
      const r = await fetch('/api/poller-status');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 2000,
  });

  if (!data) return null;

  const pct = data.repos_total > 0 ? (data.repos_cached / data.repos_total) * 100 : 0;

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        bg: 'canvas.subtle',
        borderTop: '1px solid',
        borderColor: 'border.default',
        px: 3,
        py: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 0,
        color: 'fg.muted',
        zIndex: 50,
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <SyncIcon size={12} />
        <Text>Poller</Text>
      </Box>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <DatabaseIcon size={12} />
        <Text>
          {data.repos_cached} / {data.repos_total} repos cached
        </Text>
      </Box>
      <Box sx={{ width: 120, height: 4, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
        <Box sx={{ width: `${pct}%`, height: '100%', bg: 'success.emphasis', transition: 'width 200ms' }} />
      </Box>
      <Text>
        {data.issues_cached.toLocaleString()} issues · {data.pulls_cached.toLocaleString()} pulls
      </Text>
      <Box sx={{ ml: 'auto' }}>
        <Text>last sync {formatRelativeTime(data.last_fetch)}</Text>
      </Box>
    </Box>
  );
}
