'use client';

/* eslint-disable @next/next/no-img-element */

/* Miner detail modal — a near-fullscreen 2-pane dashboard opened by clicking a
 * miner card / list row. Left: an identity sidebar (avatar, status, points, stats,
 * links). Right: a dashboard of the miner's gittensor (SN74) work — a contribution
 * timeline (daily PR score + cumulative), the Pull-requests & Issues table, a
 * GitHub-style activity heatmap, and the emission / reward-stream breakdown.
 * Built on the shared modal scaffold (.modalOuter/.modalBg/.modalBox); all extra
 * styling rides dedicated .mm* / .modalBoxWide classes. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GraphIcon,
  InfoIcon,
  LightBulbIcon,
  LockIcon,
  MarkGithubIcon,
  PersonIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
  StarFillIcon,
  StarIcon,
  XIcon,
  ZapIcon,
} from '@primer/octicons-react';
import { formatCount, formatNumber } from '@/lib/format';
import styles from '../page.module.css';
import { eligibilityLabel, pct, repoRegisteredMs, repoTaoOf, score, type MinerView, type RepoSignal } from '../_lib/miners';
import { ISSUE_COLOR, MAINTAINER_COLOR, NEUTRAL_COLOR, PR_COLOR } from '../_lib/streams';
import type { MinerPr, MinerWorksResponse } from '@/types/entities';
import { PrsIssuesTable, buildHeatGrid, heatFill, decayMultiplier, PR_LOOKBACK_DAYS } from './MinerWorks';
import {
  ActivityLineChart,
  EarningForecastChart,
  type ForecastPoint,
  type ForecastRepo,
  type ForecastSeries,
} from '@/components/ActivityLineChart';

interface MinerModalProps {
  view: MinerView | null;
  /** Per-repo TAO base — turns each repo's stream shares into TAO/day. */
  subnetTao: number;
  tracked: boolean;
  onClose: () => void;
  onToggleTrack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const fmtTao = (n: number) => formatNumber(n, { digits: 3, fallback: '0' });

/** Why an inactive reward stream isn't earning yet. The gittensor gate is PER-REPO —
 * each repo has its own merged/solved counts, its own PR/issue credibility, and its own
 * thresholds (count ≥ minMerged/minSolved, then credibility ≥ the repo's min) — so a
 * miner-wide number would be meaningless. We surface the single repo the miner is
 * CLOSEST to clearing, with that repo's own numbers. Null if there's no work in the
 * stream yet. */
function bestRepoGap(rows: RepoSignal[], stream: 'pr' | 'issue'): { repo: string; text: string } | null {
  const cand = rows
    .map((r) =>
      stream === 'pr'
        ? // Not-yet-eligible repos that route some emission to PRs (share < 1).
          { repo: r.repo, has: r.prs > 0 && r.issueDiscoveryShare < 1 && !r.prEligible, count: r.mergedPrs, need: r.minMergedPrs, cred: r.prCred, needCred: r.minPrCred, noun: 'merged' }
        : // Not-yet-eligible repos that route some emission to issue discovery (share > 0).
          // validSolvedIssues = the count the gate actually checks (validity-filtered).
          { repo: r.repo, has: r.issues > 0 && r.issueDiscoveryShare > 0 && !r.issueEligible, count: r.validSolvedIssues, need: r.minSolvedIssues, cred: r.issueCred, needCred: r.minIssueCred, noun: 'solved' },
    )
    .filter((c) => c.has);
  if (cand.length === 0) return null;
  // Closest = smallest remaining count to the repo's gate, then highest credibility.
  cand.sort((a, b) => Math.max(0, a.need - a.count) - Math.max(0, b.need - b.count) || b.cred - a.cred);
  const c = cand[0];
  const text = c.count < c.need ? `${c.count}/${c.need} ${c.noun}` : `cred ${pct(c.cred)} / ${pct(c.needCred)}`;
  return { repo: c.repo, text };
}

type InsightKind = 'strong' | 'warn' | 'action' | 'info';
interface Insight {
  kind: InsightKind;
  title: string;
  body: string;
}

/** Replace each repo's PR-side stats (merged count, credibility, eligibility) with values
 * recomputed LIVE from the miner's actual PRs over the trailing PR_LOOKBACK_DAYS window,
 * rather than the scoring feed's snapshot — which lags as PRs roll out of the window. A
 * repo with no live PR data keeps its feed values; issue-side stats are left untouched
 * (the works feed lacks the solved/closed-issue dates needed to redo them). */
