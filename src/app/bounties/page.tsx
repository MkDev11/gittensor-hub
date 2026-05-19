'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Box, Heading, Label, PageLayout, Text, TextInput } from '@primer/react';
import { IssueOpenedIcon, SearchIcon } from '@primer/octicons-react';
import type { RepoEntry } from '@/lib/repos';
import { issuePool, labelSummary, pct, prPool, resolveEligibility } from '@/lib/incentives';

interface Sn74ReposResp {
  repos: RepoEntry[];
  fetched_at: string | null;
}

interface GtRepo {
  fullName: string;
  openIssuesCount?: number;
  contributorCount: number;
  prsThisWeek: number;
}

interface GtReposResp {
  repos: GtRepo[];
}

export default function BountiesPage() {
  const [query, setQuery] = useState('');

  const reposQuery = useQuery<Sn74ReposResp>({
    queryKey: ['sn74-repos'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/sn74-repos', { signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });

  const gtReposQuery = useQuery<GtReposResp>({
    queryKey: ['gt-repositories'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/gt/repositories', { signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const statsByRepo = useMemo(() => {
    const map = new Map<string, GtRepo>();
    for (const repo of gtReposQuery.data?.repos ?? []) map.set(repo.fullName.toLowerCase(), repo);
    return map;
  }, [gtReposQuery.data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (reposQuery.data?.repos ?? [])
      .filter((repo) => !repo.inactiveAt && repo.emissionShare > 0 && repo.issueDiscoveryShare > 0)
      .filter((repo) => !q || repo.fullName.toLowerCase().includes(q))
      .map((repo) => ({ repo, stats: statsByRepo.get(repo.fullName.toLowerCase()) }))
      .sort((a, b) => issuePool(b.repo) - issuePool(a.repo) || prPool(b.repo) - prPool(a.repo));
  }, [query, reposQuery.data, statsByRepo]);

  const totalIssuePool = rows.reduce((sum, row) => sum + issuePool(row.repo), 0);
  const configuredLabels = rows.filter((row) => Object.keys(row.repo.labelMultipliers).length > 0).length;

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>Bounties</Heading>
        <Text sx={{ color: 'fg.muted' }}>Issue reward pools, label lift, and repo gates for SN74 issue-discovery work.</Text>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'repeat(3, minmax(0, 1fr))'], gap: 3, mb: 4 }}>
          <Metric icon={<IssueOpenedIcon size={16} />} label="Issue Pool" value={pct(totalIssuePool)} hint="combined emission split" />
          <Metric icon={<IssueOpenedIcon size={16} />} label="Bounty Repos" value={rows.length} hint="issue split enabled" />
          <Metric icon={<IssueOpenedIcon size={16} />} label="Label Lift" value={configuredLabels} hint="repos with multipliers" />
        </Box>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 3 }}>
          <TextInput
            leadingVisual={SearchIcon}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter repositories..."
            sx={{ width: 360, maxWidth: '100%' }}
          />
          <Text sx={{ ml: 'auto', color: 'fg.muted', fontSize: 1 }}>{rows.length} repos</Text>
        </Box>

        <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', overflowX: 'auto' }}>
          <Box as="table" sx={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 1 }}>
            <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default', color: 'fg.muted' }}>
              <Box as="tr">
                <HeadCell>Repository</HeadCell>
                <HeadCell align="right">Issue Pool</HeadCell>
                <HeadCell align="right">PR Pool</HeadCell>
                <HeadCell>Best Label</HeadCell>
                <HeadCell>Issue Gates</HeadCell>
                <HeadCell>Open Limit</HeadCell>
                <HeadCell align="right">PRs 7d</HeadCell>
                <HeadCell align="right">Competition</HeadCell>
              </Box>
            </Box>
            <Box as="tbody">
              {rows.map(({ repo, stats }) => {
                const gates = resolveEligibility(repo.eligibility);
                return (
                  <Box as="tr" key={repo.fullName} sx={{ borderBottom: '1px solid', borderColor: 'border.muted' }}>
                    <BodyCell>
                      <Link href={'/repos/' + repo.owner + '/' + repo.name} prefetch={false} style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 600 }}>
                        {repo.fullName}
                      </Link>
                    </BodyCell>
                    <BodyCell align="right">{pct(issuePool(repo))}</BodyCell>
                    <BodyCell align="right">{pct(prPool(repo))}</BodyCell>
                    <BodyCell>{labelSummary(repo)}</BodyCell>
                    <BodyCell>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Label>Solved {gates.minValidSolvedIssues}</Label>
                        <Label>Cred {(gates.minIssueCredibility * 100).toFixed(0)}%</Label>
                      </Box>
                    </BodyCell>
                    <BodyCell>
                      <Label>{gates.openIssueSpamBaseThreshold}</Label>
                    </BodyCell>
                    <BodyCell align="right">{stats?.prsThisWeek ?? 0}</BodyCell>
                    <BodyCell align="right">{stats?.contributorCount ?? 0}</BodyCell>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint: string }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', mb: 2 }}>
        {icon}
        <Text sx={{ fontSize: 0, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0 }}>{label}</Text>
      </Box>
      <Text sx={{ display: 'block', fontSize: 4, fontWeight: 700, fontFamily: 'mono' }}>{value}</Text>
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{hint}</Text>
    </Box>
  );
}

function HeadCell({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <Box as="th" sx={{ px: 3, py: 2, textAlign: align, fontSize: 0, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</Box>;
}

function BodyCell({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <Box as="td" sx={{ px: 3, py: 2, textAlign: align, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{children}</Box>;
}
