'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Box, Heading, Label, PageLayout, Spinner, Text } from '@primer/react';
import {
  AlertIcon,
  CheckCircleIcon,
  GitPullRequestIcon,
  GraphIcon,
  IssueOpenedIcon,
  PeopleIcon,
  RepoIcon,
  StackIcon,
} from '@primer/octicons-react';
import type { IssueDto, PullDto } from '@/lib/api-types';
import type { RepoEntry } from '@/lib/repos';
import { labelSummary, opportunityScore } from '@/lib/incentives';
import { formatRelativeTime } from '@/lib/format';

const OSS_SHARE = 0.9;
const TREASURY_SHARE = 0.1;
const DAY_MS = 24 * 60 * 60 * 1000;

type DurationKey = '24h' | '7d' | '35d';

const DURATION_OPTIONS: Array<{ key: DurationKey; label: string; ms: number; buckets: number }> = [
  { key: '24h', label: '24H', ms: DAY_MS, buckets: 24 },
  { key: '7d', label: '7D', ms: 7 * DAY_MS, buckets: 7 },
  { key: '35d', label: '35D', ms: 35 * DAY_MS, buckets: 35 },
];

interface Sn74ReposResp {
  repos: RepoEntry[];
  source: 'live' | 'empty';
  fetched_at: string | null;
  count: number;
}

interface GtRepo {
  fullName: string;
  totalScore: number;
  totalPrCount?: number;
  mergedPrCount: number;
  contributorCount: number;
  collateralStaked?: number;
  prsThisWeek: number;
  prsLastWeek?: number;
  trendingPct?: number;
  lastPrAt: string | null;
}

interface GtPrSummary {
  pullRequestNumber: number;
  title: string;
  repository: string;
  author: string;
  prCreatedAt: string;
  prState: string;
  mergedAt: string | null;
  score: number | null;
  additions: number | null;
  deletions: number | null;
}

interface GtReposResp {
  fetched_at: number;
  source?: string;
  count: number;
  activeCount: number;
  inactiveCount: number;
  repos: GtRepo[];
  recentPrs: GtPrSummary[];
  prs?: GtPrSummary[];
}

interface Miner {
  id?: string;
  uid?: number;
  githubUsername?: string;
  githubId?: string;
  isEligible?: boolean;
  isIssueEligible?: boolean;
  failedReason?: string | null;
  credibility?: string | number;
  issueCredibility?: string | number;
  issueDiscoveryScore?: string | number;
  totalScore?: string | number;
  totalMergedPrs?: number;
  totalOpenPrs?: number;
  totalOpenIssues?: number;
  totalSolvedIssues?: number;
  uniqueReposCount?: number;
  alphaPerDay?: number;
  usdPerDay?: number;
}

interface MinersResp {
  count: number;
  fetched_at?: number;
  source?: string;
  miners: Miner[];
}

interface IssuesResp {
  count: number;
  repo_count: number;
  issues: IssueDto[];
}

interface PullsResp {
  count: number;
  pulls: PullDto[];
}

interface OnchainResp {
  fetched_at: number;
  source?: string;
  daily?: { alpha?: number; tao?: number; usd?: number };
  rates?: { alphaUsd?: number };
  emission?: { scoringShare?: number; issueTreasuryShare?: number };
}

interface RepoRow {
  repo: RepoEntry;
  stats?: GtRepo;
  openIssues: number;
  prShare: number;
  issueShare: number;
  score: number;
  health: 'healthy' | 'watch' | 'quiet';
}

interface FeaturedIssue {
  issue: IssueDto;
  repo: RepoEntry;
  mode: 'solve' | 'discover';
  score: number;
  multiplier: number;
}

type ActivityKey = 'mergedPrs' | 'resolvedIssues' | 'openedPrs' | 'openedIssues';

interface DayPoint {
  label: string;
  mergedPrs: number;
  resolvedIssues: number;
  openedPrs: number;
  openedIssues: number;
}

const ACTIVITY_SERIES: Array<{ key: ActivityKey; label: string; color: string }> = [
  { key: 'mergedPrs', label: 'Merged PRs', color: 'var(--success-fg)' },
  { key: 'resolvedIssues', label: 'Issues Resolved', color: 'var(--attention-fg)' },
  { key: 'openedPrs', label: 'PRs Opened', color: 'var(--accent-fg)' },
  { key: 'openedIssues', label: 'Issues Opened', color: 'var(--done-fg)' },
];

interface AlertRow {
  tone: 'danger' | 'attention' | 'accent';
  title: string;
  detail: string;
  age: string;
}

interface RecentActivityItem {
  id: string;
  kind: 'pr' | 'issue' | 'bounty';
  tone: 'accent' | 'success' | 'attention' | 'danger' | 'done';
  badge: string;
  title: string;
  detail: string;
  href: string;
  timestamp: number;
  repo: string;
  actor?: string;
  meta?: string;
}

interface PipelineColumn {
  key: 'draft' | 'submitted' | 'merged' | 'closed' | 'scored';
  title: string;
  caption: string;
  color: string;
  pulls: PullDto[];
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : 0;
  return Number.isFinite(n) ? n : 0;
}

function fmtPct(value: number, signed = false): string {
  if (!Number.isFinite(value)) return signed ? '0%' : '0%';
  const pct = value * 100;
  const sign = signed && pct > 0 ? '+' : '';
  return sign + pct.toFixed(Math.abs(pct) >= 10 ? 1 : 2) + '%';
}

function fmtCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function fmtNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function fmtToken(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function relative(value: string | number | null | undefined): string {
  if (!value) return 'pending';
  const iso = typeof value === 'number' ? new Date(value).toISOString() : value;
  return formatRelativeTime(iso);
}

function durationConfig(key: DurationKey) {
  return DURATION_OPTIONS.find((option) => option.key === key) ?? DURATION_OPTIONS[1];
}

function durationLabel(date: Date, key: DurationKey): string {
  if (key === '24h') return date.toLocaleTimeString(undefined, { hour: 'numeric' });
  if (key === '35d') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

function rewardParts(repo: RepoEntry): { total: number; pr: number; issue: number } {
  const total = repo.emissionShare * OSS_SHARE;
  const afterMaintainer = Math.max(0, total - total * repo.maintainerCut);
  const issue = afterMaintainer * repo.issueDiscoveryShare;
  return { total, pr: afterMaintainer - issue, issue };
}

function issueBoost(issue: IssueDto, repo: RepoEntry): number {
  const labels = new Set(issue.labels.map((label) => label.name.toLowerCase()));
  let best = repo.defaultLabelMultiplier || 1;
  for (const [label, multiplier] of Object.entries(repo.labelMultipliers)) {
    if (labels.has(label.toLowerCase())) best = Math.max(best, multiplier);
  }
  return best;
}

function issueHref(issue: IssueDto): string {
  return issue.html_url ?? 'https://github.com/' + issue.repo_full_name + '/issues/' + issue.number;
}

function repoHref(repo: RepoEntry | string): string {
  const fullName = typeof repo === 'string' ? repo : repo.fullName;
  const [owner, name] = fullName.split('/');
  return '/repos/' + owner + '/' + name;
}

function pullKey(repo: string, number: number): string {
  return repo.toLowerCase() + '#' + number;
}

function parseTime(value: string | null | undefined): number {
  const ts = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ts) ? ts : 0;
}

function activityTimestamp(item: RecentActivityItem): number {
  return item.timestamp;
}

function pullTimestamp(pr: PullDto): number {
  const raw = pr.updated_at ?? pr.created_at ?? pr.closed_at ?? pr.merged_at;
  const ts = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(ts) ? ts : 0;
}

function pipelineTimestamp(pr: PullDto, stage: PipelineColumn['key']): number {
  const raw = stage === 'scored'
    ? pr.merged_at ?? pr.updated_at ?? pr.created_at ?? pr.closed_at
    : pr.updated_at ?? pr.created_at ?? pr.closed_at ?? pr.merged_at;
  const ts = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(ts) ? ts : 0;
}

function pipelineAge(pr: PullDto, stage: PipelineColumn['key']): string {
  const raw = stage === 'scored'
    ? pr.merged_at ?? pr.updated_at ?? pr.created_at ?? pr.closed_at
    : pr.updated_at ?? pr.created_at ?? pr.closed_at ?? pr.merged_at;
  return relative(raw);
}

function hasOfficialScore(pr: PullDto): boolean {
  return pr.scored === true && typeof pr.score === 'number' && Number.isFinite(pr.score) && pr.score >= 0;
}

function fmtSignedNumber(value: number): string {
  if (value > 0) return '+' + fmtNumber(value);
  if (value < 0) return '-' + fmtNumber(Math.abs(value));
  return '0';
}

function isOpenPull(pr: PullDto): boolean {
  return pr.state.toLowerCase() === 'open' && !pr.merged && !pr.merged_at;
}

function addActivity(points: DayPoint[], start: number, now: number, bucketMs: number, timestamp: number, key: ActivityKey) {
  if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) return;
  const idx = Math.min(points.length - 1, Math.max(0, Math.floor((timestamp - start) / bucketMs)));
  points[idx][key] += 1;
}

