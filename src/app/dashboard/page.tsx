'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Heading, PageLayout, Spinner, Text } from '@primer/react';
import {
  AlertIcon,
  CheckIcon,
  CheckCircleIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  GraphIcon,
  IssueOpenedIcon,
  KebabHorizontalIcon,
  PeopleIcon,
  RepoIcon,
  ZapIcon,
} from '@primer/octicons-react';
import type { IssueDto, PullDto } from '@/lib/api-types';
import type { RepoEntry } from '@/lib/repos';
import { formatRelativeTime } from '@/lib/format';
import SearchInput from '@/components/SearchInput';

const OSS_SHARE = 0.9;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PR_LOOKBACK_DAYS = 30;
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

type DurationKey = '24h' | '7d' | '30d';

const DURATION_OPTIONS: Array<{ key: DurationKey; label: string; ms: number; buckets: number }> = [
  { key: '24h', label: '24H', ms: DAY_MS, buckets: 24 },
  { key: '7d', label: '7D', ms: 7 * DAY_MS, buckets: 7 },
  { key: '30d', label: '30D', ms: 30 * DAY_MS, buckets: 30 },
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

type ActivityKey = 'mergedPrs' | 'closedPrs' | 'resolvedIssues' | 'openedPrs' | 'openedIssues';

interface DayPoint {
  label: string;
  mergedPrs: number;
  closedPrs: number;
  resolvedIssues: number;
  openedPrs: number;
  openedIssues: number;
}

// Chart palette — curated dashboard colors (Tailwind-500 family) that read
// distinctly against both light and dark canvases when used at 18-70% opacity
// in stacked bands. Order = legend display order (lifecycle-grouped: opens
// then completions then closes).
const ACTIVITY_SERIES: Array<{ key: ActivityKey; label: string; color: string }> = [
  { key: 'openedPrs',      label: 'PRs Opened',      color: '#3b82f6' }, // blue-500
  { key: 'mergedPrs',      label: 'PRs Merged',      color: '#10b981' }, // emerald-500
  { key: 'closedPrs',      label: 'PRs Closed',      color: '#ef4444' }, // red-500
  { key: 'openedIssues',   label: 'Issues Opened',   color: '#8b5cf6' }, // violet-500
  { key: 'resolvedIssues', label: 'Issues Resolved', color: '#f59e0b' }, // amber-500
];

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

interface IssuePipelineColumn {
  key: 'opened' | 'closed' | 'completed' | 'scored';
  title: string;
  caption: string;
  color: string;
  issues: IssueDto[];
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
  if (key === '30d') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

function rewardParts(repo: RepoEntry): { pr: number; issue: number } {
  const total = repo.emissionShare * OSS_SHARE;
  const maintainer = total * Math.min(1, Math.max(0, repo.maintainerCut));
  const afterMaintainer = Math.max(0, total - maintainer);
  const issue = afterMaintainer * repo.issueDiscoveryShare;
  return { pr: afterMaintainer - issue, issue };
}

function issueBoost(issue: IssueDto, repo: RepoEntry): number {
  const labels = new Set(issue.labels.map((label) => label.name.toLowerCase()));
  let best = repo.defaultLabelMultiplier || 1;
  for (const [label, multiplier] of Object.entries(repo.labelMultipliers)) {
    if (labels.has(label.toLowerCase())) best = Math.max(best, multiplier);
  }
  return best;
}

function repoLookbackDays(repo: RepoEntry | undefined | null): number {
  const days = num(repo?.scoring?.prLookbackDays);
  return days > 0 ? days : DEFAULT_PR_LOOKBACK_DAYS;
}

function repoWindowMs(durationKey: DurationKey, durationMs: number, repo: RepoEntry | undefined | null): number {
  return durationKey === '30d' ? repoLookbackDays(repo) * DAY_MS : durationMs;
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

function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

function isMaintainerAssociation(association: string | null | undefined): boolean {
  return MAINTAINER_ASSOCIATIONS.has((association ?? '').toUpperCase());
}

function linkedPull(issue: IssueDto, pullByKey: Map<string, PullDto>, number: number): PullDto | undefined {
  return pullByKey.get(pullKey(issue.repo_full_name, number));
}

function linkedPullMerged(issue: IssueDto, pullByKey: Map<string, PullDto>, pr: NonNullable<IssueDto['linked_prs']>[number]): boolean {
  const official = linkedPull(issue, pullByKey, pr.number);
  return Boolean(official?.merged || official?.merged_at || pr.merged || pr.merged_at);
}

function linkedPullClosedUnmerged(issue: IssueDto, pullByKey: Map<string, PullDto>, pr: NonNullable<IssueDto['linked_prs']>[number]): boolean {
  const official = linkedPull(issue, pullByKey, pr.number);
  const merged = linkedPullMerged(issue, pullByKey, pr);
  const state = lower(official?.state ?? pr.state);
  return !merged && state === 'closed';
}

function linkedPullScored(issue: IssueDto, pullByKey: Map<string, PullDto>, pr: NonNullable<IssueDto['linked_prs']>[number]): boolean {
  const official = linkedPull(issue, pullByKey, pr.number);
  return official ? hasOfficialScore(official) : false;
}

function linkedPullSameAuthor(issue: IssueDto, pullByKey: Map<string, PullDto>, pr: NonNullable<IssueDto['linked_prs']>[number]): boolean {
  const issueAuthor = lower(issue.author_login);
  if (!issueAuthor) return false;
  const official = linkedPull(issue, pullByKey, pr.number);
  return lower(official?.author_login ?? pr.author_login) === issueAuthor;
}

function issueDiscoveryEnabled(issue: IssueDto, repoByName: Map<string, RepoEntry>): boolean {
  const repo = repoByName.get(issue.repo_full_name.toLowerCase());
  return Boolean(repo && !repo.inactiveAt && repo.issueDiscoveryShare > 0);
}

function issuePipelineKey(issue: IssueDto, pullByKey: Map<string, PullDto>, repoByName: Map<string, RepoEntry>): IssuePipelineColumn['key'] {
  if (lower(issue.state) === 'open') return 'opened';
  const linkedPrs = issue.linked_prs ?? [];
  if (lower(issue.state_reason) === 'not_planned') return 'closed';
  if (lower(issue.state_reason) === 'completed') {
    const rewardableLinkedPrs = issueDiscoveryEnabled(issue, repoByName) && !isMaintainerAssociation(issue.author_association)
      ? linkedPrs.filter((pr) => !linkedPullSameAuthor(issue, pullByKey, pr))
      : [];
    if (rewardableLinkedPrs.some((pr) => linkedPullScored(issue, pullByKey, pr))) return 'scored';
    if (rewardableLinkedPrs.some((pr) => linkedPullMerged(issue, pullByKey, pr))) return 'completed';
    if (linkedPrs.some((pr) => linkedPullClosedUnmerged(issue, pullByKey, pr))) return 'closed';
    return 'closed';
  }
  return 'closed';
}

function issuePipelineTimestamp(issue: IssueDto, stage: IssuePipelineColumn['key']): number {
  const raw = stage === 'opened'
    ? issue.created_at ?? issue.updated_at ?? issue.closed_at
    : issue.closed_at ?? issue.updated_at ?? issue.created_at;
  return parseTime(raw);
}

function issuePipelineAge(issue: IssueDto, stage: IssuePipelineColumn['key']): string {
  const raw = stage === 'opened'
    ? issue.created_at ?? issue.updated_at ?? issue.closed_at
    : issue.closed_at ?? issue.updated_at ?? issue.created_at;
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
    return { label: durationLabel(date, duration.key), mergedPrs: 0, closedPrs: 0, resolvedIssues: 0, openedPrs: 0, openedIssues: 0 };
  });

  for (const pr of pulls) {
    addActivity(points, start, now, bucketMs, pr.created_at ? Date.parse(pr.created_at) : Number.NaN, 'openedPrs');
    addActivity(points, start, now, bucketMs, pr.merged_at ? Date.parse(pr.merged_at) : Number.NaN, 'mergedPrs');
    // Closed-without-merge: closed_at exists but never merged. Distinct
    // signal from mergedPrs — track separately as a "rejection" series.
    if (pr.closed_at && !pr.merged_at && !pr.merged) {
      addActivity(points, start, now, bucketMs, Date.parse(pr.closed_at), 'closedPrs');
    }
  }

  for (const issue of issues) {
    if (!activeRepoSet.has(issue.repo_full_name.toLowerCase())) continue;
    addActivity(points, start, now, bucketMs, issue.created_at ? Date.parse(issue.created_at) : Number.NaN, 'openedIssues');
    if (lower(issue.state_reason) === 'completed') {
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

function buildIssuePipeline(issues: IssueDto[], activeRepoSet: Set<string>, pullByKey: Map<string, PullDto>, repoByName: Map<string, RepoEntry>): IssuePipelineColumn[] {
  const columns: IssuePipelineColumn[] = [
    { key: 'opened', title: 'Opened', caption: 'open issues', color: 'var(--success-fg)', issues: [] },
    { key: 'closed', title: 'Closed', caption: 'closed / not planned', color: 'var(--danger-fg)', issues: [] },
    { key: 'completed', title: 'Completed', caption: 'pending Gittensor validation', color: 'var(--accent-fg)', issues: [] },
    { key: 'scored', title: 'Scored', caption: 'official score', color: 'var(--done-fg)', issues: [] },
  ];
  const byKey = new Map(columns.map((column) => [column.key, column]));
  for (const issue of issues) {
    if (!activeRepoSet.has(issue.repo_full_name.toLowerCase())) continue;
    const key = issuePipelineKey(issue, pullByKey, repoByName);
    byKey.get(key)?.issues.push(issue);
  }
  for (const column of columns) {
    column.issues.sort((a, b) => issuePipelineTimestamp(b, column.key) - issuePipelineTimestamp(a, column.key));
  }
  return columns;
}

function sourceReady(source: string | undefined): boolean {
  return source === 'live' || source === 'cache' || source === 'github';
}

function toggleSelectedRepo(selected: string[], repo: string): string[] {
  const key = repo.toLowerCase();
  if (selected.some((item) => item.toLowerCase() === key)) {
    return selected.filter((item) => item.toLowerCase() !== key);
  }
  return [...selected, repo];
}

function cleanSelectedRepos(selected: string[], validRepoSet: Set<string>): string[] {
  const next = selected.filter((repo) => validRepoSet.has(repo.toLowerCase()));
  return next.length === selected.length ? selected : next;
}

function uniqueRepoNames(repos: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const repo of repos) {
    const key = repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(repo);
  }
  return result;
}

export default function DashboardPage() {
  const [durationKey, setDurationKey] = useState<DurationKey>('7d');
  const [prPipelineRepoFilters, setPrPipelineRepoFilters] = useState<string[]>([]);
  const [issuePipelineRepoFilters, setIssuePipelineRepoFilters] = useState<string[]>([]);
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

  const repos = reposQuery.data?.repos ?? [];
  const activeRepos = useMemo(() => repos.filter((repo) => !repo.inactiveAt && repo.emissionShare > 0), [repos]);
  const activeRepoNames = useMemo(() => activeRepos.map((repo) => repo.fullName).sort(), [activeRepos]);
  const activeRepoSet = useMemo(() => new Set(activeRepoNames.map((repo) => repo.toLowerCase())), [activeRepoNames]);
  const fetchWindowMs = useMemo(() => {
    if (durationKey !== '30d') return duration.ms;
    const maxRepoLookbackMs = activeRepos.reduce((max, repo) => Math.max(max, repoLookbackDays(repo) * DAY_MS), duration.ms);
    return maxRepoLookbackMs;
  }, [activeRepos, duration.ms, durationKey]);

  useEffect(() => {
    setPrPipelineRepoFilters((prev) => cleanSelectedRepos(prev, activeRepoSet));
    setIssuePipelineRepoFilters((prev) => cleanSelectedRepos(prev, activeRepoSet));
  }, [activeRepoSet]);

  const issuesQuery = useQuery<IssuesResp>({
    queryKey: ['dashboard-issues', activeRepoNames, fetchWindowMs],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        repos: activeRepoNames.join(','),
        activity_since: new Date(Date.now() - fetchWindowMs).toISOString(),
      });
      const response = await fetch('/api/issues?' + params.toString(), { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },
    enabled: activeRepoNames.length > 0,
    refetchInterval: 30_000,
  });

  const pullsQuery = useQuery<PullsResp>({
    queryKey: ['dashboard-pulls', activeRepoNames, fetchWindowMs],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ repos: activeRepoNames.join(','), since: String(Date.now() - fetchWindowMs) });
      const response = await fetch('/api/pulls?' + params.toString(), { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },
    enabled: activeRepoNames.length > 0,
    refetchInterval: 30_000,
  });
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

  const pipelinePullByKey = useMemo(() => {
    const map = new Map<string, PullDto>();
    for (const pr of pipelinePulls) map.set(pullKey(pr.repo_full_name, pr.number), pr);
    return map;
  }, [pipelinePulls]);

  const rangePulls = useMemo(() => {
    const now = Date.now();
    return pipelinePulls.filter((pr) => {
      const repo = repoByName.get(pr.repo_full_name.toLowerCase());
      return pullTimestamp(pr) >= now - repoWindowMs(durationKey, duration.ms, repo);
    });
  }, [duration.ms, durationKey, pipelinePulls, repoByName]);
  const scoredRangePulls = useMemo(() => {
    return rangePulls
      .filter(hasOfficialScore)
      .sort((a, b) => num(b.score) - num(a.score) || pullTimestamp(b) - pullTimestamp(a));
  }, [rangePulls]);
  const gtRepoByName = useMemo(() => {
    const map = new Map<string, GtRepo>();
    for (const repo of gtRepos) map.set(repo.fullName.toLowerCase(), repo);
    return map;
  }, [gtRepos]);
  const trendingRepos = useMemo(() => {
    const now = Date.now();
    const byRepo = new Map<string, { current: number; previous: number; score: number }>();
    const ensure = (repo: string) => {
      const key = repo.toLowerCase();
      let row = byRepo.get(key);
      if (!row) {
        row = { current: 0, previous: 0, score: 0 };
        byRepo.set(key, row);
      }
      return row;
    };

    for (const pr of pipelinePulls) {
      const key = pr.repo_full_name.toLowerCase();
      if (!activeRepoSet.has(key)) continue;
      const repo = repoByName.get(key);
      const windowMs = repoWindowMs(durationKey, duration.ms, repo);
      const start = now - windowMs;
      const previousStart = start - windowMs;
      const t = pullTimestamp(pr);
      if (t >= start && t <= now) {
        const row = ensure(key);
        row.current += 1;
        if (hasOfficialScore(pr)) row.score += Math.max(0, num(pr.score));
      } else if (t >= previousStart && t < start) {
        ensure(key).previous += 1;
      }
    }

    return activeRepos
      .map((repo) => {
        const stats = gtRepoByName.get(repo.fullName.toLowerCase());
        const range = byRepo.get(repo.fullName.toLowerCase());
        const prs = range?.current ?? 0;
        const previous = range?.previous ?? 0;
        const trend = previous > 0 ? ((prs - previous) / previous) * 100 : prs > 0 ? prs * 100 : 0;
        return {
          repo,
          stats,
          trend,
          prs,
          score: range?.score ?? 0,
        };
      })
      .filter((row) => row.prs > 0 || row.score > 0)
      .sort((a, b) => b.trend - a.trend || b.prs - a.prs || b.score - a.score || a.repo.fullName.localeCompare(b.repo.fullName))
      .slice(0, 3);
  }, [activeRepos, activeRepoSet, duration.ms, durationKey, gtRepoByName, pipelinePulls, repoByName]);
  const bestWorkAuthors = useMemo(() => {
    const repoScoreTotals = new Map<string, number>();
    for (const pr of scoredRangePulls) {
      const score = num(pr.score);
      if (score <= 0) continue;
      const repoKey = pr.repo_full_name.toLowerCase();
      repoScoreTotals.set(repoKey, (repoScoreTotals.get(repoKey) ?? 0) + score);
    }

    const map = new Map<string, { author: string; reward: number; rawScore: number; prs: number; topPull: PullDto; repoRewards: Map<string, { repo: string; reward: number; rawScore: number; prs: number; pool: number }> }>();
    for (const pr of scoredRangePulls) {
      const rawScore = num(pr.score);
      if (rawScore <= 0) continue;
      const repoKey = pr.repo_full_name.toLowerCase();
      const repo = repoByName.get(repoKey);
      const repoTotalScore = repoScoreTotals.get(repoKey) ?? 0;
      const repoRewardPool = repo ? rewardParts(repo).pr : 0;
      if (!repo || repoTotalScore <= 0 || repoRewardPool <= 0) continue;

      const reward = repoRewardPool * (rawScore / repoTotalScore);
      if (reward <= 0) continue;

      const author = pr.author_login ?? 'unknown';
      const key = author.toLowerCase();
      const current = map.get(key) ?? { author, reward: 0, rawScore: 0, prs: 0, topPull: pr, repoRewards: new Map<string, { repo: string; reward: number; rawScore: number; prs: number; pool: number }>() };
      current.reward += reward;
      current.rawScore += rawScore;
      current.prs += 1;
      const repoReward = current.repoRewards.get(repoKey) ?? { repo: pr.repo_full_name, reward: 0, rawScore: 0, prs: 0, pool: repoRewardPool };
      repoReward.reward += reward;
      repoReward.rawScore += rawScore;
      repoReward.prs += 1;
      current.repoRewards.set(repoKey, repoReward);
      if (rawScore > num(current.topPull.score) || (rawScore === num(current.topPull.score) && pullTimestamp(pr) > pullTimestamp(current.topPull))) {
        current.topPull = pr;
      }
      map.set(key, current);
    }
    return Array.from(map.values())
      .map((row) => {
        const repoSegments = Array.from(row.repoRewards.values())
          .filter((segment) => segment.reward > 0)
          .sort((a, b) => b.reward - a.reward || b.rawScore - a.rawScore || b.prs - a.prs || a.repo.localeCompare(b.repo));
        return { ...row, repoCount: repoSegments.length, repoSegments };
      })
      .filter((row) => row.reward > 0 && row.repoSegments.length > 0)
      .sort((a, b) => b.reward - a.reward || b.rawScore - a.rawScore || b.prs - a.prs)
      .slice(0, 3);
  }, [repoByName, scoredRangePulls]);
  const prPipelineRepos = useMemo(() => Array.from(new Set(rangePulls.map((pr) => pr.repo_full_name))).sort(), [rangePulls]);
  const prPipelineRepoFilterSet = useMemo(() => new Set(prPipelineRepoFilters.map((repo) => repo.toLowerCase())), [prPipelineRepoFilters]);
  const filteredRangePulls = useMemo(() => {
    if (prPipelineRepoFilterSet.size === 0) return rangePulls;
    return rangePulls.filter((pr) => prPipelineRepoFilterSet.has(pr.repo_full_name.toLowerCase()));
  }, [prPipelineRepoFilterSet, rangePulls]);
  const prPipeline = useMemo(() => buildPullPipeline(filteredRangePulls), [filteredRangePulls]);
  const rangeIssues = useMemo(() => {
    const now = Date.now();
    return issues.filter((issue) => {
      const repo = repoByName.get(issue.repo_full_name.toLowerCase());
      const stage = issuePipelineKey(issue, pipelinePullByKey, repoByName);
      return issuePipelineTimestamp(issue, stage) >= now - repoWindowMs(durationKey, duration.ms, repo);
    });
  }, [duration.ms, durationKey, issues, pipelinePullByKey, repoByName]);
  const issuePipelineRepos = useMemo(() => Array.from(new Set(rangeIssues.map((issue) => issue.repo_full_name))).sort(), [rangeIssues]);
  const issuePipelineRepoFilterSet = useMemo(() => new Set(issuePipelineRepoFilters.map((repo) => repo.toLowerCase())), [issuePipelineRepoFilters]);
  const filteredRangeIssues = useMemo(() => {
    if (issuePipelineRepoFilterSet.size === 0) return rangeIssues;
    return rangeIssues.filter((issue) => issuePipelineRepoFilterSet.has(issue.repo_full_name.toLowerCase()));
  }, [issuePipelineRepoFilterSet, rangeIssues]);
  const issuePipeline = useMemo(() => buildIssuePipeline(filteredRangeIssues, activeRepoSet, pipelinePullByKey, repoByName), [activeRepoSet, pipelinePullByKey, filteredRangeIssues, repoByName]);

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
        tone: merged ? 'accent' : closed ? 'danger' : 'success',
        badge: merged ? (hasOfficialScore(pr) ? 'PR Scored' : 'PR merged') : closed ? 'PR closed' : 'PR opened',
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
      const isOpen = lower(issue.state) === 'open';
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

      const completed = lower(issue.state_reason) === 'completed';
      const closed = lower(issue.state) !== 'open';
      addItem({
        id: 'issue:' + issue.repo_full_name + '#' + issue.number,
        kind: 'issue',
        tone: completed ? 'accent' : closed ? 'danger' : 'success',
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
      if (selected.length >= 5) break;
      if (seen.has(item.id)) continue;
      selected.push(item);
      seen.add(item.id);
    }
    return selected.sort((a, b) => b.timestamp - a.timestamp);
  }, [activeRepoSet, issues, pipelinePulls, repoByName]);

  const scoredPrCount = scoredRangePulls.length;
  const openPrCount = rangePulls.filter((pr) => pr.state?.toLowerCase() === 'open' && !pr.merged_at).length;
  const mergedPrCount = rangePulls.filter((pr) => Boolean(pr.merged_at)).length;
  const awaitingScore = rangePulls.filter((pr) => Boolean(pr.merged_at) && !hasOfficialScore(pr)).length;
  const issueStageCounts = useMemo(() => {
    const counts: Record<IssuePipelineColumn['key'], number> = { opened: 0, closed: 0, completed: 0, scored: 0 };
    for (const issue of rangeIssues) {
      if (!activeRepoSet.has(issue.repo_full_name.toLowerCase())) continue;
      counts[issuePipelineKey(issue, pipelinePullByKey, repoByName)] += 1;
    }
    return counts;
  }, [activeRepoSet, pipelinePullByKey, rangeIssues, repoByName]);
  const rangeStats = useMemo(() => {
    const repoSet = new Set<string>();
    const actorSet = new Set<string>();
    let prScore = 0;

    for (const pr of rangePulls) {
      repoSet.add(pr.repo_full_name.toLowerCase());
      if (pr.author_login) actorSet.add(pr.author_login.toLowerCase());
    }
    for (const issue of rangeIssues) {
      repoSet.add(issue.repo_full_name.toLowerCase());
      if (issue.author_login) actorSet.add(issue.author_login.toLowerCase());
    }
    for (const pr of scoredRangePulls) prScore += Math.max(0, num(pr.score));

    const topPrScore = scoredRangePulls.length > 0 ? Math.max(0, num(scoredRangePulls[0].score)) : 0;
    return {
      workItems: rangePulls.length + rangeIssues.length,
      repos: repoSet.size,
      actors: actorSet.size,
      prScore,
      avgPrScore: scoredRangePulls.length > 0 ? prScore / scoredRangePulls.length : 0,
      topPrScore,
    };
  }, [rangeIssues, rangePulls, scoredRangePulls]);
  const resolvedIssueCount = issueStageCounts.completed + issueStageCounts.scored;
  const openWorkCount = openPrCount + issueStageCounts.opened;
  const isLoading = reposQuery.isLoading || gtReposQuery.isLoading || minersQuery.isLoading || issuesQuery.isLoading;

  const activity = useMemo<DayPoint[]>(() => buildActivityPoints(pipelinePulls, issues, activeRepoSet, duration), [activeRepoSet, duration, issues, pipelinePulls]);

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
      <PageLayout.Header sx={{ mb: -1 }}>
        <Box sx={{ maxWidth: 1480, mx: 'auto', width: '100%' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: ['1fr', null, 'minmax(280px, 1fr) auto'],
              alignItems: 'center',
              gap: [3, null, 4],
              minWidth: 0,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                <Heading sx={{ m: 0, fontSize: 4, lineHeight: 1.05 }}>Dashboard</Heading>
                <Box as="span" sx={{ px: 2, py: '2px', border: '1px solid', borderColor: 'border.default', borderRadius: 999, color: 'fg.muted', bg: 'canvas.subtle', fontFamily: 'mono', fontSize: 0, fontWeight: 700 }}>
                  SN74
                </Box>
              </Box>
              <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 1, mt: 1, whiteSpace: ['normal', null, 'nowrap'], overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Operator overview for miners, repositories, and validation flow
              </Text>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: ['flex-start', null, 'flex-end'], minWidth: 0 }}>
              <Source label="Repos" ok={reposQuery.data?.source === 'live'} detail={relative(reposQuery.data?.fetched_at)} />
              <Source label="Issues/PRs" ok={sourceReady(gtReposQuery.data?.source)} detail={relative(gtReposQuery.data?.fetched_at)} />
              <Source label="Scores" ok={sourceReady(minersQuery.data?.source)} detail={relative(minersQuery.data?.fetched_at)} />
            </Box>
          </Box>
        </Box>
      </PageLayout.Header>

      <PageLayout.Content>
        <Box sx={{ maxWidth: 1480, mx: 'auto', width: '100%', display: 'grid', gap: 3, position: 'relative' }}>
          <Box sx={{ position: 'sticky', top: ['calc(var(--header-height) + 8px)', null, null, null, '72px'], zIndex: 160, display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none', mt: [2, null, 0], mb: -1 }}>
            <Box sx={{ pointerEvents: 'auto', borderRadius: 2, boxShadow: 'shadow.medium', bg: 'canvas.default' }}>
              <DurationPicker value={durationKey} onChange={setDurationKey} />
            </Box>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', 'repeat(2, minmax(0, 1fr))', null, 'repeat(5, minmax(0, 1fr))'], gap: 3 }}>
            <StatCard
              tone="blue"
              icon={<GraphIcon size={21} />}
              label={`Active Network · ${duration.label}`}
              value={fmtCount(rangeStats.workItems)}
              metrics={[
                { label: 'PRs', value: fmtCount(rangePulls.length), tone: rangePulls.length > 0 ? 'accent' : 'muted' },
                { label: 'Issues', value: fmtCount(rangeIssues.length), tone: rangeIssues.length > 0 ? 'attention' : 'muted' },
              ]}
            />
            <StatCard
              tone="green"
              icon={<GitMergeIcon size={21} />}
              label="OSS Contributions"
              value={fmtCount(scoredPrCount)}
              metrics={[
                { label: 'Merged', value: fmtCount(mergedPrCount), tone: mergedPrCount > 0 ? 'success' : 'muted' },
                { label: 'Awaiting score', value: fmtCount(awaitingScore), tone: awaitingScore > 0 ? 'attention' : 'success' },
              ]}
            />
            <StatCard
              tone="purple"
              icon={<CheckCircleIcon size={21} />}
              label="Discoveries"
              value={fmtCount(resolvedIssueCount)}
              metrics={[
                { label: 'Scored', value: fmtCount(issueStageCounts.scored), tone: issueStageCounts.scored > 0 ? 'accent' : 'muted' },
                { label: 'Awaiting score', value: fmtCount(issueStageCounts.completed), tone: issueStageCounts.completed > 0 ? 'attention' : 'success' },
              ]}
            />
            <StatCard
              tone="amber"
              icon={<ZapIcon size={21} />}
              label="OSS Score"
              value={fmtNumber(rangeStats.prScore)}
              metrics={[
                { label: 'Avg score', value: fmtNumber(rangeStats.avgPrScore), tone: rangeStats.avgPrScore > 0 ? 'success' : 'muted' },
                { label: 'Top score', value: fmtNumber(rangeStats.topPrScore), tone: rangeStats.topPrScore > 0 ? 'accent' : 'muted' },
              ]}
            />
            <StatCard
              tone="red"
              icon={<PeopleIcon size={21} />}
              label="Active Contributors"
              value={fmtCount(rangeStats.actors)}
              metrics={[
                { label: 'Repos', value: fmtCount(rangeStats.repos), tone: rangeStats.repos > 0 ? 'accent' : 'muted' },
                { label: 'Open queue', value: fmtCount(openWorkCount), tone: openWorkCount > 0 ? 'attention' : 'success' },
              ]}
            />
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'minmax(0, 1.05fr) minmax(420px, 0.95fr)'], gap: 3, alignItems: 'stretch' }}>
            <Panel title="Activity Over Time" action={<RangePill label={duration.label} />}>
              <LineChart points={activity} />
            </Panel>
            <Panel title="Recent Activity" action={<LinkPill href="/opportunities">View all</LinkPill>}>
              <RecentActivity items={recentActivity} />
            </Panel>
          </Box>

          <BestWorkShowcase
            pulls={scoredRangePulls.slice(0, 7)}
            totalScored={scoredRangePulls.length}
            trendingRepos={trendingRepos}
            authorLeaders={bestWorkAuthors}
            durationLabel={duration.label}
          />

          <PullRequestPipeline
            columns={prPipeline}
            durationLabel={duration.label}
            repos={prPipelineRepos}
            selectedRepos={prPipelineRepoFilters}
            onRepoToggle={(repo) => setPrPipelineRepoFilters((prev) => toggleSelectedRepo(prev, repo))}
            onRepoClear={() => setPrPipelineRepoFilters([])}
          />

          <IssuePipeline
            columns={issuePipeline}
            durationLabel={duration.label}
            repos={issuePipelineRepos}
            selectedRepos={issuePipelineRepoFilters}
            onRepoToggle={(repo) => setIssuePipelineRepoFilters((prev) => toggleSelectedRepo(prev, repo))}
            onRepoClear={() => setIssuePipelineRepoFilters([])}
            pullByKey={pipelinePullByKey}
          />

        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}