function applyLivePrStats(rows: RepoSignal[], prs: MinerPr[] | undefined, nowMs: number): RepoSignal[] {
  if (!prs || prs.length === 0) return rows;
  const cutoff = nowMs - PR_LOOKBACK_DAYS * 86_400_000;
  const stat = new Map<string, { merged: number; closed: number }>();
  for (const p of prs) {
    // Only PRs inside the trailing window create or touch a bucket. A repo whose
    // works PRs are all out-of-window gets no bucket, so it keeps the feed's
    // authoritative snapshot below instead of being overwritten with zeros.
    const merged = p.mergedAt ? Date.parse(p.mergedAt) >= cutoff : false;
    const closed = !p.mergedAt && !!p.closedAt && Date.parse(p.closedAt) >= cutoff;
    if (!merged && !closed) continue;
    const key = p.repo.toLowerCase();
    let s = stat.get(key);
    if (!s) {
      s = { merged: 0, closed: 0 };
      stat.set(key, s);
    }
    if (merged) s.merged += 1;
    else s.closed += 1;
  }
  return rows.map((r) => {
    const s = stat.get(r.repo.toLowerCase());
    if (!s) return r;
    const total = s.merged + s.closed;
    const prCred = total > 0 ? s.merged / total : 0;
    const prEligible = s.merged >= r.minMergedPrs && prCred >= r.minPrCred;
    return { ...r, mergedPrs: s.merged, prCred, prEligible };
  });
}

/** "Insights & next actions" — actionable observations from the miner's per-repo
 * signals (+ the decay forecast). All gates are per-repo, never miner-wide. Built in
 * priority order (protect what you have → unlock more → reinforce) and capped so the
 * panel surfaces the few most relevant rather than sprawling. */
function buildInsights(rows: RepoSignal[], forecast: ForecastSeries | null): Insight[] {
  if (rows.length === 0) return [];
  const out: Insight[] = [];

  // 1. Credibility at risk (warn) — an eligible repo whose credibility (merged ÷ total)
  //    sits just above its own gate, with no buffer. Only when the repo has a real gate
  //    (min > 0). We compute the EXACT number of further rejections that would drop it
  //    below — "a couple" understates the risk for low-volume repos (often it's just 1).
  type Risk = { repo: string; cred: number; min: number; count: number; noun: string };
  const risk = rows
    .map((r): Risk | null => {
      // Only warn about a stream the repo actually pays for: PRs where the repo routes
      // some emission to PRs (share < 1), issue discovery where it routes some (share > 0).
      if (r.prEligible && r.minPrCred > 0 && r.issueDiscoveryShare < 1 && r.prCred < r.minPrCred + 0.05)
        return { repo: r.repo, cred: r.prCred, min: r.minPrCred, count: r.mergedPrs, noun: 'closed PR' };
      if (r.issueEligible && r.minIssueCred > 0 && r.issueDiscoveryShare > 0 && r.issueCred < r.minIssueCred + 0.05)
        return { repo: r.repo, cred: r.issueCred, min: r.minIssueCred, count: r.solvedIssues, noun: 'closed issue' };
      return null;
    })
    .filter((x): x is Risk => x !== null)
    .sort((a, b) => a.cred - a.min - (b.cred - b.min))[0];
  if (risk) {
    const total = risk.cred > 0 ? Math.round(risk.count / risk.cred) : risk.count; // merged + rejected
    const extra = Math.max(1, Math.ceil(risk.count / risk.min - total)); // rejections to fall below the gate
    out.push({
      kind: 'warn',
      title: `Credibility at risk on ${risk.repo}`,
      body: `Credibility here is ${pct(risk.cred)} over the last 30 days, just above the ${pct(risk.min)} gate — ${extra} more ${risk.noun}${extra === 1 ? '' : 's'} would drop you below it and stop this repo's earnings.`,
    });
  }

  // 2. Freshness decay (warn) — the time-decay curve will erode the live score if no
  //    new merges land (reuses the forecast's projected drop).
  if (forecast && forecast.dropPct != null && forecast.dropPct >= 10 && forecast.liveNow > 0) {
    out.push({
      kind: 'warn',
      title: 'Offset freshness decay',
      body: `Your decay-weighted score will erode ~${forecast.dropPct}% over the next ${forecast.projDays} days as merges age. Merge new PRs to keep it fresh.`,
    });
  }

  // 3. Closest gate (action) — the single repo nearest to clearing (PR first, then issue).
  const gap = bestRepoGap(rows, 'pr') ?? bestRepoGap(rows, 'issue');
  if (gap) {
    out.push({
      kind: 'action',
      title: `Not yet eligible in ${gap.repo}`,
      body: `Currently ${gap.text} in the trailing 30-day window. Keep merging here (and your credibility up) to clear — or re-clear — this repository's eligibility gate.`,
    });
  }

  // 4. Strongest (strong) — rank by the eligible stream's OSS score (a contribution
  //    metric, so it aligns with the credibility shown and excludes maintainer-cut).
  const ossScore = (r: RepoSignal) => (r.prEligible ? r.prScore : 0) + (r.issueEligible ? r.issueScore : 0);
  const strongest = rows.filter((r) => ossScore(r) > 0).sort((a, b) => ossScore(b) - ossScore(a))[0];
  if (strongest) {
    const cred = strongest.prEligible ? strongest.prCred : strongest.issueCred;
    out.push({
      kind: 'strong',
      title: `Strongest in ${strongest.repo}`,
      body: `${score(ossScore(strongest), 2)} OSS score at ${pct(cred)} credibility. Keep this consistency to maximize earnings.`,
    });
  }

  // 5. Biggest untapped pool (info) — the highest-emission repo the miner isn't eligible
  //    in yet (skipped if it's already the "closest gate" repo shown above).
  const blocked = rows.filter(
    (r) => !r.prEligible && !r.issueEligible && ((r.prs > 0 && r.issueDiscoveryShare < 1) || (r.issues > 0 && r.issueDiscoveryShare > 0)),
  );
  const biggest = [...blocked].sort((a, b) => b.emissionShare - a.emissionShare)[0];
  if (biggest && biggest.emissionShare > 0 && biggest.repo !== gap?.repo) {
    out.push({
      kind: 'info',
      title: `Biggest opportunity: ${biggest.repo}`,
      body: `This repo carries the largest reward pool (${pct(biggest.emissionShare)} of OSS emission) of the repos you're not eligible in yet.`,
    });
  }

  // 6. Coverage (info) — scoped to repos where becoming eligible is achievable and pays.
  const relevant = rows.filter(
    (r) => (r.prs > 0 && r.issueDiscoveryShare < 1) || (r.issues > 0 && r.issueDiscoveryShare > 0),
  );
  const eligibleInRelevant = relevant.filter((r) => r.prEligible || r.issueEligible).length;
  if (relevant.length > 0 && eligibleInRelevant < relevant.length) {
    out.push({
      kind: 'info',
      title: 'Expand eligible coverage',
      body: `Eligible in ${eligibleInRelevant} of ${relevant.length} repositories. Lifting credibility in the rest unlocks more of the network reward pool.`,
    });
  }

  return out.slice(0, 4);
}