function buildActivityPoints(pulls: PullDto[], issues: IssueDto[], activeRepoSet: Set<string>, duration: ReturnType<typeof durationConfig>): DayPoint[] {
  const now = Date.now();
  const start = now - duration.ms;
  const bucketMs = duration.ms / duration.buckets;
  const points = Array.from({ length: duration.buckets }, (_, i) => {
    const date = new Date(start + i * bucketMs);
    return { label: durationLabel(date, duration.key), mergedPrs: 0, resolvedIssues: 0, openedPrs: 0, openedIssues: 0 };
  });

  for (const pr of pulls) {
    addActivity(points, start, now, bucketMs, pr.created_at ? Date.parse(pr.created_at) : Number.NaN, 'openedPrs');
    addActivity(points, start, now, bucketMs, pr.merged_at ? Date.parse(pr.merged_at) : Number.NaN, 'mergedPrs');
  }

  for (const issue of issues) {
    if (!activeRepoSet.has(issue.repo_full_name.toLowerCase())) continue;
    addActivity(points, start, now, bucketMs, issue.created_at ? Date.parse(issue.created_at) : Number.NaN, 'openedIssues');
    if (issue.state_reason === 'completed') {
      addActivity(points, start, now, bucketMs, issue.closed_at ? Date.parse(issue.closed_at) : Number.NaN, 'resolvedIssues');
    }
  }

  return points;
}

function buildPullPipeline(pulls: PullDto[]): PipelineColumn[] {
  const columns: PipelineColumn[] = [
    { key: 'draft', title: 'Drafting', caption: 'draft PRs', color: 'var(--fg-muted)', pulls: [] },
    { key: 'submitted', title: 'Submitted', caption: 'open PRs', color: 'var(--success-fg)', pulls: [] },
    { key: 'closed', title: 'Closed', caption: 'not merged', color: 'var(--danger-fg)', pulls: [] },
    { key: 'merged', title: 'Merged', caption: 'pending Gittensor validation', color: 'var(--accent-fg)', pulls: [] },
    { key: 'scored', title: 'Scored', caption: 'official score', color: 'var(--done-fg)', pulls: [] },
  ];
  const byKey = new Map(columns.map((column) => [column.key, column]));
  for (const pr of pulls) {
    let key: PipelineColumn['key'];
    if (hasOfficialScore(pr)) key = 'scored';
    else if (pr.merged || pr.merged_at) key = 'merged';
    else if (!isOpenPull(pr)) key = 'closed';
    else if (pr.draft) key = 'draft';
    else key = 'submitted';
    byKey.get(key)?.pulls.push(pr);
  }
  for (const column of columns) {
    column.pulls.sort((a, b) => pipelineTimestamp(b, column.key) - pipelineTimestamp(a, column.key));
  }
  return columns;
}

function sourceReady(source: string | undefined): boolean {
  return source === 'live' || source === 'cache' || source === 'github';
}

function healthFor(row: { stats?: GtRepo; openIssues: number }): RepoRow['health'] {
  const weekly = row.stats?.prsThisWeek ?? 0;
  const last = row.stats?.lastPrAt ? Date.now() - Date.parse(row.stats.lastPrAt) : Number.POSITIVE_INFINITY;
  if (weekly > 0 || last < 10 * DAY_MS) return 'healthy';
  if (row.openIssues > 0 || last < 45 * DAY_MS) return 'watch';
  return 'quiet';
}

