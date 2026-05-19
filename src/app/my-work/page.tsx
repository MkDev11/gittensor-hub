'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Box, Heading, Label, PageLayout, Text } from '@primer/react';
import { GitPullRequestIcon, IssueOpenedIcon, PeopleIcon, RepoIcon } from '@primer/octicons-react';
import type { RepoEntry } from '@/lib/repos';
import { pct, resolveEligibility } from '@/lib/incentives';
import { formatRelativeTime } from '@/lib/format';

interface Sn74ReposResp {
  repos: RepoEntry[];
}

interface MyPullDto {
  repo_full_name: string;
  number: number;
  title: string;
  state: string;
  draft: number;
  merged: number;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string | null;
  in_whitelist: boolean;
  weight: number | null;
}

interface MyPRsResp {
  login: string;
  count: number;
  in_whitelist_count: number;
  last_fetch: string | null;
  pulls: MyPullDto[];
}

type PullState = 'open' | 'draft' | 'merged' | 'closed';

function pullState(pr: MyPullDto): PullState {
  if (pr.draft) return 'draft';
  if (pr.merged || pr.merged_at) return 'merged';
  if (pr.state === 'closed') return 'closed';
  return 'open';
}

function byUpdated(a: MyPullDto, b: MyPullDto): number {
  return (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? '');
}