/** Stream segments for the emission donut (only non-zero streams). */
function streamSegments(view: MinerView, subnetTao: number) {
  return [
    { key: 'pr', label: 'Pull requests', color: PR_COLOR, tao: view.prTaoShare * subnetTao },
    { key: 'issue', label: 'Issue discovery', color: ISSUE_COLOR, tao: view.issueTaoShare * subnetTao },
    { key: 'maintainer', label: 'Maintainer cut', color: MAINTAINER_COLOR, tao: view.maintainerTaoShare * subnetTao },
  ].filter((s) => s.tao > 0);
}

/** Sidebar status dot — by what the miner actually earns from. */
function statusOf(view: MinerView): { label: string; color: string } {
  const label = eligibilityLabel(view); // 'Dual' | 'PR' | 'Issue' | 'Inactive'
  if (label === 'Dual') return { label: 'Dual', color: 'var(--accent-emphasis)' };
  if (label === 'PR') return { label: 'PR', color: PR_COLOR };
  if (label === 'Issue') return { label: 'Issue', color: ISSUE_COLOR };
  return { label: 'Inactive', color: NEUTRAL_COLOR };
}


function lastActiveIso(works: MinerWorksResponse | undefined): string | null {
  if (!works) return null;
  let best = 0;
  for (const p of works.prs) {
    const t = Date.parse(p.mergedAt ?? p.closedAt ?? p.createdAt ?? '');
    if (Number.isFinite(t) && t > best) best = t;
  }
  for (const i of works.issues) {
    const t = Date.parse(i.createdAt ?? '');
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best > 0 ? new Date(best).toISOString() : null;
}

/** Start of the miner's SN74 working life, for "working age". Each contribution is
 * clamped forward to its repo's gittensor registration date: a repo's GitHub history
 * predates SN74 (repos are often years old before joining), so a PR/issue opened before
 * the repo was registered isn't SN74 work and must not back-date the age. The earliest
 * such clamped date across all contributions is when their SN74 clock started. */
function firstActiveMs(works: MinerWorksResponse | undefined): number | null {
  if (!works) return null;
  let first = Infinity;
  for (const p of works.prs) {
    const t = Date.parse(p.createdAt ?? '');
    if (!Number.isFinite(t)) continue;
    const eff = Math.max(t, repoRegisteredMs(p.repo));
    if (eff < first) first = eff;
  }
  for (const i of works.issues) {
    const t = Date.parse(i.createdAt ?? '');
    if (!Number.isFinite(t)) continue;
    const eff = Math.max(t, repoRegisteredMs(i.repo));
    if (eff < first) first = eff;
  }
  return Number.isFinite(first) ? first : null;
}

/** A creative tenure badge by SN74 working age — recognises how long the miner has been
 * contributing, from first week to subnet veteran. */
function tenureBadge(ageDays: number | null): { label: string; tier: 'new' | 'rookie' | 'regular' | 'veteran' | 'pioneer' } | null {
  if (ageDays == null) return null;
  if (ageDays < 7) return { label: 'Newcomer', tier: 'new' };
  if (ageDays < 30) return { label: 'Rookie', tier: 'rookie' };
  if (ageDays < 90) return { label: 'Regular', tier: 'regular' };
  if (ageDays < 180) return { label: 'Veteran', tier: 'veteran' };
  return { label: 'Pioneer', tier: 'pioneer' };
}

/** Compact relative time with " ago" (sidebar). */
function relTime(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return 'today';
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ─── Activity over time (PR/issue lifecycle, last 30 days) ───────────────────────

/** Decay-weighted earning power over the last 30 days + a 14-day forward projection,
 * for EarningForecastChart. Each merged PR contributes score × freshness-decay and
 * drops out past the 30-day lookback — reconstructed historically, then projected
 * forward (portfolio aging, no new merges). Each day also carries a per-repo
 * breakdown (top contributors + their current emission) for the hover tooltip. */
function buildForecast(prs: MinerPr[] | undefined): ForecastSeries | null {
  const DAY = 86_400_000;
  const HIST = 30;
  const PROJ = 14;
  // Merged, scored PRs grouped by repo (the freshness curve only weights merged work).
  const byRepo = new Map<string, Array<{ t: number; score: number }>>();
  for (const p of prs ?? []) {
    if (p.state !== 'MERGED' || !p.mergedAt || !(p.score > 0)) continue;
    const t = Date.parse(p.mergedAt);
    if (!Number.isFinite(t)) continue;
    const arr = byRepo.get(p.repo);
    if (arr) arr.push({ t, score: p.score });
    else byRepo.set(p.repo, [{ t, score: p.score }]);
  }
  if (byRepo.size === 0) return null;
  const bucketStart = (ts: number) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const now = Date.now();
  const start = bucketStart(now) - (HIST - 1) * DAY;
  const liveScore = (tMs: number, arr: Array<{ t: number; score: number }>) => {
    let s = 0;
    for (const m of arr) {
      if (m.t > tMs) continue;
      const age = (tMs - m.t) / DAY;
      if (age > PR_LOOKBACK_DAYS) continue;
      s += m.score * decayMultiplier(age);
    }
    return s;
  };
  const total = HIST + PROJ;
  const points: ForecastPoint[] = [];
  for (let i = 0; i < total; i++) {
    const t = start + i * DAY;
    const evalT = i === HIST - 1 ? now : t;
    let earned = 0;
    const repos: ForecastRepo[] = [];
    for (const [repo, arr] of byRepo) {
      const sc = liveScore(evalT, arr);
      earned += sc;
      if (sc > 0.005) repos.push({ repo, score: sc });
    }
    repos.sort((a, b) => b.score - a.score);
    points.push({
      label: new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      earned,
      projected: i >= HIST,
      repos: repos.slice(0, 6),
    });
  }
  const liveNow = points[HIST - 1]?.earned ?? 0;
  const liveEnd = points[total - 1]?.earned ?? liveNow;
  const dropPct = liveNow > 0 ? Math.round((1 - liveEnd / liveNow) * 100) : null;
  return { points, nowIdx: HIST - 1, dropPct, projDays: PROJ, liveNow };
}

export default function MinerModal({
  view,
  subnetTao,
  tracked,
  onClose,
  onToggleTrack,
  onPrev,
  onNext,
}: MinerModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [mainTab, setMainTab] = useState<'overview' | 'contributions'>('overview');

  const worksLogin = view?.login ?? '';
  const worksGithubId = view?.githubId ?? '';
  const { data: works, isLoading: worksLoading } = useQuery<MinerWorksResponse>({
    queryKey: ['miner-works', worksLogin, worksGithubId],
    enabled: Boolean(view) && (worksLogin !== '' || worksGithubId !== ''),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (worksLogin) params.set('login', worksLogin);
      if (worksGithubId) params.set('githubId', worksGithubId);
      const r = await fetch(`/api/miner-works?${params.toString()}`, { signal });
      if (!r.ok) throw new Error(`works ${r.status}`);
      return (await r.json()) as MinerWorksResponse;
    },
  });
  // The miner's GitHub profile bio — shown in the sidebar.
  const { data: profile } = useQuery<{
    bio: string | null;
    name: string | null;
    followers: number | null;
    following: number | null;
  }>({
    queryKey: ['github-bio', worksLogin],
    enabled: Boolean(view) && worksLogin !== '',
    staleTime: 6 * 60 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/github-bio?login=${encodeURIComponent(worksLogin)}`, { signal });
      if (!r.ok) return { bio: null, name: null, followers: null, following: null };
      return (await r.json()) as { bio: string | null; name: string | null; followers: number | null; following: number | null };
    },
  });

  // Derived datasets (hooks must run before the early return).
  const activity = works?.activity ?? [];
  const hasActivity = activity.some(
    (p) => p.openedPrs + p.mergedPrs + p.closedPrs + p.openedIssues + p.resolvedIssues > 0,
  );
  const heat = useMemo(() => buildHeatGrid(works?.prs, works?.issues), [works?.prs, works?.issues]);
  // Per-repo emission (τ/day) + contribution score for this miner — feeds the
  // Contributions repo dropdown (keyed by lowercased repo).
  const repoMeta = useMemo(() => {
    const m = new Map<string, { tao: number; score: number }>();
    for (const row of view?.rows ?? []) {
      m.set(row.repo.toLowerCase(), { tao: repoTaoOf(row, subnetTao), score: row.prScore + row.issueScore });
    }
    return m;
  }, [view?.rows, subnetTao]);
  const forecast = useMemo(() => buildForecast(works?.prs), [works?.prs]);
  // Per-repo signal (incl. credibility) keyed by lowercased repo — feeds the
  // Contributions tab's per-repo credibility strip.
  const repoSignalMap = useMemo(() => {
    const m = new Map<string, RepoSignal>();
    for (const row of view?.rows ?? []) m.set(row.repo.toLowerCase(), row);
    return m;
  }, [view?.rows]);

  // Esc closes; ←/→ step between miners — its own effect so the handler always sees the
  // latest callbacks (which the parent re-creates each render) without re-running focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  // Lock body scroll for the modal's lifetime and restore focus to the opener on close.
  // Mount-only ([] deps): must NOT re-run on parent re-renders, or it would steal focus
  // from controls inside the modal and capture the box itself as the "previous" element.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  // Move focus into the dialog when it opens and when stepping to another miner.
  useEffect(() => {
    if (view?.key) boxRef.current?.focus();
  }, [view?.key]);

  // Reset transient UI when switching miners.
  useEffect(() => {
    setMaximized(false);
    setMainTab('overview');
  }, [view?.key]);

  if (!view) return null;

  const status = statusOf(view);
  const segments = streamSegments(view, subnetTao);
  const segTotal = segments.reduce((sum, s) => sum + s.tao, 0) || 1;
  const dominant = [
    { c: PR_COLOR, v: view.prTaoShare },
    { c: ISSUE_COLOR, v: view.issueTaoShare },
    { c: MAINTAINER_COLOR, v: view.maintainerTaoShare },
  ].reduce((a, b) => (b.v > a.v ? b : a));
  const streamColor = dominant.v > 0 ? dominant.c : 'var(--fg-subtle)';

  // Pending = score withheld as collateral on open PRs (20% of their potential,
  // summed across repos), released to the live score as they merge.
  const pendingScore = view.collateralScore;
  // Headline contribution score (PR + issue-discovery) and SN74 working age.
  const totalScore = view.totalScore + view.issueScore;
  const firstMs = firstActiveMs(works);
  const ageDays = firstMs != null ? Math.max(0, Math.floor((Date.now() - firstMs) / 86_400_000)) : null;
  const firstDate =
    firstMs != null ? new Date(firstMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
  const tenure = tenureBadge(ageDays);
  const tenureCls = tenure
    ? tenure.tier === 'new'
      ? styles.mmTenureNew
      : tenure.tier === 'rookie'
        ? styles.mmTenureRookie
        : tenure.tier === 'regular'
          ? styles.mmTenureRegular
          : tenure.tier === 'veteran'
            ? styles.mmTenureVeteran
            : styles.mmTenurePioneer
    : '';
  // Recompute PR-side stats live from the actual PRs (trailing 30-day window) so the
  // insights match the live PR list rather than the lagging scoring snapshot.
  const liveRows = applyLivePrStats(view.rows, works?.prs, Date.now());
  const insights = buildInsights(liveRows, forecast);

  // Heatmap geometry (fixed-size SVG, horizontally scrollable).
  const CELL = 11;
  const STEP = 14;
  const LABEL_W = 24;
  const MONTH_H = 14;
  const hmW = LABEL_W + heat.weeks.length * STEP;
  const hmH = MONTH_H + 7 * STEP;

  return (
    <div className={styles.modalOuter} role="dialog" aria-modal="true" aria-labelledby="mm-title">
      <div className={styles.modalBg} onClick={onClose} />
      <div
        className={`${styles.modalBox} ${styles.modalBoxWide} ${styles.mmShell} ${maximized ? styles.mmShellMax : ''}`}
        ref={boxRef}
        tabIndex={-1}
        style={{ '--mm-stream': streamColor } as React.CSSProperties}
      >
        {/* Tenure ribbon — a diagonal corner banner by SN74 working-age tier. */}
        {tenure ? (
          <div
            className={`${styles.mmRibbon} ${tenureCls}`}
            title={`${tenure.label} — ${ageDays} day${ageDays === 1 ? '' : 's'} contributing to SN74${firstDate ? `, since ${firstDate}` : ''}`}
          >
            <StarFillIcon size={9} />
            {tenure.label}
          </div>
        ) : null}

        {/* ── Top bar ───────────────────────────────────────────────── */}
        <div className={styles.mmTopBar}>
          {onPrev || onNext ? (
            <div className={styles.mmNav}>
              <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous miner" title="Previous (←)">
                <ChevronLeftIcon size={16} />
              </button>
              <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next miner" title="Next (→)">
                <ChevronRightIcon size={16} />
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className={styles.mmTopActions}>
            <button
              type="button"
              className={tracked ? styles.mmTopStarOn : undefined}
              onClick={onToggleTrack}
              aria-pressed={tracked}
              aria-label={tracked ? 'Untrack miner' : 'Track miner'}
              title={tracked ? 'Untrack' : 'Track'}
            >
              {tracked ? <StarFillIcon size={15} /> : <StarIcon size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setMaximized((v) => !v)}
              aria-pressed={maximized}
              aria-label={maximized ? 'Restore size' : 'Maximize'}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? <ScreenNormalIcon size={15} /> : <ScreenFullIcon size={15} />}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)">
              <XIcon size={16} />
            </button>
          </div>
        </div>

        <div className={styles.mmGrid}>
          {/* ===== LEFT SIDEBAR ===== */}
          <aside className={styles.mmSide}>
            <div className={styles.mmSideScroll}>
              <div className={styles.mmSideAvatarWrap}>
                <span className={styles.mmSideAvatarRing} aria-hidden />
                <img className={styles.mmSideAvatar} src={view.avatarUrl} alt={view.login} loading="lazy" />
                <span
                  className={styles.mmSideStatus}
                  style={{ '--dot': status.color } as React.CSSProperties}
                  title={`${status.label} — eligibility`}
                  aria-label={`Status: ${status.label}`}
                />
              </div>

              <div className={styles.mmSideNameRow}>
                <span className={styles.mmSideName} id="mm-title" title={view.login}>
                  {view.login}
                </span>
                <a
                  className={styles.mmSideNameGh}
                  href={`https://github.com/${view.login}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`@${view.login} on GitHub`}
                  aria-label={`@${view.login} on GitHub`}
                >
                  <MarkGithubIcon size={15} />
                </a>
              </div>
              {profile?.bio ? <p className={styles.mmSideBio}>{profile.bio}</p> : null}
              {/* Only when there's real public data — a private profile reports 0/0, which
                  would otherwise render a meaningless "- followers · - following" row. */}
              {profile && ((profile.followers ?? 0) > 0 || (profile.following ?? 0) > 0) ? (
                <div className={styles.mmSideFollow}>
                  <PersonIcon size={12} />
                  <span>
                    <strong>{formatCount(profile.followers ?? 0)}</strong> followers
                  </span>
                  <span className={styles.mmSideFollowSep}>·</span>
                  <span>
                    <strong>{formatCount(profile.following ?? 0)}</strong> following
                  </span>
                </div>
              ) : null}
              <div className={styles.mmSidePoints} title="Actual on-chain emission (matches TaoMarketCap)">
                <ZapIcon size={13} />
                <strong>{fmtTao(view.taoPerDay)}</strong>
                <span className={styles.mmSidePointsUnit}>τ/day</span>
              </div>

              <div className={styles.mmSideDivider} />

              <div className={styles.mmSideGrid}>
                <div className={styles.mmSideCell}>
                  <strong>{formatCount(view.totalPrs, { fallback: '0' })}</strong>
                  <span>PRs</span>
                </div>
                <div className={styles.mmSideCell}>
                  <strong>{formatCount(view.totalIssues, { fallback: '0' })}</strong>
                  <span>Issues</span>
                </div>
                <div className={styles.mmSideCell}>
                  <strong>{formatCount(view.uniqueRepos, { fallback: '0' })}</strong>
                  <span>Repos</span>
                </div>
              </div>

              <dl className={styles.mmSideStats}>
                <div className={styles.mmSideStat} title="Contribution score — merged-PR score + issue-discovery score, summed across repos.">
                  <dt>Total score</dt>
                  <dd className={styles.mmMono}>{score(totalScore, 2)}</dd>
                </div>
                {pendingScore > 0.005 ? (
                  <div
                    className={styles.mmSideStat}
                    title={`Score held as collateral on ${view.prOpen} open PR${view.prOpen === 1 ? '' : 's'} (20% of their potential) — released to the live score as they merge.`}
                  >
                    <dt>Pending score</dt>
                    <dd className={`${styles.mmMono} ${styles.mmSidePos}`}>+{formatNumber(pendingScore, { digits: 2, fallback: '0' })}</dd>
                  </div>
                ) : null}
                <div className={styles.mmSideStat}>
                  <dt>UID</dt>
                  <dd className={styles.mmMono}>{view.uid ?? '—'}</dd>
                </div>
                {view.isMaintainer ? (
                  <div className={styles.mmSideStat}>
                    <dt>Maintainer cut</dt>
                    <dd className={styles.mmMono}>{pct(view.maintainerCut)}</dd>
                  </div>
                ) : null}
                <div
                  className={styles.mmSideStat}
                  title={firstDate ? `Earning SN74 rewards since ${firstDate} (capped at each repo's gittensor registration)` : undefined}
                >
                  <dt>Working age</dt>
                  <dd className={styles.mmMono}>
                    {worksLoading && !works ? (
                      <span className="gt-skeleton" style={{ display: 'inline-block', width: 44, height: 11, borderRadius: 4 }} />
                    ) : ageDays != null ? (
                      `${formatCount(ageDays, { fallback: '0' })} day${ageDays === 1 ? '' : 's'}`
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div className={styles.mmSideStat}>
                  <dt>Last active</dt>
                  <dd>
                    {worksLoading && !works ? (
                      <span className="gt-skeleton" style={{ display: 'inline-block', width: 44, height: 11, borderRadius: 4 }} />
                    ) : (
                      relTime(lastActiveIso(works))
                    )}
                  </dd>
                </div>
              </dl>

            </div>
          </aside>

          {/* ===== RIGHT MAIN ===== */}
          <div className={styles.mmMain}>
            {view.failedReason ? <div className={styles.mmFailed}>{view.failedReason}</div> : null}

            <div className={styles.mmMainTabs} role="tablist" aria-label="Detail sections">
              {(
                [
                  ['overview', 'Overview'],
                  ['contributions', 'Contributions'],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={mainTab === k}
                  className={`${styles.mmMainTab} ${mainTab === k ? styles.mmMainTabOn : ''}`}
                  onClick={() => setMainTab(k)}
                >
                  {l}
                </button>
              ))}
            </div>

            {mainTab === 'overview' ? (
              <>
            {/* Insights & next actions (derived from per-repo signals) — no card frame;
                the rows are their own cards, so an outer card would just double-nest. */}
            {insights.length > 0 ? (
              <section>
                <div className={styles.mmCardHead}>
                  <h3 className={styles.mmCardTitle}>
                    <LightBulbIcon size={14} /> Insights &amp; next actions
                  </h3>
                </div>
                <div className={styles.mmInsights}>
                  {insights.map((ins, i) => {
                    const Icon =
                      ins.kind === 'strong'
                        ? CheckCircleIcon
                        : ins.kind === 'warn'
                          ? AlertIcon
                          : ins.kind === 'action'
                            ? LockIcon
                            : LightBulbIcon;
                    const kindClass =
                      ins.kind === 'strong'
                        ? styles.mmInsightStrong
                        : ins.kind === 'warn'
                          ? styles.mmInsightWarn
                          : ins.kind === 'action'
                            ? styles.mmInsightAction
                            : styles.mmInsightInfo;
                    return (
                      <div key={i} className={`${styles.mmInsight} ${kindClass}`}>
                        <span className={styles.mmInsightIcon}>
                          <Icon size={15} />
                        </span>
                        <div className={styles.mmInsightText}>
                          <div className={styles.mmInsightTitle}>{ins.title}</div>
                          <div className={styles.mmInsightBody}>{ins.body}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {/* CARD 1 — Activity (PRs / issues / score over the range) */}
            <section className={styles.mmCard}>
              <div className={styles.mmCardHead}>
                <h3 className={styles.mmCardTitle}>
                  <GraphIcon size={14} /> Activity
                  <span
                    className={styles.mmInfo}
                    title="Pull requests, issues and score over the selected range — PRs/score bucketed by merge date, issues by creation date."
                  >
                    <InfoIcon size={12} />
                  </span>
                </h3>
                <span className={styles.mmSectionCount}>Last 30 days</span>
              </div>

              {worksLoading && !works ? (
                <div className={styles.mmTlEmpty}>Loading activity…</div>
              ) : !hasActivity ? (
                <div className={styles.mmTlEmpty}>No activity in this range.</div>
              ) : (
                <ActivityLineChart points={activity} />
              )}
            </section>

            {/* CARD 1b — Earning-power decay forecast */}
            <section className={styles.mmCard}>
              <div className={styles.mmCardHead}>
                <h3 className={styles.mmCardTitle}>
                  <ZapIcon size={14} /> Decay-weighted score
                  <span
                    className={styles.mmInfo}
                    title="Your live score after time decay: each merged PR's score eroded by the freshness curve (−50% by day 10) and dropped after 30 days, summed across repos. Solid = the last 30 days; dashed past 'now' = the forward projection if no new PRs merge."
                  >
                    <InfoIcon size={12} />
                  </span>
                </h3>
                <span className={styles.mmSectionCount}>30d + 14d forecast</span>
              </div>

              {worksLoading && !works ? (
                <div className={styles.mmTlEmpty}>Loading forecast…</div>
              ) : !forecast ? (
                <div className={styles.mmTlEmpty}>No merged PRs to forecast.</div>
              ) : (
                <EarningForecastChart series={forecast} />
              )}
            </section>

            {/* CARDS 2 + 3 — heatmap + emission */}
            <div className={styles.mmBottomRow}>
              {/* CARD 3 — Repository activity heatmap */}
              <section className={styles.mmCard}>
                <div className={styles.mmCardHead}>
                  <h3 className={styles.mmCardTitle}>
                    <CalendarIcon size={14} /> Repository activity
                  </h3>
                  <span className={styles.mmSectionCount}>{formatCount(heat.total, { fallback: '0' })} events</span>
                </div>
                {worksLoading && !works ? (
                  <div className="gt-skeleton" style={{ height: 112, borderRadius: 8 }} aria-hidden />
                ) : heat.empty ? (
                  <div className={styles.mmEmpty}>No activity in the last 26 weeks.</div>
                ) : (
                  <>
                    <div className={styles.mmHeatScroll}>
                      <svg
                        className={styles.mmHeatSvg}
                        viewBox={`0 0 ${hmW} ${hmH}`}
                        preserveAspectRatio="xMinYMid meet"
                        style={{ maxWidth: hmW }}
                        role="img"
                        aria-label="Activity heatmap"
                      >
                        {heat.monthTicks.map((m) => (
                          <text key={`${m.col}-${m.label}`} x={LABEL_W + m.col * STEP} y={9} style={{ fill: 'var(--fg-subtle)' }} fontSize={9}>
                            {m.label}
                          </text>
                        ))}
                        {[0, 2, 4].map((row) => (
                          <text key={row} x={0} y={MONTH_H + row * STEP + 9} style={{ fill: 'var(--fg-subtle)', fontFamily: 'var(--mono)' }} fontSize={8.5}>
                            {heat.weekdayLabels[row]}
                          </text>
                        ))}
                        {heat.weeks.map((col, ci) =>
                          col.map((cell, ri) =>
                            cell.pad ? null : (
                              <rect
                                key={`${ci}-${ri}`}
                                x={LABEL_W + ci * STEP}
                                y={MONTH_H + ri * STEP}
                                width={CELL}
                                height={CELL}
                                rx={2.5}
                                style={{ fill: heatFill(cell.level) }}
                              >
                                <title>{`${cell.date}: ${cell.count} event${cell.count === 1 ? '' : 's'}`}</title>
                              </rect>
                            ),
                          ),
                        )}
                      </svg>
                    </div>
                    <div className={styles.mmHeatLegend}>
                      Less
                      {[0, 1, 2, 3, 4].map((l) => (
                        <span key={l} className={styles.mmHeatSwatch} style={{ background: heatFill(l) }} />
                      ))}
                      More
                    </div>
                  </>
                )}
              </section>

              {/* CARD 4 — Emission & reward streams */}
              <section className={`${styles.mmCard} ${styles.mmStreamsCard}`}>
                <div className={styles.mmCardHead}>
                  <h3 className={styles.mmCardTitle}>
                    <ZapIcon size={14} /> Emission &amp; reward streams
                  </h3>
                  <span
                    className={styles.mmStreamsTag}
                    style={{ color: streamColor, borderColor: `color-mix(in srgb, ${streamColor} 45%, transparent)` }}
                  >
                    {eligibilityLabel(view)}
                  </span>
                </div>

                <div className={styles.mmStreamsGrid}>
                  <svg className={styles.mmDonut} viewBox="0 0 100 100" aria-hidden>
                    <circle cx={50} cy={50} r={44} fill="none" strokeWidth={13} style={{ stroke: 'var(--soft-fill)' }} />
                    {segments.length > 0 ? (
                      <g transform="rotate(-90 50 50)">
                        {(() => {
                          const circ = 2 * Math.PI * 44;
                          let acc = 0;
                          return segments.map((s) => {
                            const len = (s.tao / segTotal) * circ;
                            const node = (
                              <circle
                                key={s.key}
                                cx={50}
                                cy={50}
                                r={44}
                                fill="none"
                                strokeWidth={13}
                                style={{ stroke: s.color }}
                                strokeDasharray={`${len} ${circ - len}`}
                                strokeDashoffset={-acc}
                              />
                            );
                            acc += len;
                            return node;
                          });
                        })()}
                      </g>
                    ) : null}
                    <text className={styles.mmDonutHole} x={50} y={48} textAnchor="middle">
                      {fmtTao(view.taoPerDay)}
                    </text>
                    <text className={styles.mmDonutUnit} x={50} y={61} textAnchor="middle">
                      τ/day
                    </text>
                  </svg>
                  <div className={styles.mmLegend}>
                    {segments.map((s) => (
                      <div key={s.key} className={styles.mmLegendRow}>
                        <span className={styles.mmSwatch} style={{ background: s.color }} />
                        <span className={styles.mmLegendLabel}>{s.label}</span>
                        <span className={styles.mmLegendTao}>{fmtTao(s.tao)} τ/d</span>
                        <span className={styles.mmLegendPct}>{Math.round((s.tao / segTotal) * 100)}%</span>
                      </div>
                    ))}
                    {segments.length === 0 ? <div className={styles.mmMuted}>No active reward stream.</div> : null}
                  </div>
                </div>
              </section>
            </div>
              </>
            ) : (
              <PrsIssuesTable
                prs={works?.prs}
                issues={works?.issues}
                loading={worksLoading}
                login={view.login}
                repoMeta={repoMeta}
                repoSignals={repoSignalMap}
                maintainerRepos={view.maintainerRepos}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