export default function DashboardPage() {
  const [durationKey, setDurationKey] = useState<DurationKey>('7d');
  const duration = durationConfig(durationKey);
  const reposQuery = useQuery<Sn74ReposResp>({
    queryKey: ['dashboard-sn74-repos'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/sn74-repos', { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });

  const gtReposQuery = useQuery<GtReposResp>({
    queryKey: ['dashboard-gt-repos'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/gt/repositories', { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const minersQuery = useQuery<MinersResp>({
    queryKey: ['dashboard-miners'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/miners', { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },
    refetchInterval: 10_000,
  });

  const issuesQuery = useQuery<IssuesResp>({
    queryKey: ['dashboard-issues'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/issues', { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const onchainQuery = useQuery<OnchainResp>({
    queryKey: ['dashboard-onchain'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/onchain', { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const repos = reposQuery.data?.repos ?? [];
  const activeRepos = useMemo(() => repos.filter((repo) => !repo.inactiveAt && repo.emissionShare > 0), [repos]);
  const activeRepoNames = useMemo(() => activeRepos.map((repo) => repo.fullName).sort(), [activeRepos]);
  const activeRepoSet = useMemo(() => new Set(activeRepoNames.map((repo) => repo.toLowerCase())), [activeRepoNames]);

  const pullsQuery = useQuery<PullsResp>({
    queryKey: ['dashboard-pulls', activeRepoNames, duration.ms],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ repos: activeRepoNames.join(','), since: String(Date.now() - duration.ms) });
      const response = await fetch('/api/pulls?' + params.toString(), { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },
    enabled: activeRepoNames.length > 0,
    refetchInterval: 30_000,
  });
  const miners = minersQuery.data?.miners ?? [];
  const issues = issuesQuery.data?.issues ?? [];
  const gtRepos = gtReposQuery.data?.repos ?? [];
  const gtPrMetrics = gtReposQuery.data?.prs ?? [];

  const localPullByKey = useMemo(() => {
    const map = new Map<string, PullDto>();
    for (const pr of pullsQuery.data?.pulls ?? []) {
      map.set(pullKey(pr.repo_full_name, pr.number), pr);
    }
    return map;
  }, [pullsQuery.data?.pulls]);

  const pipelinePulls = useMemo<PullDto[]>(() => {
    const fetchedAt = gtReposQuery.data?.fetched_at ? new Date(gtReposQuery.data.fetched_at).toISOString() : new Date().toISOString();
    return gtPrMetrics
      .filter((metric) => activeRepoSet.has(metric.repository.toLowerCase()))
      .map((metric, index) => {
        const local = localPullByKey.get(pullKey(metric.repository, metric.pullRequestNumber));
        const officialMerged = Boolean(metric.mergedAt);
        const githubMerged = Boolean(officialMerged || local?.merged || local?.merged_at);
        const githubClosed = Boolean(local?.state?.toLowerCase() === 'closed');
        const state = githubMerged || githubClosed || metric.prState.toLowerCase() === 'closed' ? 'closed' : 'open';
        const mergedAt = metric.mergedAt ?? (githubMerged ? local?.merged_at ?? local?.closed_at ?? local?.updated_at ?? null : null);
        const closedAt = state === 'closed' ? metric.mergedAt ?? local?.closed_at ?? mergedAt : null;
        const validatedByGittensor = officialMerged && metric.score !== null && metric.score >= 0;
        return {
          id: local?.id ?? -index - 1,
          repo_full_name: local?.repo_full_name ?? metric.repository,
          number: metric.pullRequestNumber,
          title: metric.title,
          body: local?.body ?? null,
          state,
          draft: local?.draft ?? 0,
          merged: githubMerged ? 1 : 0,
          author_login: metric.author || local?.author_login || null,
          author_association: local?.author_association ?? null,
          created_at: metric.prCreatedAt,
          updated_at: metric.mergedAt ?? local?.updated_at ?? metric.prCreatedAt,
          closed_at: closedAt,
          merged_at: mergedAt,
          html_url: 'https://github.com/' + metric.repository + '/pull/' + metric.pullRequestNumber,
          fetched_at: fetchedAt,
          first_seen_at: metric.prCreatedAt,
          additions: metric.additions,
          deletions: metric.deletions,
          score: metric.score,
          scored: validatedByGittensor,
        };
      });
  }, [activeRepoSet, gtPrMetrics, gtReposQuery.data?.fetched_at, localPullByKey]);

  const repoByName = useMemo(() => {
    const map = new Map<string, RepoEntry>();
    for (const repo of activeRepos) map.set(repo.fullName.toLowerCase(), repo);
    return map;
  }, [activeRepos]);

  const statsByRepo = useMemo(() => {
    const map = new Map<string, GtRepo>();
    for (const repo of gtRepos) map.set(repo.fullName.toLowerCase(), repo);
    return map;
  }, [gtRepos]);

  const openIssueCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const issue of issues) {
      if (issue.state !== 'open') continue;
      const key = issue.repo_full_name.toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [issues]);

  const repoRows = useMemo<RepoRow[]>(() => {
    return activeRepos
      .map((repo) => {
        const parts = rewardParts(repo);
        const stats = statsByRepo.get(repo.fullName.toLowerCase());
        const row = {
          repo,
          stats,
          openIssues: openIssueCounts.get(repo.fullName.toLowerCase()) ?? 0,
          prShare: parts.pr,
          issueShare: parts.issue,
          score: opportunityScore(repo, stats),
          health: 'quiet' as RepoRow['health'],
        };
        row.health = healthFor(row);
        return row;
      })
      .sort((a, b) => b.score - a.score);
  }, [activeRepos, openIssueCounts, statsByRepo]);

  const featuredIssues = useMemo<FeaturedIssue[]>(() => {
    return issues
      .filter((issue) => issue.state === 'open')
      .map((issue) => {
        const repo = repoByName.get(issue.repo_full_name.toLowerCase());
        if (!repo) return null;
        const parts = rewardParts(repo);
        const multiplier = issueBoost(issue, repo);
        const comments = Math.min(issue.comments, 20);
        const recency = issue.updated_at ? Math.max(0, 1 - Math.min(30, (Date.now() - Date.parse(issue.updated_at)) / DAY_MS) / 30) : 0;
        const solveScore = parts.pr * multiplier * (1 + comments * 0.012 + recency * 0.2);
        const discoverScore = parts.issue * (1 + comments * 0.008 + recency * 0.15);
        return {
          issue,
          repo,
          mode: discoverScore > solveScore ? 'discover' : 'solve',
          score: Math.max(solveScore, discoverScore),
          multiplier,
        };
      })
      .filter((item): item is FeaturedIssue => Boolean(item))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [issues, repoByName]);

  const rewardTotals = useMemo(() => {
    const totalConfigured = activeRepos.reduce((sum, repo) => sum + repo.emissionShare, 0);
    const pr = activeRepos.reduce((sum, repo) => sum + rewardParts(repo).pr, 0);
    const issue = activeRepos.reduce((sum, repo) => sum + rewardParts(repo).issue, 0);
    const recycle = Math.max(0, 1 - totalConfigured) * OSS_SHARE;
    return { configured: totalConfigured, pr, issue, recycle, treasury: TREASURY_SHARE };
  }, [activeRepos]);

  const minerStats = useMemo(() => {
    const prEligible = miners.filter((miner) => miner.isEligible).length;
    const issueEligible = miners.filter((miner) => miner.isIssueEligible).length;
    const merged = miners.reduce((sum, miner) => sum + (miner.totalMergedPrs ?? 0), 0);
    const openPrs = miners.reduce((sum, miner) => sum + (miner.totalOpenPrs ?? 0), 0);
    const solvedIssues = miners.reduce((sum, miner) => sum + (miner.totalSolvedIssues ?? 0), 0);
    const prScore = miners.reduce((sum, miner) => sum + num(miner.totalScore), 0);
    const issueScore = miners.reduce((sum, miner) => sum + num(miner.issueDiscoveryScore), 0);
    const score = prScore + issueScore;
    const top = [...miners]
      .sort((a, b) => num(b.usdPerDay) - num(a.usdPerDay) || num(b.issueDiscoveryScore ?? b.totalScore) - num(a.issueDiscoveryScore ?? a.totalScore))
      .slice(0, 5);
    return {
      prEligible,
      issueEligible,
      merged,
      openPrs,
      solvedIssues,
      prScore,
      issueScore,
      score,
      top,
    };
  }, [miners]);

  const rangePulls = useMemo(() => {
    const cutoff = Date.now() - duration.ms;
    return pipelinePulls.filter((pr) => pullTimestamp(pr) >= cutoff);
  }, [duration.ms, pipelinePulls]);
  const prPipeline = useMemo(() => buildPullPipeline(rangePulls), [rangePulls]);

  const recentActivity = useMemo<RecentActivityItem[]>(() => {
    const items: RecentActivityItem[] = [];
    const addItem = (item: RecentActivityItem) => {
      if (Number.isFinite(item.timestamp) && item.timestamp > 0) items.push(item);
    };

    for (const pr of pipelinePulls) {
      const merged = Boolean(pr.merged_at);
      const closed = !merged && pr.state.toLowerCase() === 'closed';
      const timestamp = merged ? parseTime(pr.merged_at) : closed ? parseTime(pr.closed_at ?? pr.updated_at) : parseTime(pr.created_at ?? pr.updated_at);
      const scoreText = hasOfficialScore(pr) ? 'score ' + fmtNumber(pr.score ?? 0) : null;
      addItem({
        id: 'pr:' + pr.repo_full_name + '#' + pr.number,
        kind: 'pr',
        tone: merged ? 'success' : closed ? 'danger' : 'accent',
        badge: merged ? (hasOfficialScore(pr) ? 'Scored PR' : 'Merged PR') : closed ? 'Closed PR' : 'PR opened',
        title: '#' + pr.number + ' ' + pr.title,
        detail: pr.repo_full_name + (pr.author_login ? ' · ' + pr.author_login : ''),
        href: pr.html_url ?? 'https://github.com/' + pr.repo_full_name + '/pull/' + pr.number,
        timestamp,
        repo: pr.repo_full_name,
        actor: pr.author_login ?? undefined,
        meta: scoreText ?? undefined,
      });
    }

    for (const issue of issues) {
      if (!activeRepoSet.has(issue.repo_full_name.toLowerCase())) continue;
      const repo = repoByName.get(issue.repo_full_name.toLowerCase());
      const isOpen = issue.state === 'open';
      const multiplier = repo ? issueBoost(issue, repo) : 1;
      const parts = repo ? rewardParts(repo) : null;
      const isBounty = Boolean(isOpen && repo && !repo.inactiveAt && repo.emissionShare > 0 && ((parts?.issue ?? 0) > 0 || multiplier > 1));

      if (isBounty && repo && parts) {
        const discovery = parts.issue > parts.pr;
        const rewardPool = discovery ? parts.issue : parts.pr;
        addItem({
          id: 'bounty:' + issue.repo_full_name + '#' + issue.number,
          kind: 'bounty',
          tone: 'success',
          badge: discovery ? 'Discovery' : 'Solve',
          title: '#' + issue.number + ' ' + issue.title,
          detail: issue.repo_full_name + ' · ' + multiplier.toFixed(2) + 'x label',
          href: issueHref(issue),
          timestamp: parseTime(issue.updated_at ?? issue.created_at),
          repo: issue.repo_full_name,
          actor: issue.author_login ?? undefined,
          meta: fmtPct(rewardPool) + (discovery ? ' issue pool' : ' PR pool'),
        });
        continue;
      }

      const completed = issue.state_reason === 'completed';
      const closed = issue.state !== 'open';
      addItem({
        id: 'issue:' + issue.repo_full_name + '#' + issue.number,
        kind: 'issue',
        tone: completed ? 'done' : closed ? 'danger' : 'attention',
        badge: completed ? 'Issue resolved' : closed ? 'Issue closed' : 'Issue opened',
        title: '#' + issue.number + ' ' + issue.title,
        detail: issue.repo_full_name + (issue.author_login ? ' · ' + issue.author_login : ''),
        href: issueHref(issue),
        timestamp: closed ? parseTime(issue.closed_at ?? issue.updated_at) : parseTime(issue.created_at ?? issue.updated_at),
        repo: issue.repo_full_name,
        actor: issue.author_login ?? undefined,
      });
    }

    const sorted = items.sort((a, b) => activityTimestamp(b) - activityTimestamp(a));
    const selected: RecentActivityItem[] = [];
    const seen = new Set<string>();
    for (const kind of ['pr', 'issue', 'bounty'] as const) {
      const item = sorted.find((candidate) => candidate.kind === kind);
      if (item && !seen.has(item.id)) {
        selected.push(item);
        seen.add(item.id);
      }
    }
    for (const item of sorted) {
      if (selected.length >= 6) break;
      if (seen.has(item.id)) continue;
      selected.push(item);
      seen.add(item.id);
    }
    return selected.sort((a, b) => b.timestamp - a.timestamp);
  }, [activeRepoSet, issues, pipelinePulls, repoByName]);

  const weeklyPrs = repoRows.reduce((sum, row) => sum + (row.stats?.prsThisWeek ?? 0), 0);
  const totalMerged = gtRepos.reduce((sum, repo) => sum + (repo.mergedPrCount ?? 0), 0);
  const totalPrs = gtRepos.reduce((sum, repo) => sum + (repo.totalPrCount ?? 0), 0);
  const reviewQueue = Math.max(0, totalPrs - totalMerged);
  const activeRepoCount = activeRepos.length;
  const previousPrs = repoRows.reduce((sum, row) => sum + (row.stats?.prsLastWeek ?? 0), 0);
  const prsDelta = previousPrs > 0 ? (weeklyPrs - previousPrs) / previousPrs : 0;
  const earningsTao = onchainQuery.data?.daily?.tao ?? 0;
  const avgTrend = gtRepos.length > 0 ? gtRepos.reduce((sum, repo) => sum + num(repo.trendingPct), 0) / gtRepos.length / 100 : 0;
  const isLoading = reposQuery.isLoading || gtReposQuery.isLoading || minersQuery.isLoading || issuesQuery.isLoading;

  const activity = useMemo<DayPoint[]>(() => buildActivityPoints(pipelinePulls, issues, activeRepoSet, duration), [activeRepoSet, duration, issues, pipelinePulls]);

  const alerts = useMemo<AlertRow[]>(() => {
    const rows: AlertRow[] = [];
    const quiet = repoRows.find((row) => row.health === 'quiet');
    if (quiet) rows.push({ tone: 'attention', title: quiet.repo.fullName, detail: 'No recent PR activity', age: relative(quiet.stats?.lastPrAt) });
    const loaded = repoRows.find((row) => row.openIssues >= 5);
    if (loaded) rows.push({ tone: 'accent', title: loaded.repo.fullName, detail: loaded.openIssues + ' open issues cached', age: 'now' });
    const failedCount = miners.filter((miner) => miner.failedReason).length;
    if (failedCount > 0) rows.push({ tone: 'danger', title: 'Miner gate failures', detail: failedCount + ' miners report a failure reason', age: 'live' });
    const lowIssueReady = miners.length > 0 && minerStats.issueEligible / miners.length < 0.3;
    if (lowIssueReady) rows.push({ tone: 'attention', title: 'Issue eligibility', detail: 'Low issue-eligible miner ratio', age: 'live' });
    return rows.slice(0, 4);
  }, [miners, minerStats.issueEligible, repoRows]);

  if (isLoading && !reposQuery.data) {
    return (
      <PageLayout containerWidth="full" padding="normal">
        <PageLayout.Content>
          <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center', color: 'fg.muted' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Spinner size="small" />
              <Text>Loading dashboard</Text>
            </Box>
          </Box>
        </PageLayout.Content>
      </PageLayout>
    );
  }

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Box sx={{ maxWidth: 1480, mx: 'auto', width: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 0 }}>
            <Heading sx={{ m: 0, fontSize: 4 }}>Dashboard</Heading>
            <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 1, mt: 1 }}>Subnet 74 operator overview</Text>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Source label="Repos" ok={reposQuery.data?.source === 'live'} detail={relative(reposQuery.data?.fetched_at)} />
              <Source label="Issues/PRs" ok={sourceReady(gtReposQuery.data?.source)} detail={relative(gtReposQuery.data?.fetched_at)} />
              <Source label="Scores" ok={sourceReady(minersQuery.data?.source)} detail={relative(minersQuery.data?.fetched_at)} />
            </Box>
            <DurationPicker value={durationKey} onChange={setDurationKey} />
          </Box>
        </Box>
      </PageLayout.Header>

      <PageLayout.Content>
        <Box sx={{ maxWidth: 1480, mx: 'auto', width: '100%', display: 'grid', gap: 3 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', 'repeat(2, minmax(0, 1fr))', null, 'repeat(5, minmax(0, 1fr))'], gap: 3 }}>
            <StatCard tone="blue" icon={<GraphIcon size={21} />} label="Contribution Score" value={fmtNumber(minerStats.score)} change={avgTrend !== 0 ? fmtPct(avgTrend, true) : 'live'} detail={avgTrend !== 0 ? 'avg repo trend' : 'miner feed'} />
            <StatCard tone="green" icon={<GitPullRequestIcon size={21} />} label="PRs Merged" value={fmtCount(totalMerged || minerStats.merged)} change={previousPrs > 0 ? fmtPct(prsDelta, true) : 'live'} detail={previousPrs > 0 ? 'vs prior week' : '7d feed'} />
            <StatCard tone="purple" icon={<IssueOpenedIcon size={21} />} label="Open PR Queue" value={fmtCount(reviewQueue || minerStats.openPrs)} change="live" detail="open PRs" />
            <StatCard tone="blue" icon={<RepoIcon size={21} />} label="Repositories" value={fmtCount(activeRepoCount)} change={fmtPct(rewardTotals.recycle > 0 ? -rewardTotals.recycle : 0, true)} detail="unallocated" />
            <StatCard tone="green" icon={<StackIcon size={21} />} label="Earnings Today" value={fmtToken(earningsTao)} suffix="TAO" change="live" detail="on-chain feed" />
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'minmax(0, 1.05fr) minmax(420px, 0.95fr)'], gap: 3, alignItems: 'stretch' }}>
            <Panel title="Activity Over Time" action={<RangePill label={duration.label} />}>
              <LineChart points={activity} />
            </Panel>
            <Panel title="Recent Activity" action={<LinkPill href="/opportunities">View all</LinkPill>}>
              <RecentActivity items={recentActivity} />
            </Panel>
          </Box>

          <PullRequestPipeline columns={prPipeline} durationLabel={duration.label} />

          <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'minmax(0, 0.95fr) minmax(0, 1.05fr) minmax(340px, 0.95fr)'], gap: 3, alignItems: 'start' }}>
            <Panel title="Top Miners" action={<LinkPill href="/miners">View leaderboard</LinkPill>}>
              <TopMiners miners={minerStats.top} />
            </Panel>
            <Panel title="Repository Insights">
              <RepositoryInsights rows={repoRows.slice(0, 5)} />
            </Panel>
            <Box sx={{ display: 'grid', gap: 3 }}>
              <Panel title="Reward Breakdown" action={<GraphIcon size={14} />}>
                <ScoreBreakdown totals={rewardTotals} />
              </Panel>
              <Panel title="Watchlist / Alerts" action={<LinkPill href="/opportunities">View all</LinkPill>}>
                <Alerts rows={alerts} />
              </Panel>
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'minmax(0, 1.1fr) minmax(0, 0.9fr)'], gap: 3, alignItems: 'start' }}>
            <Panel title="Featured Work Queue" action={<LinkPill href="/issues">Issues</LinkPill>}>
              <FeaturedIssues rows={featuredIssues.slice(0, 6)} />
            </Panel>
            <Panel title="Eligibility Snapshot" action={<LinkPill href="/miners">Miners</LinkPill>}>
              <EligibilitySnapshot prReady={minerStats.prEligible} issueReady={minerStats.issueEligible} total={miners.length} solvedIssues={minerStats.solvedIssues} />
            </Panel>
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