function Source({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        minHeight: 28,
        px: 2,
        py: '3px',
        border: '1px solid',
        borderColor: ok ? 'success.muted' : 'attention.muted',
        borderRadius: 999,
        bg: 'canvas.subtle',
        color: ok ? 'success.fg' : 'attention.fg',
        fontSize: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {ok ? <CheckCircleIcon size={13} /> : <AlertIcon size={13} />}
      <Text sx={{ fontWeight: 700 }}>{label}</Text>
      <Text sx={{ color: 'fg.muted' }}>{detail}</Text>
    </Box>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', minWidth: 0, overflow: 'visible', boxShadow: 'shadow.small' }}>
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

type StatTone = 'blue' | 'green' | 'purple' | 'amber' | 'red';
type StatMetricTone = 'accent' | 'success' | 'attention' | 'danger' | 'muted';

interface StatMetric {
  label: string;
  value: string;
  tone?: StatMetricTone;
}

function statColor(tone: StatTone) {
  if (tone === 'green') return { bg: 'success.subtle', fg: 'success.fg' };
  if (tone === 'purple') return { bg: 'done.subtle', fg: 'done.fg' };
  if (tone === 'amber') return { bg: 'attention.subtle', fg: 'attention.fg' };
  if (tone === 'red') return { bg: 'danger.subtle', fg: 'danger.fg' };
  return { bg: 'accent.subtle', fg: 'accent.fg' };
}

function statMetricColor(tone: StatMetricTone = 'muted'): string {
  if (tone === 'success') return 'success.fg';
  if (tone === 'attention') return 'attention.fg';
  if (tone === 'danger') return 'danger.fg';
  if (tone === 'accent') return 'accent.fg';
  return 'fg.muted';
}

function StatCard({ tone, icon, label, value, suffix, metrics }: { tone: StatTone; icon: React.ReactNode; label: string; value: string; suffix?: string; metrics: StatMetric[] }) {
  const color = statColor(tone);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', boxShadow: 'shadow.small', p: 3, minWidth: 0, transition: 'border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease', '&:hover': { borderColor: color.fg, transform: 'translateY(-1px)', boxShadow: 'shadow.medium' } }}>
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
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2, mt: 3 }}>
        {metrics.slice(0, 2).map((metric) => (
          <Box key={metric.label} sx={{ minWidth: 0, borderTop: '1px solid', borderColor: 'border.muted', pt: 2 }}>
            <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.label}</Text>
            <Text sx={{ display: 'block', color: statMetricColor(metric.tone), fontSize: 1, fontWeight: 700, fontFamily: 'mono', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {metric.value}
            </Text>
          </Box>
        ))}
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

// Closed-area path built from a top edge (left→right) and a bottom edge
// (left→right). The bottom edge is traversed in reverse so the path outlines
// a filled band. Used by the stacked area chart.
function areaPath(top: Array<{ x: number; y: number }>, bottom: Array<{ x: number; y: number }>): string {
  if (top.length === 0) return '';
  const topD = smoothPath(top);
  const bottomReversed = [...bottom].reverse();
  const bottomD = smoothPath(bottomReversed).replace(/^M\s+/, 'L ');
  return `${topD} ${bottomD} Z`;
}

// Pick a "nice" rounded ceiling for y-axis max so the labels land on
// readable values (10, 25, 50, 100, 250, 500, 1000…) instead of multiples
// of (maxValue / 4).
function niceCeil(value: number): number {
  if (value <= 4) return 4;
  const exp = Math.floor(Math.log10(value));
  const mag = Math.pow(10, exp);
  const norm = value / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return Math.ceil(nice * mag);
}

function LineChart({ points }: { points: DayPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 900;
  const height = 300;
  const pad = { left: 40, right: 16, top: 14, bottom: 32 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(4, ...points.flatMap((point) => ACTIVITY_SERIES.map((series) => point[series.key])));
  // Round yMax up to a "nice" step (10/25/50/100/250…) so y-axis labels are
  // readable round numbers.
  const yMax = niceCeil(maxValue);
  const active = hoveredIndex === null ? null : { index: hoveredIndex, point: points[hoveredIndex] };
  // Keep the last hovered index so the indicator can smoothly stay in place
  // while it fades out after the cursor leaves the chart.
  const lastHoveredRef = useRef<number>(0);
  useEffect(() => {
    if (hoveredIndex !== null) lastHoveredRef.current = hoveredIndex;
  }, [hoveredIndex]);
  // Clamp to current data length — when the user switches duration the data
  // shrinks but the ref still holds an index from the previous (longer) range.
  const rawDisplayIndex = hoveredIndex ?? lastHoveredRef.current;
  const displayIndex = points.length > 0
    ? Math.min(Math.max(0, rawDisplayIndex), points.length - 1)
    : 0;
  const displayPoint = points[displayIndex] ?? points[0];
  const x = (idx: number) => pad.left + (idx * plotWidth) / Math.max(1, points.length - 1);
  const y = (value: number) => pad.top + (1 - value / yMax) * plotHeight;
  const tickStep = Math.max(1, Math.ceil(points.length / 7));
  const totals = ACTIVITY_SERIES.map((series) => ({ ...series, total: points.reduce((sum, point) => sum + point[series.key], 0) }));
  const tooltipWidth = 196;
  // Height grows with series count — 5 rows × ~18px + header + total row +
  // padding. Recomputed so new series don't get clipped.
  const tooltipHeight = 56 + ACTIVITY_SERIES.length * 19 + 36;
  // Always compute a tooltip position (using displayIndex) so the tooltip can
  // slide smoothly even between hover transitions.
  const tooltipX = Math.min(width - tooltipWidth - 10, Math.max(10, x(displayIndex) - tooltipWidth / 2));
  const tooltipY = pad.top + 8;

  return (
    <Box sx={{ minWidth: 0 }}>
      <style>{`
        @keyframes activity-line-draw {
          from { stroke-dashoffset: 1; opacity: 0.28; }
          to   { stroke-dashoffset: 0; opacity: 1; }
        }
        @keyframes activity-dot-rise {
          from { transform: scale(.45); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .activity-line, .activity-dot { animation: none !important; opacity: 1 !important; stroke-dashoffset: 0 !important; }
        }
      `}</style>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 3, rowGap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', rowGap: 2 }}>
          {totals.map((series) => <ActivityLegend key={series.key} color={series.color} label={series.label} total={series.total} />)}
        </Box>
      </Box>
      <Box sx={{ width: '100%', overflow: 'hidden', border: '1px solid', borderColor: 'border.muted', borderRadius: 2 }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Network activity over time" onMouseLeave={() => setHoveredIndex(null)}>
          {/* Stacked bands intentionally use a flat fill (no gradient) — the
              previous top→bottom gradient faded each band's lower edge to ~18%
              opacity, which over a dark canvas became near-black and made the
              colors look muddy. The 1.5px top-edge stroke alone gives enough
              separation between layers. */}
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
          {/* Lines — one per series, drawn with a stroke-dashoffset animation
              so each one "draws itself in" left-to-right on first render. */}
          {ACTIVITY_SERIES.map((series, seriesIndex) => {
            const seriesPoints = points.map((point, idx) => ({ x: x(idx), y: y(point[series.key]) }));
            return (
              <path
                key={series.key}
                className="activity-line"
                d={smoothPath(seriesPoints)}
                fill="none"
                stroke={series.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                style={{
                  strokeDasharray: 1,
                  strokeDashoffset: 1,
                  animation: `activity-line-draw 760ms cubic-bezier(0.22, 1, 0.36, 1) ${seriesIndex * 110}ms forwards`,
                }}
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
          {/* Hover indicator — always mounted (so CSS transitions can interpolate
              between hover positions instead of snapping). Group opacity controls
              show/hide, child elements transition their positional attributes.
              Guarded by points.length so it doesn't try to read stackedRows[0]
              when there's no data yet. */}
          {points.length > 0 && (
          <g
            style={{
              opacity: active ? 1 : 0,
              transition: 'opacity 180ms ease',
              pointerEvents: 'none',
            }}
          >
            <line
              x1={x(displayIndex)}
              x2={x(displayIndex)}
              y1={pad.top}
              y2={height - pad.bottom}
              stroke="var(--fg-muted)"
              strokeOpacity="0.42"
              strokeDasharray="4 6"
              style={{ transition: 'x1 140ms cubic-bezier(0.4, 0, 0.2, 1), x2 140ms cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
            {/* Dots at each line's value for the hovered x. CSS transitions on
                cx/cy give a glide effect when moving between days. */}
            {ACTIVITY_SERIES.map((series) => (
              <circle
                key={series.key}
                cx={x(displayIndex)}
                cy={y(displayPoint[series.key])}
                r="4"
                fill={series.color}
                stroke="var(--canvas-default)"
                strokeWidth="2"
                style={{ transition: 'cx 140ms cubic-bezier(0.4, 0, 0.2, 1), cy 140ms cubic-bezier(0.4, 0, 0.2, 1)' }}
              />
            ))}
            {/* Tooltip — HTML inside foreignObject for themed CSS vars. The `x`
                attribute on foreignObject is transitionable in modern browsers. */}
            <foreignObject
              x={tooltipX}
              y={tooltipY}
              width={tooltipWidth}
              height={tooltipHeight}
              style={{ transition: 'x 160ms cubic-bezier(0.4, 0, 0.2, 1)' }}
            >
              <Box
                sx={{
                  bg: 'canvas.overlay',
                  backgroundColor: 'color-mix(in srgb, var(--canvas-overlay, var(--bgColor-overlay)) 92%, transparent)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 2,
                  px: 2,
                  py: 2,
                  fontSize: 0,
                }}
              >
                <Text sx={{ display: 'block', fontWeight: 700, color: 'fg.default', fontSize: 1, mb: 1 }}>
                  {displayPoint.label}
                </Text>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {ACTIVITY_SERIES.map((series) => (
                    <Box key={series.key} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: 99, bg: series.color, flexShrink: 0 }} />
                      <Text sx={{ color: 'fg.muted', flex: 1 }}>{series.label}</Text>
                      <Text sx={{ color: 'fg.default', fontWeight: 700, fontFamily: 'mono' }}>
                        {fmtCount(displayPoint[series.key])}
                      </Text>
                    </Box>
                  ))}
                </Box>
                <Box sx={{ borderTop: '1px solid', borderColor: 'border.muted', mt: 2, pt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text sx={{ color: 'fg.muted', fontWeight: 700, fontSize: 0 }}>TOTAL</Text>
                  <Text sx={{ color: 'fg.default', fontWeight: 700, fontFamily: 'mono', fontSize: 0 }}>
                    {fmtCount(ACTIVITY_SERIES.reduce((sum, series) => sum + displayPoint[series.key], 0))}
                  </Text>
                </Box>
              </Box>
            </foreignObject>
          </g>
          )}
        </svg>
      </Box>
    </Box>
  );
}

function ActivityLegend({ color, label, total }: { color: string; label: string; total: number }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 0, minWidth: 0 }}>
      <Box sx={{ width: 7, height: 7, borderRadius: 99, bg: color, flexShrink: 0 }} />
      <Text sx={{ color: 'fg.muted', whiteSpace: 'nowrap' }}>{label}</Text>
      <Text sx={{ color: 'fg.default', fontFamily: 'mono', fontWeight: 600 }}>{fmtCount(total)}</Text>
    </Box>
  );
}


function pullHref(pr: PullDto): string {
  return pr.html_url ?? 'https://github.com/' + pr.repo_full_name + '/pull/' + pr.number;
}

function BestWorkShowcase({
  pulls,
  totalScored,
  trendingRepos,
  authorLeaders,
  durationLabel,
}: {
  pulls: PullDto[];
  totalScored: number;
  trendingRepos: Array<{ repo: RepoEntry; stats?: GtRepo; trend: number; prs: number; score: number }>;
  authorLeaders: AuthorLeader[];
  durationLabel: string;
}) {
  const top = pulls[0] ?? null;
  const runnersUp = pulls.slice(1, 7);
  const maxTrend = Math.max(1, ...trendingRepos.map((row) => Math.max(0, row.trend || row.prs)));
  const maxAuthorReward = Math.max(0.0001, ...authorLeaders.map((row) => row.reward));
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', minWidth: 0, overflow: 'hidden', boxShadow: 'shadow.small' }}>
      <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'border.default', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Heading sx={{ fontSize: 1, m: 0 }}>Best Work</Heading>
          <RangePill label={durationLabel} />
        </Box>
        <Text sx={{ color: 'fg.muted', fontSize: 0, fontFamily: 'mono' }}>{fmtCount(totalScored)} official scored PRs</Text>
      </Box>
      {top ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'minmax(0, 1.2fr) minmax(320px, 0.8fr)'], gap: 0 }}>
          <Box sx={{ p: [3, null, 4], borderRight: [0, null, '1px solid'], borderBottom: ['1px solid', null, 0], borderColor: 'border.muted', minWidth: 0 }}>
            <Link href={pullHref(top)} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, '92px minmax(0, 1fr)'], gap: 2, alignItems: 'stretch' }}>
                <Box sx={{ border: '1px solid', borderColor: 'accent.muted', borderRadius: 2, bg: 'accent.subtle', display: 'grid', placeItems: 'center', minHeight: [74, null, 92], px: 2 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0, fontFamily: 'mono', textTransform: 'uppercase' }}>top score</Text>
                    <Text sx={{ display: 'block', color: 'accent.fg', fontSize: 4, fontFamily: 'mono', fontWeight: 800, lineHeight: 1 }}>{fmtNumber(num(top.score))}</Text>
                  </Box>
                </Box>
                <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 2 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, minWidth: 0, flexWrap: 'wrap' }}>
                      <RepoChip repo={top.repo_full_name} />
                      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{relative(top.merged_at ?? top.updated_at)}</Text>
                    </Box>
                    <Heading sx={{ m: 0, fontSize: [2, null, 2], lineHeight: 1.18 }}>{`#${top.number} ${top.title}`}</Heading>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <AuthorInline pr={top} />
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                      <LineChanges additions={top.additions} deletions={top.deletions} />
                      <ScoreValue pr={top} color="var(--accent-fg)" />
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Link>
            {runnersUp.length > 0 && (
              <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'repeat(2, minmax(0, 1fr))'], gap: 2, mt: 3 }}>
                {runnersUp.map((pr) => <BestWorkMiniPr key={pr.id} pr={pr} />)}
              </Box>
            )}
          </Box>
          <Box sx={{ p: [3, null, 4], display: 'grid', gap: 4, alignContent: 'start' }}>
            <BestWorkRankList
              icon={<RepoIcon size={14} />}
              title="Top Trending Repos"
              empty="No trending repos yet."
              rows={trendingRepos.map((row) => {
                const trendMetric = row.trend > 0 ? row.trend : row.prs;
                return {
                  key: row.repo.fullName,
                  href: repoHref(row.repo),
                  avatarUrl: `https://github.com/${row.repo.owner}.png?size=40`,
                  avatarShape: 'repo' as const,
                  title: row.repo.fullName,
                  value: (
                    <Text sx={{ color: row.trend >= 0 ? 'success.fg' : 'danger.fg', fontFamily: 'mono', fontWeight: 800, fontSize: 0, whiteSpace: 'nowrap' }}>
                      {fmtPct(row.trend / 100, true)}
                    </Text>
                  ),
                  barPct: trendMetric / maxTrend,
                  meta: (
                    <>
                      <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>{fmtCount(row.prs)} PRs</Text>
                      <Text sx={{ color: 'fg.subtle', fontSize: 0 }}>·</Text>
                      <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>{fmtNumber(row.score)} score</Text>
                      <MetricChip>emission {fmtPct(row.repo.emissionShare)}</MetricChip>
                      <MetricChip>maintainer_cut {fmtPct(row.repo.maintainerCut)}</MetricChip>
                    </>
                  ),
                };
              })}
            />
            <BestWorkRankList
              icon={<PeopleIcon size={14} />}
              title="Top Rewarded Contributors"
              empty="No rewarded contributors yet."
              rows={authorLeaders.map((row) => {
                const topRepo = row.repoSegments[0];
                const segments = row.repoSegments.map((segment, segmentIndex) => ({
                  key: segment.repo,
                  pct: row.reward > 0 ? segment.reward / row.reward : 0,
                  color: segmentColor(segmentIndex),
                  tooltip: `${segment.repo} · ${fmtPct(segment.reward)} PR reward · ${fmtNumber(segment.rawScore)} raw score · ${fmtCount(segment.prs)} PRs`,
                }));
                return {
                  key: row.author,
                  href: 'https://github.com/' + row.author,
                  avatarUrl: `https://github.com/${row.author}.png?size=40`,
                  avatarShape: 'user' as const,
                  title: row.author,
                  value: (
                    <Text sx={{ color: 'fg.default', fontFamily: 'mono', fontWeight: 800, fontSize: 0, whiteSpace: 'nowrap' }}>
                      {fmtPct(row.reward)}
                    </Text>
                  ),
                  barPct: row.reward / maxAuthorReward,
                  segments,
                  meta: (
                    <>
                      <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>{fmtCount(row.prs)} scored PRs</Text>
                      <Text sx={{ color: 'fg.subtle', fontSize: 0 }}>·</Text>
                      <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>raw {fmtNumber(row.rawScore)}</Text>
                      <MetricChip>{fmtCount(row.repoCount)} repos</MetricChip>
                      {topRepo && (
                        <MetricChip>
                          <Box as="span" sx={{ mr: 1, fontSize: 0, lineHeight: 1 }} aria-label="Top source">🥇</Box>
                          {topRepo.repo.split('/').at(-1)} {fmtPct(topRepo.reward)}
                        </MetricChip>
                      )}
                    </>
                  ),
                };
              })}
            />
          </Box>
        </Box>
      ) : (
        <Box sx={{ p: 4 }}>
          <Empty label="No official scored PRs in this range" />
        </Box>
      )}
    </Box>
  );
}

