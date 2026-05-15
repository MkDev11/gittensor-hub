'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Label, Text, TextInput, Link as PrimerLink } from '@primer/react';
import Spinner from '@/components/Spinner';
import Dropdown from '@/components/Dropdown';
import { SearchIcon, ClockIcon, PersonIcon } from '@primer/octicons-react';
import type { PullDto, PullsResponse } from '@/lib/api-types';
import { pullStatus } from '@/lib/api-types';
import { PullStatusBadge } from '@/components/StatusBadge';
import { formatRelativeTime } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';

type StateFilter = 'all' | 'open' | 'draft' | 'merged' | 'closed' | 'mine';

const FILTER_OPTS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All states' },
  { id: 'open', label: 'Open' },
  { id: 'draft', label: 'Draft' },
  { id: 'merged', label: 'Merged' },
  { id: 'closed', label: 'Closed (unmerged)' },
];

export default function RepoPullsPanel({ owner, name }: { owner: string; name: string }) {
  const [filter, setFilter] = useState<StateFilter>('all');
  const [query, setQuery] = useState('');
  const me = useMinerLogin();

  const { data, isLoading, isError } = useQuery<PullsResponse>({
    queryKey: ['pulls', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/repos/${owner}/${name}/pulls`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
  });

  const filtered = useMemo(() => {
    if (!data?.pulls) return [];
    const q = query.trim().toLowerCase();
    return data.pulls.filter((p) => {
      if (q && !`${p.title} #${p.number} ${p.author_login ?? ''}`.toLowerCase().includes(q)) return false;
      if (filter === 'all') return true;
      if (filter === 'mine') return p.author_login?.toLowerCase() === me.toLowerCase();
      const s = pullStatus(p);
      return s === filter;
    });
  }, [data, query, filter, me]);

  const myCount = data?.pulls.filter((p) => p.author_login?.toLowerCase() === me.toLowerCase()).length ?? 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextInput
          leadingVisual={SearchIcon}
          placeholder="Filter PRs by title, #, author…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 360, maxWidth: '100%' }}
        />
        <Dropdown
          value={filter}
          onChange={(v) => setFilter(v)}
          options={FILTER_OPTS.map((o) => ({
            value: o.id,
            label: o.id === 'mine' && myCount > 0 ? `${o.label} (${myCount})` : o.label,
          }))}
          width={200}
          ariaLabel="Filter by PR state"
        />
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', fontSize: 0 }}>
          {isLoading && <Spinner size="sm" tone="muted" />}
          {data && (
            <Text>
              {filtered.length} of {data.count} · synced {formatRelativeTime(data.last_fetch)}
            </Text>
          )}
        </Box>
      </Box>

      {isError && (
        <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', borderRadius: 2, bg: 'danger.subtle', mb: 2 }}>
          <Text sx={{ color: 'danger.fg' }}>Failed to load pull requests.</Text>
        </Box>
      )}

      <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', overflow: 'hidden' }}>
        {filtered.length === 0 && !isLoading && (
          <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>No pull requests match these filters.</Box>
        )}
        {filtered.map((pr, idx) => (
          <PullRow key={pr.id} pr={pr} isLast={idx === filtered.length - 1} mine={pr.author_login?.toLowerCase() === me.toLowerCase()} />
        ))}
      </Box>
    </Box>
  );
}

function PullRow({ pr, isLast, mine }: { pr: PullDto; isLast: boolean; mine: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 3,
        p: 3,
        borderBottom: isLast ? 'none' : '1px solid',
        borderColor: 'border.muted',
        bg: mine ? 'attention.subtle' : 'canvas.default',
        borderLeft: mine ? '3px solid' : '3px solid transparent',
        borderLeftColor: mine ? 'attention.emphasis' : 'transparent',
        '&:hover': { bg: mine ? 'attention.muted' : 'canvas.subtle' },
      }}
    >
      <Box sx={{ pt: '2px' }}>
        <PullStatusBadge pr={pr} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
          <PrimerLink
            href={pr.html_url ?? '#'}
            target="_blank"
            rel="noreferrer"
            sx={{ fontWeight: 600, color: 'fg.default', '&:hover': { color: 'accent.fg' } }}
          >
            {pr.title}
          </PrimerLink>
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>#{pr.number}</Text>
          {mine && (
            <Box
              sx={{
                px: 2,
                py: '1px',
                bg: 'attention.emphasis',
                color: 'fg.onEmphasis',
                fontSize: 0,
                fontWeight: 600,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <PersonIcon size={10} />
              You
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', fontSize: 0, mt: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <ClockIcon size={12} />
            opened {formatRelativeTime(pr.created_at)} by{' '}
            <Text sx={{ color: mine ? 'attention.fg' : 'fg.default', fontWeight: 500 }}>{pr.author_login ?? 'unknown'}</Text>
            {pr.author_association && pr.author_association !== 'NONE' && (
              <Label variant="secondary" sx={{ ml: 1, fontSize: '10px' }}>
                {pr.author_association.toLowerCase()}
              </Label>
            )}
          </Box>
          {pr.merged_at && <Text>· merged {formatRelativeTime(pr.merged_at)}</Text>}
          {!pr.merged_at && pr.closed_at && <Text>· closed {formatRelativeTime(pr.closed_at)}</Text>}
          {!pr.merged_at && !pr.closed_at && <Text>· updated {formatRelativeTime(pr.updated_at)}</Text>}
        </Box>
      </Box>
    </Box>
  );
}