function Source({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: ok ? 'success.fg' : 'attention.fg', fontSize: 0 }}>
      {ok ? <CheckCircleIcon size={14} /> : <AlertIcon size={14} />}
      <Text sx={{ fontWeight: 600 }}>{label}</Text>
      <Text sx={{ color: 'fg.muted' }}>{detail}</Text>
    </Box>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', minWidth: 0, overflow: 'hidden', boxShadow: 'shadow.small' }}>
      <Box sx={{ minHeight: 42, px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Heading sx={{ fontSize: 1, m: 0 }}>{title}</Heading>
        {action}
      </Box>
      <Box sx={{ px: 3, pb: 3 }}>{children}</Box>
    </Box>
  );
}

function LinkPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} prefetch={false} style={{ color: 'var(--accent-fg)', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
      {children}
    </Link>
  );
}

function RangePill({ label }: { label: string }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', px: 2, py: 1, color: 'fg.default', fontSize: 0, fontWeight: 600 }}>
      {label}
    </Box>
  );
}

function DurationPicker({ value, onChange }: { value: DurationKey; onChange: (value: DurationKey) => void }) {
  return (
    <Box role="group" aria-label="Dashboard duration" sx={{ display: 'inline-flex', border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', overflow: 'hidden' }}>
      {DURATION_OPTIONS.map((option) => {
        const selected = option.key === value;
        return (
          <Box
            as="button"
            type="button"
            key={option.key}
            aria-pressed={selected}
            onClick={() => onChange(option.key)}
            sx={{
              appearance: 'none',
              border: 0,
              borderLeft: option.key === DURATION_OPTIONS[0].key ? 0 : '1px solid',
              borderColor: 'border.muted',
              bg: selected ? 'accent.subtle' : 'transparent',
              color: selected ? 'accent.fg' : 'fg.muted',
              cursor: 'pointer',
              fontSize: 0,
              fontWeight: 700,
              minWidth: 54,
              px: 3,
              py: 1,
              lineHeight: '20px',
              ':hover': { color: 'fg.default', bg: selected ? 'accent.subtle' : 'canvas.default' },
            }}
          >
            {option.label}
          </Box>
        );
      })}
    </Box>
  );
}

function statColor(tone: 'blue' | 'green' | 'purple') {
  if (tone === 'green') return { bg: 'success.subtle', fg: 'success.fg' };
  if (tone === 'purple') return { bg: 'done.subtle', fg: 'done.fg' };
  return { bg: 'accent.subtle', fg: 'accent.fg' };
}

function StatCard({ tone, icon, label, value, suffix, change, detail }: { tone: 'blue' | 'green' | 'purple'; icon: React.ReactNode; label: string; value: string; suffix?: string; change: string; detail: string }) {
  const color = statColor(tone);
  const positive = !change.startsWith('-');
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', boxShadow: 'shadow.small', p: 3, minWidth: 0 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: 2, alignItems: 'start' }}>
        <Box sx={{ width: 38, height: 38, borderRadius: 2, bg: color.bg, color: color.fg, display: 'grid', placeItems: 'center' }}>{icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Text>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 1 }}>
            <Text sx={{ color: 'fg.default', fontSize: 4, lineHeight: 1, fontWeight: 700, fontFamily: 'mono' }}>{value}</Text>
            {suffix && <Text sx={{ color: 'fg.muted', fontSize: 0, fontWeight: 600 }}>{suffix}</Text>}
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 3, color: positive ? 'success.fg' : 'danger.fg', fontSize: 0 }}>
        <Text sx={{ fontWeight: 700 }}>{change}</Text>
        <Text sx={{ color: 'fg.muted' }}>{detail}</Text>
      </Box>
    </Box>
  );
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return 'M ' + points[0].x + ' ' + points[0].y;
  return points
    .map((point, index) => {
      if (index === 0) return 'M ' + point.x + ' ' + point.y;
      const prev = points[index - 1];
      const cpX = prev.x + (point.x - prev.x) / 2;
      return 'C ' + cpX + ' ' + prev.y + ' ' + cpX + ' ' + point.y + ' ' + point.x + ' ' + point.y;
    })
    .join(' ');
}