export default function MyWorkPage() {
  const myPrsQuery = useQuery<MyPRsResp>({
    queryKey: ['my-prs'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/my-prs', { signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    refetchInterval: 30_000,
  });

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

  const repoByName = useMemo(() => {
    const map = new Map<string, RepoEntry>();
    for (const repo of reposQuery.data?.repos ?? []) map.set(repo.fullName.toLowerCase(), repo);
    return map;
  }, [reposQuery.data]);

  const pulls = myPrsQuery.data?.pulls ?? [];
  const sn74Pulls = pulls.filter((pr) => pr.in_whitelist);
  const openLike = sn74Pulls.filter((pr) => pullState(pr) === 'open' || pullState(pr) === 'draft').sort(byUpdated);
  const merged = sn74Pulls.filter((pr) => pullState(pr) === 'merged').sort(byUpdated).slice(0, 8);
  const counts = pulls.reduce(
    (acc, pr) => {
      const state = pullState(pr);
      acc[state] += 1;
      return acc;
    },
    { open: 0, draft: 0, merged: 0, closed: 0 } as Record<PullState, number>,
  );

  const pressureRows = useMemo(() => {
    const map = new Map<string, { repo: RepoEntry | null; open: number; draft: number; weight: number }>();
    for (const pr of openLike) {
      const repo = repoByName.get(pr.repo_full_name.toLowerCase()) ?? null;
      const row = map.get(pr.repo_full_name) ?? { repo, open: 0, draft: 0, weight: pr.weight ?? repo?.emissionShare ?? 0 };
      if (pullState(pr) === 'draft') row.draft += 1;
      else row.open += 1;
      map.set(pr.repo_full_name, row);
    }
    return [...map.entries()]
      .map(([fullName, row]) => {
        const gate = resolveEligibility(row.repo?.eligibility);
        const limit = gate.excessivePrPenaltyBaseThreshold;
        const total = row.open + row.draft;
        return { fullName, ...row, limit, total, ratio: limit > 0 ? total / limit : total };
      })
      .sort((a, b) => b.ratio - a.ratio || b.weight - a.weight);
  }, [openLike, repoByName]);

  const login = myPrsQuery.data?.login ?? 'you';
  const needsAuth = myPrsQuery.isError;

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>My Work</Heading>
        <Text sx={{ color: 'fg.muted' }}>A reward-focused view of your SN74 pull requests and repo pressure.</Text>
      </PageLayout.Header>
      <PageLayout.Content>
        {needsAuth && (
          <Box sx={{ p: 3, border: '1px solid', borderColor: 'attention.emphasis', bg: 'attention.subtle', borderRadius: 2, mb: 3 }}>
            <Text sx={{ color: 'attention.fg' }}>Sign in with GitHub to load your authored PRs.</Text>
          </Box>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'repeat(4, minmax(0, 1fr))'], gap: 3, mb: 4 }}>
          <Metric icon={<PeopleIcon size={16} />} label="Miner" value={login} hint="GitHub identity" />
          <Metric icon={<RepoIcon size={16} />} label="SN74 PRs" value={myPrsQuery.data?.in_whitelist_count ?? 0} hint={(myPrsQuery.data?.count ?? 0) + ' total'} />
          <Metric icon={<GitPullRequestIcon size={16} />} label="Open Focus" value={openLike.length} hint={counts.draft + ' draft'} />
          <Metric icon={<IssueOpenedIcon size={16} />} label="Merged" value={counts.merged} hint="credited work" />
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'minmax(0, 1.25fr) minmax(320px, 0.75fr)'], gap: 4 }}>
          <Section title="Active Focus" right={<LinkChip href="/my-prs">All PRs</LinkChip>}>
            {openLike.length === 0 ? (
              <EmptyText>{needsAuth ? 'Your PRs are unavailable until you sign in.' : 'No open SN74 PRs found.'}</EmptyText>
            ) : (
              <Box as="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 1 }}>
                <Box as="thead" sx={{ color: 'fg.muted', borderBottom: '1px solid', borderColor: 'border.default' }}>
                  <Box as="tr">
                    <HeadCell>PR</HeadCell>
                    <HeadCell>Repo</HeadCell>
                    <HeadCell>State</HeadCell>
                    <HeadCell align="right">Weight</HeadCell>
                    <HeadCell>Updated</HeadCell>
                  </Box>
                </Box>
                <Box as="tbody">
                  {openLike.slice(0, 12).map((pr) => {
                    const state = pullState(pr);
                    return (
                      <Box as="tr" key={pr.repo_full_name + '#' + pr.number} sx={{ borderBottom: '1px solid', borderColor: 'border.muted' }}>
                        <BodyCell>
                          <a href={pr.html_url ?? '/my-prs'} target={pr.html_url ? '_blank' : undefined} rel={pr.html_url ? 'noreferrer' : undefined} style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 600 }}>
                            #{pr.number} {pr.title}
                          </a>
                        </BodyCell>
                        <BodyCell>{pr.repo_full_name}</BodyCell>
                        <BodyCell><Label variant={state === 'draft' ? 'secondary' : 'success'}>{state}</Label></BodyCell>
                        <BodyCell align="right">{pct(pr.weight ?? 0)}</BodyCell>
                        <BodyCell>{formatRelativeTime(pr.updated_at)}</BodyCell>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}
          </Section>

          <Section title="Repo Pressure">
            {pressureRows.length === 0 ? (
              <EmptyText>No open SN74 pressure to manage.</EmptyText>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {pressureRows.slice(0, 8).map((row) => (
                  <Box key={row.fullName} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 2, alignItems: 'center', py: 2, borderBottom: '1px solid', borderColor: 'border.muted' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Text sx={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.fullName}</Text>
                      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{row.open} open - {row.draft} draft - limit {row.limit}</Text>
                    </Box>
                    <Label variant={row.total > row.limit ? 'attention' : 'success'}>{row.total}/{row.limit}</Label>
                  </Box>
                ))}
              </Box>
            )}
          </Section>
        </Box>

        <Box sx={{ mt: 4 }}>
          <Section title="Recent Credit">
            {merged.length === 0 ? (
              <EmptyText>No merged SN74 PRs found yet.</EmptyText>
            ) : (
              <Box as="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 1 }}>
                <Box as="thead" sx={{ color: 'fg.muted', borderBottom: '1px solid', borderColor: 'border.default' }}>
                  <Box as="tr">
                    <HeadCell>PR</HeadCell>
                    <HeadCell>Repo</HeadCell>
                    <HeadCell align="right">Weight</HeadCell>
                    <HeadCell>Merged</HeadCell>
                  </Box>
                </Box>
                <Box as="tbody">
                  {merged.map((pr) => {
                    return (
                      <Box as="tr" key={pr.repo_full_name + '#' + pr.number} sx={{ borderBottom: '1px solid', borderColor: 'border.muted' }}>
                        <BodyCell>
                          <a href={pr.html_url ?? '/my-prs'} target={pr.html_url ? '_blank' : undefined} rel={pr.html_url ? 'noreferrer' : undefined} style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 600 }}>
                            #{pr.number} {pr.title}
                          </a>
                        </BodyCell>
                        <BodyCell>{pr.repo_full_name}</BodyCell>
                        <BodyCell align="right">{pct(pr.weight ?? 0)}</BodyCell>
                        <BodyCell>{formatRelativeTime(pr.merged_at ?? pr.closed_at)}</BodyCell>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}
          </Section>
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
      <Text sx={{ display: 'block', fontSize: 3, fontWeight: 700, fontFamily: 'mono', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</Text>
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{hint}</Text>
    </Box>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', overflow: 'hidden' }}>
      <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'border.default', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Heading sx={{ fontSize: 2, m: 0 }}>{title}</Heading>
        {right}
      </Box>
      <Box sx={{ p: 3 }}>{children}</Box>
    </Box>
  );
}

function LinkChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} prefetch={false} style={{ textDecoration: 'none' }}>
      <Label>{children}</Label>
    </Link>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <Text sx={{ color: 'fg.muted', fontSize: 1 }}>{children}</Text>;
}

function HeadCell({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <Box as="th" sx={{ px: 2, py: 2, textAlign: align, fontSize: 0, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</Box>;
}

function BodyCell({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <Box as="td" sx={{ px: 2, py: 2, textAlign: align, verticalAlign: 'middle' }}>{children}</Box>;
}
