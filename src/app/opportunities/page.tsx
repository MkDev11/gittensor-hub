'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Box, Heading, Label, PageLayout, Text, TextInput } from '@primer/react';
import { SearchIcon, TriangleDownIcon, TriangleUpIcon } from '@primer/octicons-react';
import type { RepoEntry } from '@/lib/repos';
import { branchSummary, issuePool, labelSummary, opportunityScore, pct, prPool, resolveEligibility } from '@/lib/incentives';

interface Sn74ReposResp {
  repos: RepoEntry[];
  source: 'live' | 'empty';
  fetched_at: string | null;
  count: number;
}

interface GtRepo {
  fullName: string;
  totalScore: number;
  mergedPrCount: number;
  contributorCount: number;
  prsThisWeek: number;
  lastPrAt: string | null;
}

interface GtReposResp {
  repos: GtRepo[];
}

type SortKey = 'opportunity' | 'emission' | 'issuePool' | 'prPool' | 'competition' | 'activity' | 'repo';

type Row = {
  repo: RepoEntry;
  stats?: GtRepo;
  score: number;
};

function cmpText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

export default function OpportunitiesPage() {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('opportunity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [issueOnly, setIssueOnly] = useState(false);

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

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const list = (reposQuery.data?.repos ?? [])
      .filter((repo) => !repo.inactiveAt && repo.emissionShare > 0)
      .filter((repo) => !q || repo.fullName.toLowerCase().includes(q))
      .filter((repo) => !issueOnly || repo.issueDiscoveryShare > 0)
      .map((repo) => {
        const stats = statsByRepo.get(repo.fullName.toLowerCase());
        return { repo, stats, score: opportunityScore(repo, stats) };
      });

    return list.sort((a, b) => {
      let v = 0;
      if (sortKey === 'opportunity') v = a.score - b.score;
      else if (sortKey === 'emission') v = a.repo.emissionShare - b.repo.emissionShare;
      else if (sortKey === 'issuePool') v = issuePool(a.repo) - issuePool(b.repo);
      else if (sortKey === 'prPool') v = prPool(a.repo) - prPool(b.repo);
      else if (sortKey === 'competition') v = (a.stats?.contributorCount ?? 0) - (b.stats?.contributorCount ?? 0);
      else if (sortKey === 'activity') v = (a.stats?.prsThisWeek ?? 0) - (b.stats?.prsThisWeek ?? 0);
      else v = cmpText(a.repo.fullName, b.repo.fullName);
      if (v === 0) v = a.repo.fullName.localeCompare(b.repo.fullName);
      return sortDir === 'desc' ? -v : v;
    });
  }, [reposQuery.data, query, issueOnly, sortKey, sortDir, statsByRepo]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'repo' || key === 'competition' ? 'asc' : 'desc');
    }
  };

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>Opportunities</Heading>
        <Text sx={{ color: 'fg.muted' }}>Ranked by emission share, label lift, issue split, activity, and competition.</Text>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 3 }}>
          <TextInput
            leadingVisual={SearchIcon}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter repositories..."
            sx={{ width: 360, maxWidth: '100%' }}
          />
          <Box
            as="button"
            onClick={() => setIssueOnly((v) => !v)}
            sx={{
              height: 32,
              px: 3,
              border: '1px solid',
              borderColor: issueOnly ? 'accent.emphasis' : 'border.default',
              borderRadius: 2,
              bg: issueOnly ? 'accent.subtle' : 'canvas.default',
              color: issueOnly ? 'accent.fg' : 'fg.default',
              font: 'inherit',
              fontSize: 1,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Issue pools
          </Box>
          <Text sx={{ ml: 'auto', color: 'fg.muted', fontSize: 1 }}>{rows.length} repos</Text>
        </Box>

        <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', overflowX: 'auto' }}>
          <Box as="table" sx={{ width: '100%', minWidth: 1120, borderCollapse: 'collapse', fontSize: 1 }}>
            <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
              <Box as="tr">
                <SortHead label="Repository" k="repo" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHead label="Score" k="opportunity" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortHead label="Emission" k="emission" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortHead label="PR Pool" k="prPool" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortHead label="Issue Pool" k="issuePool" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <Box as="th" sx={headSx}>Label</Box>
                <Box as="th" sx={headSx}>Branches</Box>
                <Box as="th" sx={headSx}>Gates</Box>
                <SortHead label="Competition" k="competition" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortHead label="PRs 7d" k="activity" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              </Box>
            </Box>
            <Box as="tbody">
              {rows.map(({ repo, stats, score }) => {
                const gates = resolveEligibility(repo.eligibility);
                return (
                  <Box as="tr" key={repo.fullName} sx={{ borderBottom: '1px solid', borderColor: 'border.muted' }}>
                    <Cell>
                      <Link href={'/repos/' + repo.owner + '/' + repo.name} prefetch={false} style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 600 }}>
                        {repo.fullName}
                      </Link>
                    </Cell>
                    <Cell align="right">{score.toFixed(4)}</Cell>
                    <Cell align="right">{pct(repo.emissionShare)}</Cell>
                    <Cell align="right">{pct(prPool(repo))}</Cell>
                    <Cell align="right">{pct(issuePool(repo))}</Cell>
                    <Cell>{labelSummary(repo)}</Cell>
                    <Cell>{branchSummary(repo)}</Cell>
                    <Cell>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Label>PR {gates.minValidMergedPrs}</Label>
                        <Label>Cred {(gates.minCredibility * 100).toFixed(0)}%</Label>
                        <Label>Issue {gates.minValidSolvedIssues}</Label>
                      </Box>
                    </Cell>
                    <Cell align="right">{stats?.contributorCount ?? 0}</Cell>
                    <Cell align="right">{stats?.prsThisWeek ?? 0}</Cell>
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

const headSx = {
  px: 3,
  py: 2,
  textAlign: 'left' as const,
  fontSize: 0,
  color: 'fg.muted',
  fontWeight: 600,
  whiteSpace: 'nowrap' as const,
};

function SortHead({ label, k, current, dir, onClick, align = 'left' }: { label: string; k: SortKey; current: SortKey; dir: 'asc' | 'desc'; onClick: (k: SortKey) => void; align?: 'left' | 'right' }) {
  const active = current === k;
  return (
    <Box as="th" sx={{ ...headSx, textAlign: align }}>
      <Box as="button" onClick={() => onClick(k)} sx={{ bg: 'transparent', border: 0, p: 0, color: active ? 'fg.default' : 'fg.muted', font: 'inherit', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label}
        {active && (dir === 'desc' ? <TriangleDownIcon size={12} /> : <TriangleUpIcon size={12} />)}
      </Box>
    </Box>
  );
}

function Cell({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <Box as="td" sx={{ px: 3, py: 2, textAlign: align, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{children}</Box>;
}