function LineChart({ points }: { points: DayPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 900;
  const height = 272;
  const pad = { left: 44, right: 18, top: 18, bottom: 36 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(4, ...points.flatMap((point) => ACTIVITY_SERIES.map((series) => point[series.key])));
  const yMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const active = hoveredIndex === null ? null : { index: hoveredIndex, point: points[hoveredIndex] };
  const x = (idx: number) => pad.left + (idx * plotWidth) / Math.max(1, points.length - 1);
  const y = (value: number) => pad.top + (1 - value / yMax) * plotHeight;
  const tickStep = Math.max(1, Math.ceil(points.length / 7));
  const totals = ACTIVITY_SERIES.map((series) => ({ ...series, total: points.reduce((sum, point) => sum + point[series.key], 0) }));
  const tooltipWidth = 186;
  const tooltipX = active ? Math.min(width - tooltipWidth - 10, Math.max(10, x(active.index) - tooltipWidth / 2)) : 0;
  const tooltipY = pad.top + 8;

  return (
    <Box sx={{ minWidth: 0 }}>
      <style>{`
        @keyframes activity-line-draw { from { stroke-dashoffset: 1; opacity: .28; } to { stroke-dashoffset: 0; opacity: 1; } }
        @keyframes activity-dot-rise { from { transform: scale(.45); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .activity-line, .activity-dot { animation: none !important; stroke-dashoffset: 0 !important; opacity: 1 !important; } }
      `}</style>
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        {totals.map((series) => <ActivityLegend key={series.key} color={series.color} label={series.label} total={series.total} />)}
      </Box>
      <Box sx={{ width: '100%', overflow: 'hidden', border: '1px solid', borderColor: 'border.muted', borderRadius: 2, bg: 'canvas.subtle' }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Network activity over time" onMouseLeave={() => setHoveredIndex(null)}>
          <defs>
            <linearGradient id="activitySurface" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-fg)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--accent-fg)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const value = Math.round(yMax * (1 - tick));
            const lineY = pad.top + tick * plotHeight;
            return (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke="var(--border-muted)" strokeDasharray="3 6" />
                <text x={pad.left - 10} y={lineY + 4} textAnchor="end" fontSize="10" fill="var(--fg-muted)">{value}</text>
              </g>
            );
          })}
          <path
            d={`${smoothPath(points.map((point, idx) => ({ x: x(idx), y: y(point.openedPrs) })))} L ${x(points.length - 1)} ${height - pad.bottom} L ${pad.left} ${height - pad.bottom} Z`}
            fill="url(#activitySurface)"
          />
          {ACTIVITY_SERIES.map((series, seriesIndex) => {
            const seriesPoints = points.map((point, idx) => ({ x: x(idx), y: y(point[series.key]) }));
            return (
              <path
                key={series.key}
                className="activity-line"
                d={smoothPath(seriesPoints)}
                fill="none"
                stroke={series.color}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: `activity-line-draw 760ms ease ${seriesIndex * 90}ms forwards` }}
              />
            );
          })}
          {points.map((point, idx) => {
            const showLabel = idx === 0 || idx === points.length - 1 || idx % tickStep === 0;
            return (
              <g key={point.label + idx}>
                {showLabel && <text x={x(idx)} y={height - 12} textAnchor="middle" fontSize="10" fill="var(--fg-muted)">{point.label}</text>}
                <rect
                  x={x(idx) - Math.max(6, plotWidth / Math.max(1, points.length) / 2)}
                  y={pad.top}
                  width={Math.max(12, plotWidth / Math.max(1, points.length))}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onFocus={() => setHoveredIndex(idx)}
                  onBlur={() => setHoveredIndex(null)}
                />
              </g>
            );
          })}
          {active && (
            <g>
              <line x1={x(active.index)} x2={x(active.index)} y1={pad.top} y2={height - pad.bottom} stroke="var(--fg-muted)" strokeOpacity="0.42" strokeDasharray="4 6" />
              {ACTIVITY_SERIES.map((series, seriesIndex) => (
                <circle
                  key={series.key}
                  className="activity-dot"
                  cx={x(active.index)}
                  cy={y(active.point[series.key])}
                  r="4"
                  fill={series.color}
                  stroke="var(--canvas-default)"
                  strokeWidth="2"
                  style={{ transformOrigin: `${x(active.index)}px ${y(active.point[series.key])}px`, animation: `activity-dot-rise 180ms ease ${seriesIndex * 25}ms both` }}
                />
              ))}
              <g transform={`translate(${tooltipX} ${tooltipY})`}>
                <rect width={tooltipWidth} height="128" rx="8" fill="var(--overlay-bgColor, var(--canvas-overlay))" stroke="var(--border-default)" />
                <text x="12" y="22" fontSize="12" fontWeight="700" fill="var(--fg-default)">{active.point.label}</text>
                {ACTIVITY_SERIES.map((series, idx) => (
                  <g key={series.key} transform={`translate(12 ${42 + idx * 20})`}>
                    <circle cx="4" cy="-4" r="4" fill={series.color} />
                    <text x="16" y="0" fontSize="11" fill="var(--fg-muted)">{series.label}</text>
                    <text x="160" y="0" textAnchor="end" fontSize="12" fontWeight="700" fill="var(--fg-default)">{fmtCount(active.point[series.key])}</text>
                  </g>
                ))}
                <line x1="12" x2="174" y1="106" y2="106" stroke="var(--border-muted)" />
                <text x="12" y="122" fontSize="10" fontWeight="700" fill="var(--fg-muted)">TOTAL</text>
                <text x="174" y="122" textAnchor="end" fontSize="12" fontWeight="700" fill="var(--fg-default)">{fmtCount(ACTIVITY_SERIES.reduce((sum, series) => sum + active.point[series.key], 0))}</text>
              </g>
            </g>
          )}
        </svg>
      </Box>
    </Box>
  );
}