function RepoChip({ repo }: { repo: string }) {
  return (
    <Box as="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, maxWidth: '100%', border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', px: 2, py: '2px', color: 'fg.muted', fontFamily: 'mono', fontSize: 0 }}>
      <Box as="img" src={`https://github.com/${repo.split('/')[0]}.png?size=40`} alt="" sx={{ width: 14, height: 14, borderRadius: 1, bg: 'canvas.inset', flexShrink: 0 }} />
      <Text sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo}</Text>
    </Box>
  );
}

function AuthorInline({ pr }: { pr: PullDto }) {
  const author = pr.author_login ?? 'unknown';
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box as="img" src={`https://github.com/${author}.png?size=40`} alt="" sx={{ width: 18, height: 18, borderRadius: 99, bg: 'canvas.inset', flexShrink: 0 }} />
      <Text sx={{ color: 'fg.default', fontWeight: 700, fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{author}</Text>
      <RoleBadge association={pr.author_association} />
    </Box>
  );
}

function BestWorkMiniPr({ pr }: { pr: PullDto }) {
  const author = pr.author_login ?? 'unknown';
  return (
    <Link href={pullHref(pr)} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
      <Box sx={{ border: '1px solid', borderColor: 'border.muted', borderRadius: 2, px: 2, py: 2, minWidth: 0, height: '100%', transition: 'border-color 80ms ease, transform 80ms ease', '&:hover': { borderColor: 'border.default', transform: 'translateY(-1px)' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box as="img" src={`https://github.com/${pr.repo_full_name.split('/')[0]}.png?size=40`} alt="" sx={{ width: 14, height: 14, borderRadius: 1, bg: 'canvas.inset', flexShrink: 0 }} />
            <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.repo_full_name}</Text>
          </Box>
          <Text sx={{ color: 'accent.fg', fontFamily: 'mono', fontWeight: 700, fontSize: 0, whiteSpace: 'nowrap' }}>{fmtSignedNumber(num(pr.score))}</Text>
        </Box>
        <Text sx={{ display: 'block', fontWeight: 700, fontSize: 0, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{pr.number} {pr.title}</Text>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, minWidth: 0 }}>
          <Box as="img" src={`https://github.com/${author}.png?size=40`} alt="" sx={{ width: 14, height: 14, borderRadius: 99, bg: 'canvas.inset', flexShrink: 0 }} />
          <Text sx={{ color: 'fg.muted', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{author}</Text>
        </Box>
      </Box>
    </Link>
  );
}

type AuthorLeader = {
  author: string;
  reward: number;
  rawScore: number;
  prs: number;
  repoCount: number;
  topPull: PullDto;
  repoSegments: Array<{ repo: string; reward: number; rawScore: number; prs: number; pool: number }>;
};

function segmentColor(index: number): string {
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6'];
  return colors[index % colors.length];
}

function MetricChip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'success' }) {
  const palette = tone === 'accent'
    ? { border: 'accent.muted', bg: 'accent.subtle', color: 'accent.fg' }
    : tone === 'success'
      ? { border: 'success.muted', bg: 'success.subtle', color: 'success.fg' }
      : { border: 'border.muted', bg: 'canvas.subtle', color: 'fg.muted' };
  return (
    <Box as="span" sx={{ border: '1px solid', borderColor: palette.border, borderRadius: 2, bg: palette.bg, color: palette.color, fontFamily: 'mono', fontSize: 0, px: 1, lineHeight: '15px', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

function InlineProgress({ pct, segments, color = 'accent.emphasis' }: { pct: number; color?: string; segments?: Array<{ key: string; pct: number; color: string; tooltip: string }> }) {
  return (
    <Box sx={{ position: 'relative', height: 6, borderRadius: 999, bg: 'canvas.inset', overflow: 'visible', minWidth: 86 }}>
      {segments && segments.length > 0 ? (
        <Box sx={{ position: 'absolute', inset: 0, width: `${Math.max(4, Math.min(100, pct * 100))}%`, display: 'flex', overflow: 'visible', borderRadius: 999 }}>
          {segments.map((segment) => (
            <Box
              key={segment.key}
              title={segment.tooltip}
              sx={{
                position: 'relative',
                width: `${Math.max(4, Math.min(100, segment.pct * 100))}%`,
                minWidth: 4,
                bg: segment.color,
                '&:first-of-type': { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
                '&:last-of-type': { borderTopRightRadius: 999, borderBottomRightRadius: 999 },
                '&:hover': { filter: 'brightness(1.22)' },
              }}
            />
          ))}
        </Box>
      ) : (
        <Box sx={{ position: 'absolute', inset: 0, width: `${Math.max(4, Math.min(100, pct * 100))}%`, bg: color, borderRadius: 999 }} />
      )}
    </Box>
  );
}

type BestWorkRankRow = {
  key: string;
  href: string;
  avatarUrl: string;
  avatarShape: 'repo' | 'user';
  title: string;
  value: React.ReactNode;
  barPct: number;
  meta: React.ReactNode;
  segments?: Array<{ key: string; pct: number; color: string; tooltip: string }>;
};

function BestWorkRankList({ icon, title, empty, rows }: { icon: React.ReactNode; title: string; empty: string; rows: BestWorkRankRow[] }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, color: 'fg.default' }}>
        <Box sx={{ color: 'accent.fg', display: 'inline-flex' }}>{icon}</Box>
        <Text sx={{ fontWeight: 700, fontSize: 0 }}>{title}</Text>
      </Box>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {rows.length === 0 ? (
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{empty}</Text>
        ) : rows.map((row, index) => (
          <Link key={row.key} href={row.href} target={row.href.startsWith('http') ? '_blank' : undefined} rel={row.href.startsWith('http') ? 'noreferrer' : undefined} style={{ color: 'inherit', textDecoration: 'none' }}>
            <Box sx={{ minWidth: 0, py: 1, borderRadius: 2, '&:hover': { bg: 'canvas.subtle' } }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 0.85fr) minmax(112px, 1fr) auto', gap: 2, alignItems: 'center', minWidth: 0 }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Box sx={{ width: 18, height: 18, borderRadius: 99, border: '1px solid', borderColor: 'accent.muted', bg: 'accent.subtle', color: 'accent.fg', display: 'grid', placeItems: 'center', fontSize: 0, fontFamily: 'mono', fontWeight: 800 }}>{index + 1}</Box>
                  <Box as="img" src={row.avatarUrl} alt="" sx={{ width: 18, height: 18, borderRadius: row.avatarShape === 'user' ? 99 : 2, bg: 'canvas.inset', flexShrink: 0 }} />
                </Box>
                <Text sx={{ fontWeight: 800, fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</Text>
                <InlineProgress pct={row.barPct} segments={row.segments} />
                {row.value}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, minWidth: 0, overflow: 'hidden', flexWrap: 'wrap', pl: '48px' }}>
                {row.meta}
              </Box>
            </Box>
          </Link>
        ))}
      </Box>
    </Box>
  );
}

function PullRequestPipeline({ columns, durationLabel, repos, selectedRepos, onRepoToggle, onRepoClear }: { columns: PipelineColumn[]; durationLabel: string; repos: string[]; selectedRepos: string[]; onRepoToggle: (repo: string) => void; onRepoClear: () => void }) {
  const active = columns
    .filter((column) => column.key === 'draft' || column.key === 'submitted')
    .reduce((sum, column) => sum + column.pulls.length, 0);
  const total = columns.reduce((sum, column) => sum + column.pulls.length, 0);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', minWidth: 0, overflow: 'visible', boxShadow: 'shadow.small' }}>
      <Box sx={{ position: 'relative', zIndex: 20, minHeight: 48, px: 3, py: 2, borderBottom: '1px solid', borderColor: 'border.default', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Heading sx={{ fontSize: 1, m: 0 }}>Pull Request Pipeline</Heading>
          <RangePill label={fmtCount(active) + ' active'} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <PipelineRepoList repos={repos} selectedRepos={selectedRepos} onRepoToggle={onRepoToggle} onRepoClear={onRepoClear} />
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{fmtCount(total)} tracked PRs · {durationLabel}</Text>
          <LinkPill href="/pulls">View all</LinkPill>
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'repeat(5, minmax(220px, 1fr))'], overflowX: ['visible', null, 'auto'] }}>
        {columns.map((column, index) => (
          <Box key={column.key} sx={{ p: 3, borderLeft: [0, null, index === 0 ? 0 : '1px solid var(--borderColor-default, var(--border-default, var(--color-border-default)))'], borderTop: [index === 0 ? 0 : '1px solid var(--borderColor-default, var(--border-default, var(--color-border-default)))', null, 0], minWidth: 0 }}>
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

function IssuePipeline({ columns, durationLabel, repos, selectedRepos, onRepoToggle, onRepoClear, pullByKey }: { columns: IssuePipelineColumn[]; durationLabel: string; repos: string[]; selectedRepos: string[]; onRepoToggle: (repo: string) => void; onRepoClear: () => void; pullByKey: Map<string, PullDto> }) {
  const active = columns.find((column) => column.key === 'opened')?.issues.length ?? 0;
  const total = columns.reduce((sum, column) => sum + column.issues.length, 0);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', minWidth: 0, overflow: 'hidden', boxShadow: 'shadow.small' }}>
      <Box sx={{ position: 'relative', zIndex: 20, minHeight: 48, px: 3, py: 2, borderBottom: '1px solid', borderColor: 'border.default', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Heading sx={{ fontSize: 1, m: 0 }}>Issue Pipeline</Heading>
          <RangePill label={fmtCount(active) + ' open'} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <PipelineRepoList repos={repos} selectedRepos={selectedRepos} onRepoToggle={onRepoToggle} onRepoClear={onRepoClear} />
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{fmtCount(total)} tracked issues · {durationLabel}</Text>
          <LinkPill href="/issues">View all</LinkPill>
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'repeat(4, minmax(240px, 1fr))'], overflowX: ['visible', null, 'auto'] }}>
        {columns.map((column, index) => (
          <Box key={column.key} sx={{ p: 3, borderLeft: [0, null, index === 0 ? 0 : '1px solid var(--borderColor-default, var(--border-default, var(--color-border-default)))'], borderTop: [index === 0 ? 0 : '1px solid var(--borderColor-default, var(--border-default, var(--color-border-default)))', null, 0], minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: 99, bg: column.color, flexShrink: 0 }} />
                  <Text sx={{ fontWeight: 700, fontSize: 0 }}>{column.title} · {column.issues.length}</Text>
                </Box>
                <Text sx={{ display: 'block', color: 'fg.muted', fontFamily: 'mono', fontSize: 0, mt: 1 }}>{column.caption}</Text>
              </Box>
            </Box>
            <Box sx={{ display: 'grid', gap: 2 }}>
              {column.issues.slice(0, 3).map((issue) => <IssuePipelineCard key={issue.id} issue={issue} stage={column.key} color={column.color} pullByKey={pullByKey} />)}
              {column.issues.length === 0 && <PipelineEmpty label={issuePipelineEmptyLabel(column.key)} />}
              {column.issues.length > 3 && (
                <Text sx={{ color: 'fg.muted', fontSize: 0, fontFamily: 'mono', textAlign: 'right' }}>+{column.issues.length - 3} more</Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function issueStageStatus(stage: IssuePipelineColumn['key']): { label: string; bg: string; border: string; color: string } {
  if (stage === 'opened') return { label: 'open', bg: 'success.subtle', border: 'success.muted', color: 'success.fg' };
  if (stage === 'completed') return { label: 'pending', bg: 'accent.subtle', border: 'accent.muted', color: 'accent.fg' };
  if (stage === 'scored') return { label: 'scored', bg: 'done.subtle', border: 'done.muted', color: 'done.fg' };
  return { label: 'closed', bg: 'danger.subtle', border: 'danger.muted', color: 'danger.fg' };
}

function IssuePipelineStatusBadge({ stage }: { stage: IssuePipelineColumn['key'] }) {
  const status = issueStageStatus(stage);
  return (
    <Box as="span" sx={{ border: '1px solid', borderColor: status.border, borderRadius: 2, bg: status.bg, color: status.color, fontSize: 0, fontWeight: 700, px: 1, py: '1px', lineHeight: '16px', whiteSpace: 'nowrap' }}>
      {status.label}
    </Box>
  );
}

function issueOfficialScore(issue: IssueDto, pullByKey: Map<string, PullDto>): number | null {
  const scores: number[] = [];
  for (const linked of issue.linked_prs ?? []) {
    const pr = linkedPull(issue, pullByKey, linked.number);
    if (pr && hasOfficialScore(pr)) scores.push(pr.score ?? 0);
  }
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0);
}

function IssueScoreValue({ issue, pullByKey, color }: { issue: IssueDto; pullByKey: Map<string, PullDto>; color: string }) {
  const score = issueOfficialScore(issue, pullByKey);
  if (score === null) return null;
  return (
    <Box title="Linked solver PR official score" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color, fontSize: 0, fontFamily: 'mono', whiteSpace: 'nowrap' }}>
      <Box sx={{ width: 6, height: 6, borderRadius: 99, bg: color }} />
      {fmtSignedNumber(score)}
    </Box>
  );
}

function IssueLabels({ issue }: { issue: IssueDto }) {
  const visible = issue.labels.slice(0, 2);
  const extra = Math.max(0, issue.labels.length - visible.length);
  if (visible.length === 0) return null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
      {visible.map((label) => (
        <Box key={label.name} as="span" sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'neutral.subtle', color: 'fg.muted', fontSize: 0, fontWeight: 600, px: 1, py: '1px', lineHeight: '16px', maxWidth: 118, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label.name}
        </Box>
      ))}
      {extra > 0 && <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontSize: 0 }}>+{extra}</Text>}
    </Box>
  );
}

function issuePipelineEmptyLabel(stage: IssuePipelineColumn['key']): string {
  if (stage === 'opened') return 'No open issues';
  if (stage === 'completed') return 'No issues pending validation';
  if (stage === 'scored') return 'No scored issues';
  return 'No closed issues';
}

function IssuePipelineCard({ issue, stage, color, pullByKey }: { issue: IssueDto; stage: IssuePipelineColumn['key']; color: string; pullByKey: Map<string, PullDto> }) {
  const href = issueHref(issue);
  const age = issuePipelineAge(issue, stage);
  const author = issue.author_login ?? 'unknown';
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', p: 2, minWidth: 0, transition: 'border-color 120ms ease, box-shadow 120ms ease', '&:hover': { borderColor: 'border.default', boxShadow: 'shadow.small' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            as="img"
            src={`https://github.com/${issue.repo_full_name.split('/')[0]}.png?size=40`}
            alt=""
            sx={{ width: 14, height: 14, borderRadius: 1, bg: 'canvas.inset', flexShrink: 0 }}
          />
          <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.repo_full_name}</Text>
        </Box>
        <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>{age}</Text>
      </Box>
      <Link href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 700, fontSize: 12, lineHeight: 1.35, display: 'block' }}>
        #{issue.number} {issue.title}
      </Link>
      <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            as="img"
            src={`https://github.com/${author}.png?size=40`}
            alt=""
            sx={{ width: 14, height: 14, borderRadius: 99, bg: 'canvas.inset', flexShrink: 0 }}
          />
          <Text sx={{ color: 'fg.muted', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{author}</Text>
          <RoleBadge association={issue.author_association} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
          <IssueLabels issue={issue} />
          <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, minWidth: 0, flexWrap: 'wrap', ml: 'auto' }}>
            <IssuePipelineStatusBadge stage={stage} />
            {stage === 'scored' && <IssueScoreValue issue={issue} pullByKey={pullByKey} color={color} />}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function PipelineRepoList({ repos, selectedRepos, onRepoToggle, onRepoClear }: { repos: string[]; selectedRepos: string[]; onRepoToggle: (repo: string) => void; onRepoClear: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedKeys = new Set(selectedRepos.map((repo) => repo.toLowerCase()));
  const canonicalSelectedRepos = uniqueRepoNames(selectedRepos.map((selected) => repos.find((repo) => repo.toLowerCase() === selected.toLowerCase()) ?? selected));
  const orderedRepos = uniqueRepoNames([
    ...canonicalSelectedRepos,
    ...repos.filter((repo) => !selectedKeys.has(repo.toLowerCase())),
  ]);
  const compactRepos = orderedRepos.slice(0, 3);
  const extraRepoCount = Math.max(0, orderedRepos.length - compactRepos.length);
  const repoSearchTerm = repoSearch.trim().toLowerCase();
  const filteredMenuRepos = repoSearchTerm
    ? orderedRepos.filter((repo) => repo.toLowerCase().includes(repoSearchTerm))
    : orderedRepos;
  const buttonSx = {
    appearance: 'none',
    border: '1px solid',
    borderColor: 'border.default',
    borderRadius: 2,
    bg: 'canvas.subtle',
    color: 'fg.muted',
    cursor: 'pointer',
    fontFamily: 'mono',
    fontSize: 0,
    px: 2,
    py: 1,
    lineHeight: '16px',
    whiteSpace: 'nowrap',
    ':hover': { borderColor: 'accent.muted', color: 'accent.fg', bg: 'accent.subtle' },
  } as const;

  const closeMenu = () => {
    setMenuOpen(false);
    setRepoSearch('');
    setMenuCoords(null);
  };

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return;
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const width = Math.min(320, Math.max(240, viewportW - 16));
      let left = rect.right - width;
      if (left + width > viewportW - 8) left = viewportW - width - 8;
      if (left < 8) left = 8;

      const topGap = 8;
      const bottomGap = viewportH < 520 ? 32 : 12;
      const preferredMax = viewportH < 520 ? 260 : 360;
      const naturalHeight = Math.min(preferredMax, orderedRepos.length * 34 + 62);
      const spaceBelow = Math.max(0, viewportH - rect.bottom - bottomGap);
      const spaceAbove = Math.max(0, rect.top - topGap);
      const openUp = spaceBelow < naturalHeight && spaceAbove > spaceBelow;
      const availableHeight = openUp ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(120, Math.min(naturalHeight, availableHeight));
      const top = openUp
        ? Math.max(topGap, rect.top - 4 - maxHeight)
        : Math.min(rect.bottom + 4, viewportH - maxHeight - bottomGap);

      setMenuCoords({ top: Math.max(topGap, top), left, width, maxHeight });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [orderedRepos.length, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const closeOnOutsidePress = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const closeOnOutsideScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', closeOnOutsidePress);
    document.addEventListener('touchstart', closeOnOutsidePress);
    window.addEventListener('scroll', closeOnOutsideScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', closeOnOutsidePress);
      document.removeEventListener('touchstart', closeOnOutsidePress);
      window.removeEventListener('scroll', closeOnOutsideScroll, true);
    };
  }, [menuOpen]);

  if (repos.length === 0 && selectedRepos.length === 0) return null;

  return (
    <Box ref={rootRef} title={repos.join(', ')} sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
      {selectedRepos.length > 0 && (
        <Box
          as="button"
          type="button"
          onClick={() => {
            onRepoClear();
            closeMenu();
          }}
          sx={{ ...buttonSx, bg: 'canvas.default', fontWeight: 700 }}
        >
          All
        </Box>
      )}
      {compactRepos.map((repo) => {
        const selected = selectedKeys.has(repo.toLowerCase());
        return (
          <Box
            as="button"
            type="button"
            key={repo}
            aria-pressed={selected}
            title={selected ? `Remove ${repo} from this pipeline filter` : `Add ${repo} to this pipeline filter`}
            onClick={() => {
              onRepoToggle(repo);
              closeMenu();
            }}
            sx={{
              ...buttonSx,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              maxWidth: 190,
              borderColor: selected ? 'accent.muted' : 'border.default',
              bg: selected ? 'accent.subtle' : 'canvas.subtle',
              color: selected ? 'accent.fg' : 'fg.muted',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <Box
              as="img"
              src={`https://github.com/${repo.split('/')[0]}.png?size=40`}
              alt=""
              sx={{ width: 14, height: 14, borderRadius: 1, bg: 'canvas.inset', flexShrink: 0 }}
            />
            <Box as="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo}</Box>
          </Box>
        );
      })}
      {extraRepoCount > 0 && (
        <Box>
          <Box
            ref={triggerRef}
            as="button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={menuOpen ? 'Hide repositories' : `Show ${extraRepoCount} more repositories`}
            onClick={() => {
              setMenuOpen((open) => {
                if (open) {
                  setRepoSearch('');
                  setMenuCoords(null);
                }
                return !open;
              });
            }}
            sx={{ ...buttonSx, minWidth: 32, fontWeight: 700 }}
          >
            <KebabHorizontalIcon size={14} />
          </Box>
          {menuOpen && menuCoords && typeof document !== 'undefined' && createPortal(
            <Box
              ref={menuRef}
              role="menu"
              sx={{
                position: 'fixed',
                top: menuCoords.top,
                left: menuCoords.left,
                zIndex: 9500,
                width: menuCoords.width,
                maxHeight: menuCoords.maxHeight,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                p: 0,
                border: '1px solid',
                borderColor: 'var(--border-default)',
                borderRadius: '6px',
                bg: 'var(--bg-subtle)',
                boxShadow: 'var(--shadow-overlay)',
              }}
            >
              <Box sx={{ p: '8px', pb: '6px', borderBottom: '1px solid', borderColor: 'var(--border-muted)' }}>
                <SearchInput
                  value={repoSearch}
                  onChange={setRepoSearch}
                  placeholder="Filter repos…"
                  width="100%"
                  ariaLabel="Filter repositories"
                />
              </Box>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: '6px' }}>
                {selectedRepos.length > 0 && (
                  <Box
                    as="button"
                    type="button"
                    role="menuitem"
                    onClick={onRepoClear}
                    sx={{
                      appearance: 'none',
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      border: 0,
                      borderRadius: 0,
                      bg: 'transparent',
                      color: 'var(--fg-muted)',
                      cursor: 'pointer',
                      fontSize: 1,
                      fontFamily: 'inherit',
                      px: '12px',
                      py: '6px',
                      lineHeight: '20px',
                      textAlign: 'left',
                      ':hover': { bg: 'var(--menu-item-hover-bg)', color: 'var(--menu-item-hover-fg)' },
                    }}
                  >
                    <Box sx={{ width: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center' }} />
                    <Box as="span" sx={{ fontWeight: 600 }}>Clear all</Box>
                    <Text sx={{ ml: 'auto', color: 'fg.subtle', fontSize: 0 }}>{selectedRepos.length}</Text>
                  </Box>
                )}
                {selectedRepos.length > 0 && <Box sx={{ my: '6px', borderTop: '1px solid', borderColor: 'var(--border-muted)' }} />}
                {filteredMenuRepos.length > 0 ? filteredMenuRepos.map((repo) => {
                  const selected = selectedKeys.has(repo.toLowerCase());
                  return (
                    <Box
                      as="button"
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={selected}
                      key={repo}
                      title={selected ? `Remove ${repo} from this pipeline filter` : `Add ${repo} to this pipeline filter`}
                      onClick={() => onRepoToggle(repo)}
                      sx={{
                        appearance: 'none',
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        border: 0,
                        borderRadius: 0,
                        bg: 'transparent',
                        color: 'var(--fg-default)',
                        cursor: 'pointer',
                        fontSize: 1,
                        fontFamily: 'inherit',
                        px: '12px',
                        py: '6px',
                        lineHeight: '20px',
                        textAlign: 'left',
                        ':hover': { bg: 'var(--menu-item-hover-bg)', color: 'var(--menu-item-hover-fg)' },
                      }}
                    >
                      <Box sx={{ width: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--selected-check)' }}>
                        {selected ? <CheckIcon size={14} /> : null}
                      </Box>
                      <Box
                        as="img"
                        src={`https://github.com/${repo.split('/')[0]}.png?size=40`}
                        alt=""
                        sx={{ width: 16, height: 16, borderRadius: 1, bg: 'canvas.inset', flexShrink: 0 }}
                      />
                      <Box as="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo}</Box>
                    </Box>
                  );
                }) : (
                  <Box sx={{ px: '12px', py: '10px', color: 'var(--fg-muted)', fontSize: 1, textAlign: 'center' }}>
                    No repositories match.
                  </Box>
                )}
              </Box>
            </Box>,
            document.body
          )}
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
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', p: 2, minWidth: 0, transition: 'border-color 120ms ease, box-shadow 120ms ease', '&:hover': { borderColor: 'border.default', boxShadow: 'shadow.small' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            as="img"
            src={`https://github.com/${pr.repo_full_name.split('/')[0]}.png?size=40`}
            alt=""
            sx={{ width: 14, height: 14, borderRadius: 1, bg: 'canvas.inset', flexShrink: 0 }}
          />
          <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.repo_full_name}</Text>
        </Box>
        <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>{age}</Text>
      </Box>
      <Link href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--fg-default)', textDecoration: 'none', fontWeight: 700, fontSize: 12, lineHeight: 1.35, display: 'block' }}>
        #{pr.number} {pr.title}
      </Link>
      <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            as="img"
            src={`https://github.com/${author}.png?size=40`}
            alt=""
            sx={{ width: 14, height: 14, borderRadius: 99, bg: 'canvas.inset', flexShrink: 0 }}
          />
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

function ActivityKindIcon({ kind, color }: { kind: RecentActivityItem['kind']; color: string }) {
  if (kind === 'pr') return <Box sx={{ color, display: 'inline-flex' }}><GitPullRequestIcon size={14} /></Box>;
  if (kind === 'issue') return <Box sx={{ color, display: 'inline-flex' }}><IssueOpenedIcon size={14} /></Box>;
  // bounty / default: small filled dot
  return <Box sx={{ width: 8, height: 8, borderRadius: 99, bg: color, mt: '3px' }} />;
}

function ActivityStatus({ item }: { item: RecentActivityItem }) {
  const tone = activityTone(item.tone);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: tone.color, fontSize: 0, fontWeight: 500, whiteSpace: 'nowrap' }}>
      <Box sx={{ width: 6, height: 6, borderRadius: 99, bg: tone.color, flexShrink: 0 }} />
      {item.badge}
    </Box>
  );
}

function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) return <Empty label="No recent activity" />;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {items.map((item) => {
        const tone = activityTone(item.tone);
        return (
          <Link
            key={item.id}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                columnGap: 3,
                alignItems: 'start',
                px: 3,
                py: '10px',
                border: '1px solid',
                borderColor: 'border.muted',
                borderRadius: 2,
                transition: 'border-color 80ms ease, transform 80ms ease',
                '&:hover': {
                  borderColor: 'border.default',
                  transform: 'translateY(-1px)',
                },
              }}
            >
              <Box sx={{ mt: '3px', flexShrink: 0 }}>
                <ActivityKindIcon kind={item.kind} color={tone.color} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Text
                  sx={{
                    display: 'block',
                    color: 'fg.default',
                    fontWeight: 600,
                    fontSize: 1,
                    lineHeight: 1.35,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.title}
                </Text>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mt: '2px',
                    color: 'fg.muted',
                    fontSize: 0,
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Box
                      as="img"
                      src={`https://github.com/${item.repo.split('/')[0]}.png?size=40`}
                      alt=""
                      sx={{ width: 14, height: 14, borderRadius: 1, bg: 'canvas.subtle', flexShrink: 0 }}
                    />
                    <Text sx={{ fontFamily: 'mono', color: 'accent.fg', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.repo}
                    </Text>
                  </Box>
                  {item.actor && (
                    <>
                      <Text sx={{ color: 'fg.subtle' }}>·</Text>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, whiteSpace: 'nowrap' }}>
                        <Text>by</Text>
                        <Box
                          as="img"
                          src={`https://github.com/${item.actor}.png?size=40`}
                          alt=""
                          sx={{ width: 14, height: 14, borderRadius: 99, bg: 'canvas.subtle', flexShrink: 0 }}
                        />
                        <Text>{item.actor}</Text>
                      </Box>
                    </>
                  )}
                  {item.meta && (
                    <>
                      <Text sx={{ color: 'fg.subtle' }}>·</Text>
                      <Text sx={{ whiteSpace: 'nowrap', fontFamily: 'mono' }}>{item.meta}</Text>
                    </>
                  )}
                </Box>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  flexShrink: 0,
                  mt: '3px',
                }}
              >
                <ActivityStatus item={item} />
                <Text sx={{ color: 'fg.subtle', fontSize: 0, whiteSpace: 'nowrap', minWidth: 32, textAlign: 'right' }}>
                  {relative(item.timestamp)}
                </Text>
              </Box>
            </Box>
          </Link>
        );
      })}
    </Box>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <Box sx={{ p: 3, color: 'fg.muted', display: 'flex', alignItems: 'center', gap: 2 }}>
      <AlertIcon size={16} />
      <Text>{label}</Text>
    </Box>
  );
}