function ActivityLegend({ color, label, total }: { color: string; label: string; total: number }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', px: 2, py: 1, fontSize: 0, minWidth: 0 }}>
      <Box sx={{ width: 9, height: 9, borderRadius: 99, bg: color, boxShadow: '0 0 0 3px color-mix(in srgb, currentColor 12%, transparent)' }} />
      <Text sx={{ color: 'fg.default', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</Text>
      <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontWeight: 700 }}>{fmtCount(total)}</Text>
    </Box>
  );
}


function PullRequestPipeline({ columns, durationLabel }: { columns: PipelineColumn[]; durationLabel: string }) {
  const active = columns
    .filter((column) => column.key === 'draft' || column.key === 'submitted')
    .reduce((sum, column) => sum + column.pulls.length, 0);
  const total = columns.reduce((sum, column) => sum + column.pulls.length, 0);
  const repos = Array.from(new Set(columns.flatMap((column) => column.pulls.map((pr) => pr.repo_full_name)))).sort();
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', minWidth: 0, overflow: 'hidden', boxShadow: 'shadow.small' }}>
      <Box sx={{ minHeight: 48, px: 3, py: 2, borderBottom: '1px solid', borderColor: 'border.default', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Heading sx={{ fontSize: 1, m: 0 }}>Pull Request Pipeline</Heading>
          <RangePill label={fmtCount(active) + ' active'} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <PipelineRepoList repos={repos} />
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{fmtCount(total)} tracked PRs · {durationLabel}</Text>
          <LinkPill href="/pulls">View all</LinkPill>
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'repeat(5, minmax(220px, 1fr))'], overflowX: ['visible', null, 'auto'] }}>
        {columns.map((column, index) => (
          <Box key={column.key} sx={{ p: 3, borderLeft: [0, null, index === 0 ? 0 : '1px solid'], borderTop: [index === 0 ? 0 : '1px solid', null, 0], borderColor: 'border.default', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: 99, bg: column.color, flexShrink: 0 }} />
                  <Text sx={{ fontWeight: 700, fontSize: 0 }}>{column.title} · {column.pulls.length}</Text>
                </Box>
                <Text sx={{ display: 'block', color: 'fg.muted', fontFamily: 'mono', fontSize: 0, mt: 1 }}>{column.caption}</Text>
              </Box>
            </Box>
            <Box sx={{ display: 'grid', gap: 2 }}>
              {column.pulls.slice(0, 3).map((pr) => <PipelinePullCard key={pr.id} pr={pr} color={column.color} stage={column.key} />)}
              {column.pulls.length === 0 && <PipelineEmpty label={pipelineEmptyLabel(column.key)} />}
              {column.pulls.length > 3 && (
                <Text sx={{ color: 'fg.muted', fontSize: 0, fontFamily: 'mono', textAlign: 'right' }}>+{column.pulls.length - 3} more</Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function PipelineRepoList({ repos }: { repos: string[] }) {
  if (repos.length === 0) return null;
  const visible = repos.slice(0, 3);
  return (
    <Box title={repos.join(', ')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
      {visible.map((repo) => (
        <Link key={repo} href={repoHref(repo)} prefetch={false} style={{ color: 'var(--fg-muted)', textDecoration: 'none', fontFamily: 'var(--fontStack-monospace, ui-monospace, SFMono-Regular, SFMono, Consolas, Liberation Mono, Menlo, monospace)', fontSize: 12, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Box as="span" sx={{ display: 'block', border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', px: 2, py: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ':hover': { borderColor: 'accent.muted', color: 'accent.fg', bg: 'accent.subtle' } }}>
            {repo}
          </Box>
        </Link>
      ))}
      {repos.length > 3 && (
        <Box as="span" sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', color: 'fg.muted', fontFamily: 'mono', fontSize: 0, px: 2, py: 1 }}>
          ..
        </Box>
      )}
    </Box>
  );
}

function roleForAssociation(association: string | null | undefined): 'maintainer' | 'contributor' {
  const role = (association ?? '').toUpperCase();
  if (role === 'OWNER' || role === 'MEMBER' || role === 'COLLABORATOR') return 'maintainer';
  return 'contributor';
}

function stageStatus(stage: PipelineColumn['key']): { label: string; bg: string; border: string; color: string } {
  if (stage === 'draft') return { label: 'draft', bg: 'neutral.subtle', border: 'border.default', color: 'fg.muted' };
  if (stage === 'submitted') return { label: 'open', bg: 'success.subtle', border: 'success.muted', color: 'success.fg' };
  if (stage === 'closed') return { label: 'closed', bg: 'danger.subtle', border: 'danger.muted', color: 'danger.fg' };
  return { label: 'merged', bg: 'success.subtle', border: 'success.muted', color: 'success.fg' };
}

function RoleBadge({ association }: { association: string | null | undefined }) {
  const role = roleForAssociation(association);
  const badge = role === 'maintainer'
    ? { bg: 'accent.subtle', border: 'accent.muted', color: 'accent.fg' }
    : { bg: 'neutral.subtle', border: 'border.default', color: 'fg.muted' };
  return (
    <Box as="span" sx={{ border: '1px solid', borderColor: badge.border, borderRadius: 2, bg: badge.bg, color: badge.color, fontSize: 0, fontWeight: 700, px: 1, py: '1px', lineHeight: '16px', whiteSpace: 'nowrap' }}>
      {role}
    </Box>
  );
}

function LineChanges({ additions, deletions }: { additions?: number | null; deletions?: number | null }) {
  const add = typeof additions === 'number' && Number.isFinite(additions) ? '+' + fmtCount(additions) : '+?';
  const del = typeof deletions === 'number' && Number.isFinite(deletions) ? '-' + fmtCount(deletions) : '-?';
  return (
    <Box as="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontFamily: 'mono', fontSize: 0, whiteSpace: 'nowrap' }}>
      <Text sx={{ color: 'success.fg' }}>{add}</Text>
      <Text sx={{ color: 'danger.fg' }}>{del}</Text>
    </Box>
  );
}

function PipelineStatusBadge({ stage }: { stage: PipelineColumn['key'] }) {
  const status = stageStatus(stage);
  return (
    <Box as="span" sx={{ border: '1px solid', borderColor: status.border, borderRadius: 2, bg: status.bg, color: status.color, fontSize: 0, fontWeight: 700, px: 1, py: '1px', lineHeight: '16px', whiteSpace: 'nowrap' }}>
      {status.label}
    </Box>
  );
}

function ScoreValue({ pr, color }: { pr: PullDto; color: string }) {
  if (!hasOfficialScore(pr)) return null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color, fontSize: 0, fontFamily: 'mono', whiteSpace: 'nowrap' }}>
      <Box sx={{ width: 6, height: 6, borderRadius: 99, bg: color }} />
      {fmtSignedNumber(pr.score ?? 0)}
    </Box>
  );
}

function pipelineEmptyLabel(stage: PipelineColumn['key']): string {
  if (stage === 'draft') return 'No draft PRs';
  if (stage === 'submitted') return 'No open PRs';
  if (stage === 'merged') return 'No merged PRs waiting for score';
  if (stage === 'closed') return 'No closed PRs';
  return 'No scored PRs';
}

function PipelinePullCard({ pr, color, stage }: { pr: PullDto; color: string; stage: PipelineColumn['key'] }) {
  const href = pr.html_url ?? 'https://github.com/' + pr.repo_full_name + '/pull/' + pr.number;
  const age = pipelineAge(pr, stage);
  const author = pr.author_login ?? 'unknown';
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', p: 2, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.repo_full_name}</Text>
        <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>{age}</Text>
      </Box>
      <Link href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 700, fontSize: 12, lineHeight: 1.35, display: 'block' }}>
        #{pr.number} {pr.title}
      </Link>
      <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Text sx={{ color: 'fg.muted', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{author}</Text>
          <RoleBadge association={pr.author_association} />
        </Box>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
          <LineChanges additions={pr.additions} deletions={pr.deletions} />
          <PipelineStatusBadge stage={stage} />
          {stage === 'scored' && <ScoreValue pr={pr} color={color} />}
        </Box>
      </Box>
    </Box>
  );
}

function PipelineEmpty({ label }: { label: string }) {
  return (
    <Box sx={{ border: '1px dashed', borderColor: 'border.default', borderRadius: 2, minHeight: 74, display: 'grid', placeItems: 'center', color: 'fg.muted', fontSize: 0, textAlign: 'center', px: 2 }}>
      {label}
    </Box>
  );
}

function activityTone(tone: RecentActivityItem['tone']): { bg: string; border: string; color: string } {
  if (tone === 'success') return { bg: 'success.subtle', border: 'success.muted', color: 'success.fg' };
  if (tone === 'attention') return { bg: 'attention.subtle', border: 'attention.muted', color: 'attention.fg' };
  if (tone === 'danger') return { bg: 'danger.subtle', border: 'danger.muted', color: 'danger.fg' };
  if (tone === 'done') return { bg: 'done.subtle', border: 'done.muted', color: 'done.fg' };
  return { bg: 'accent.subtle', border: 'accent.muted', color: 'accent.fg' };
}

function ActivityBadge({ item }: { item: RecentActivityItem }) {
  const tone = activityTone(item.tone);
  return (
    <Box as="span" sx={{ border: '1px solid', borderColor: tone.border, borderRadius: 2, bg: tone.bg, color: tone.color, fontSize: 0, fontWeight: 700, px: 2, py: '2px', lineHeight: '16px', whiteSpace: 'nowrap' }}>
      {item.badge}
    </Box>
  );
}

function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) return <Empty label="No recent activity" />;
  return (
    <Box sx={{ display: 'grid' }}>
      {items.map((item) => {
        const tone = activityTone(item.tone);
        return (
          <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: ['minmax(0, 1fr)', null, 'minmax(0, 1fr) auto'], gap: 2, alignItems: 'center', py: 2, borderBottom: '1px solid', borderColor: 'border.muted' }}>
            <Box sx={{ minWidth: 0, display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr)', columnGap: 2, rowGap: 1, alignItems: 'start' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: 99, bg: tone.color, mt: '7px' }} />
              <Box sx={{ minWidth: 0 }}>
                <Link href={item.href} target="_blank" rel="noreferrer" style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 700, lineHeight: 1.35 }}>
                  {item.title}
                </Link>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, minWidth: 0, flexWrap: 'wrap' }}>
                  <Text sx={{ color: 'accent.fg', fontSize: 0, fontFamily: 'mono', whiteSpace: 'nowrap' }}>{item.repo}</Text>
                  {item.actor && <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>by {item.actor}</Text>}
                  {item.meta && <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontSize: 0, whiteSpace: 'nowrap' }}>{item.meta}</Text>}
                </Box>
              </Box>
            </Box>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: ['space-between', null, 'flex-end'], gap: 2, minWidth: [0, null, 150] }}>
              <ActivityBadge item={item} />
              <Text sx={{ color: 'fg.muted', fontSize: 0, fontFamily: 'mono', whiteSpace: 'nowrap' }}>{relative(item.timestamp)}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function TopMiners({ miners }: { miners: Miner[] }) {
  if (miners.length === 0) return <Empty label="No miner feed" />;
  return (
    <Box as="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 1 }}>
      <Box as="thead" sx={{ color: 'fg.muted', fontSize: 0 }}>
        <Box as="tr">
          <Th>#</Th>
          <Th>Miner</Th>
          <Th align="right">Score</Th>
          <Th align="right">Delta</Th>
          <Th align="right">Earnings</Th>
        </Box>
      </Box>
      <Box as="tbody">
        {miners.map((miner, index) => {
          const score = num(miner.issueDiscoveryScore ?? miner.totalScore);
          const delta = num(miner.issueCredibility ?? miner.credibility);
          return (
            <Box as="tr" key={(miner.id ?? miner.uid ?? index) + String(miner.githubUsername ?? miner.githubId)} sx={{ borderTop: '1px solid', borderColor: 'border.muted' }}>
              <Td><Rank value={index + 1} /></Td>
              <Td>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                  <Avatar label={miner.githubUsername ?? miner.githubId ?? '?'} />
                  <Box sx={{ minWidth: 0 }}>
                    <Text sx={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{miner.githubUsername ?? miner.githubId ?? 'unknown'}</Text>
                    <Text sx={{ color: 'fg.muted', fontSize: 0 }}>UID {miner.uid ?? '-'}</Text>
                  </Box>
                </Box>
              </Td>
              <Td align="right"><Text sx={{ fontFamily: 'mono', fontWeight: 700 }}>{fmtNumber(score)}</Text></Td>
              <Td align="right"><Text sx={{ color: delta >= 0.7 ? 'success.fg' : 'attention.fg', fontFamily: 'mono' }}>{fmtPct(delta, true)}</Text></Td>
              <Td align="right"><Text sx={{ fontFamily: 'mono' }}>{fmtToken(num(miner.alphaPerDay))} TAO</Text></Td>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function RepositoryInsights({ rows }: { rows: RepoRow[] }) {
  if (rows.length === 0) return <Empty label="No active repositories" />;
  return (
    <Box as="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 1 }}>
      <Box as="thead" sx={{ color: 'fg.muted', fontSize: 0 }}>
        <Box as="tr">
          <Th>Repository</Th>
          <Th>Activity</Th>
          <Th align="right">Delta</Th>
          <Th align="right">Score</Th>
          <Th align="right">PRs 7d</Th>
        </Box>
      </Box>
      <Box as="tbody">
        {rows.map((row, index) => {
          const trend = num(row.stats?.trendingPct) / 100;
          return (
            <Box as="tr" key={row.repo.fullName} sx={{ borderTop: '1px solid', borderColor: 'border.muted' }}>
              <Td>
                <Link href={repoHref(row.repo)} prefetch={false} style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 600 }}>{row.repo.fullName}</Link>
              </Td>
              <Td><HealthBadge health={row.health} /></Td>
              <Td align="right"><Text sx={{ color: trend >= 0 ? 'success.fg' : 'danger.fg', fontFamily: 'mono' }}>{fmtPct(trend, true)}</Text></Td>
              <Td align="right"><Text sx={{ fontFamily: 'mono', fontWeight: 700 }}>{fmtNumber(row.stats?.totalScore ?? row.score)}</Text></Td>
              <Td align="right"><Text sx={{ fontFamily: 'mono', fontWeight: 700 }}>{row.stats?.prsThisWeek ?? 0}</Text></Td>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function ScoreBreakdown({ totals }: { totals: { pr: number; issue: number; recycle: number; treasury: number } }) {
  const parts = [
    { label: 'Code Contributions', value: totals.pr, color: 'var(--accent-fg)' },
    { label: 'Issue Discovery', value: totals.issue, color: 'var(--success-fg)' },
    { label: 'Treasury', value: totals.treasury, color: 'var(--attention-fg)' },
    { label: 'Recycle', value: totals.recycle, color: 'var(--fg-muted)' },
  ];
  const sum = Math.max(0.0001, parts.reduce((acc, part) => acc + Math.max(0, part.value), 0));
  let offset = 25;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '132px minmax(0, 1fr)', gap: 3, alignItems: 'center' }}>
      <Box sx={{ position: 'relative', width: 124, height: 124 }}>
        <svg viewBox="0 0 42 42" width="124" height="124" role="img" aria-label="Score breakdown">
          <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="var(--border-muted)" strokeWidth="5" />
          {parts.map((part) => {
            const len = (Math.max(0, part.value) / sum) * 100;
            const current = offset;
            offset -= len;
            return <circle key={part.label} cx="21" cy="21" r="15.915" fill="transparent" stroke={part.color} strokeWidth="5" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={String(current)} />;
          })}
        </svg>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <Box>
            <Text sx={{ display: 'block', fontFamily: 'mono', fontWeight: 700 }}>{fmtPct(totals.pr + totals.issue)}</Text>
            <Text sx={{ color: 'fg.muted', fontSize: 0 }}>OSS</Text>
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {parts.map((part) => (
          <Box key={part.label} sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 2, alignItems: 'center' }}>
            <Box sx={{ width: 8, height: 8, borderRadius: 99, bg: part.color }} />
            <Text sx={{ color: 'fg.default', fontSize: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{part.label}</Text>
            <Text sx={{ color: 'fg.default', fontFamily: 'mono', fontWeight: 700 }}>{fmtPct(part.value / sum)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Alerts({ rows }: { rows: AlertRow[] }) {
  if (rows.length === 0) return <Empty label="No alerts" />;
  return (
    <Box sx={{ display: 'grid' }}>
      {rows.map((row) => {
        const color = row.tone === 'danger' ? 'danger.fg' : row.tone === 'attention' ? 'attention.fg' : 'accent.fg';
        return (
          <Box key={row.title + row.detail} sx={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 2, alignItems: 'center', py: 2, borderTop: '1px solid', borderColor: 'border.muted' }}>
            <AlertIcon size={15} fill={`var(--${color.replace('.', '-')})`} />
            <Box sx={{ minWidth: 0 }}>
              <Text sx={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</Text>
              <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0 }}>{row.detail}</Text>
            </Box>
            <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>{row.age}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function FeaturedIssues({ rows }: { rows: FeaturedIssue[] }) {
  if (rows.length === 0) return <Empty label="No cached open issues" />;
  return (
    <Box sx={{ display: 'grid' }}>
      {rows.map((row) => (
        <Box key={row.issue.id} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 2, alignItems: 'center', py: 2, borderTop: '1px solid', borderColor: 'border.muted' }}>
          <Box sx={{ minWidth: 0 }}>
            <Link href={issueHref(row.issue)} target="_blank" rel="noreferrer" style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 600 }}>
              #{row.issue.number} {row.issue.title}
            </Link>
            <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.issue.repo_full_name}</Text>
          </Box>
          <Label variant={row.mode === 'discover' ? 'accent' : 'success'}>{row.mode === 'discover' ? 'Discovery' : 'Solve'}</Label>
          <Text sx={{ fontFamily: 'mono', fontWeight: 700 }}>{row.multiplier.toFixed(2)}x</Text>
        </Box>
      ))}
    </Box>
  );
}

function EligibilitySnapshot({ prReady, issueReady, total, solvedIssues }: { prReady: number; issueReady: number; total: number; solvedIssues: number }) {
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <MiniGate label="PR eligibility" ready={prReady} total={total} />
      <MiniGate label="Issue eligibility" ready={issueReady} total={total} accent />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 2 }}>
        <MiniBox label="Miners" value={fmtCount(total)} />
        <MiniBox label="Solved" value={fmtCount(solvedIssues)} />
        <MiniBox label="Ready" value={fmtPct(total > 0 ? (prReady + issueReady) / (total * 2) : 0)} />
      </Box>
    </Box>
  );
}

function MiniGate({ label, ready, total, accent = false }: { label: string; ready: number; total: number; accent?: boolean }) {
  const pct = total > 0 ? ready / total : 0;
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Text sx={{ fontWeight: 600 }}>{label}</Text>
        <Text sx={{ color: 'fg.muted', fontFamily: 'mono' }}>{ready}/{total}</Text>
      </Box>
      <Box sx={{ height: 9, borderRadius: 2, overflow: 'hidden', bg: 'canvas.subtle' }}>
        <Box sx={{ width: (pct * 100).toFixed(1) + '%', height: '100%', bg: accent ? 'accent.emphasis' : 'success.emphasis' }} />
      </Box>
    </Box>
  );
}

function MiniBox({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ bg: 'canvas.subtle', borderRadius: 2, p: 2, textAlign: 'center', minWidth: 0 }}>
      <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0 }}>{label}</Text>
      <Text sx={{ display: 'block', fontFamily: 'mono', fontWeight: 700 }}>{value}</Text>
    </Box>
  );
}

function Avatar({ label }: { label: string }) {
  return (
    <Box sx={{ width: 30, height: 30, borderRadius: 99, bg: 'canvas.subtle', border: '1px solid', borderColor: 'border.default', display: 'grid', placeItems: 'center', color: 'fg.muted', fontSize: 0, fontWeight: 700, flexShrink: 0 }}>
      {label.slice(0, 1).toUpperCase()}
    </Box>
  );
}

function Rank({ value }: { value: number }) {
  const medal = value <= 3;
  return (
    <Box sx={{ width: 22, height: 22, borderRadius: 99, bg: medal ? 'attention.subtle' : 'canvas.subtle', color: medal ? 'attention.fg' : 'fg.muted', display: 'grid', placeItems: 'center', fontSize: 0, fontWeight: 700 }}>
      {value}
    </Box>
  );
}

function HealthBadge({ health }: { health: RepoRow['health'] }) {
  const variant = health === 'healthy' ? 'success' : health === 'watch' ? 'attention' : undefined;
  const label = health === 'healthy' ? 'Active' : health === 'watch' ? 'Watch' : 'Quiet';
  return <Label variant={variant}>{label}</Label>;
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <Box as="th" sx={{ py: 2, pr: 2, textAlign: align, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</Box>;
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <Box as="td" sx={{ py: 2, pr: 2, textAlign: align, verticalAlign: 'middle', minWidth: 0 }}>{children}</Box>;
}

function Empty({ label }: { label: string }) {
  return (
    <Box sx={{ p: 3, color: 'fg.muted', display: 'flex', alignItems: 'center', gap: 2 }}>
      <AlertIcon size={16} />
      <Text>{label}</Text>
    </Box>
  );
}
