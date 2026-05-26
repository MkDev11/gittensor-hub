/* Reward-math helpers for the repositories page.
 *
 * Ported from the in-repo prototype at `repositories.html` and adapted to the
 * live data shapes (`Sn74Repo` from /api/sn74-repos + `GtRepo` from
 * /api/gt/repositories). The HTML used hardcoded sample data; here we plug
 * the same formulas into the merged `RepoRow` so the UI numbers reflect what
 * the validator pool will actually emit. */

import type { GtRepo } from '@/types/entities';
import type { Sn74Repo } from '@/lib/repos';

export const OSS_POOL = 0.9;
export const TREASURY_PCT = 0.1;

/* The HTML's CONFIGURED constant captured the share that's actually allocated
 * to OSS repositories (after recycle slack). We derive it dynamically from
 * the merged rows so the recycle-vs-claimable split reflects live data. */

export type StrategyKey = 'none' | 'bug' | 'enhancement' | 'feature' | 'refactor' | 'issue';

export interface RepoRow {
  fullName: string;
  owner: string;
  name: string;
  policy: Sn74Repo | null;
  stats: GtRepo | null;
  /** Emission share (0..1) — fraction of the OSS pool allocated to this repo. */
  share: number;
  /** Issue-discovery split (0..1) — the rest goes to PR stream. */
  issue: number;
  /** Maintainer cut taken off the top before the PR/issue split. */
  maintCut: number;
  trusted: boolean;
  maintainerCount: number;
  /** Whether the maintainer cut value is a placeholder vs. validator-set. */
  demoMaint: boolean;
  labels: Record<string, number> | null;
  defaultLabel: number;
  /** Custom eligibility overrides — null means use protocol defaults. */
  eligibility: Record<string, number> | null;
  fixedBase: number | null;
  /** Whether this repo is the user's "self" repo (highlighted across the UI). */
  isSelf: boolean;
  /** Activity stats, sourced from `GtRepo`. */
  activity: {
    merged30d: number;
    closed30d: number;
    /** Live count of currently-open PRs at the repo (lifetime — could
     *  include PRs older than 30 days). From /api/repos/metadata. */
    openPRs: number;
    /** Subset of openPRs that were created in the last 30 days. Used in
     *  the activity card to stay window-consistent with merged/closed. */
    openPRs30d: number;
    contribs: number;
    /** Daily PR-creation sparkline values (oldest first, 30 buckets). */
    spark: number[];
    /** Daily issue-discovery sparkline values (oldest first, 30 buckets).
     *  Stacked under `spark` in the Contributions chart so each daily
     *  bar shows PR submissions on top and issue submissions on bottom. */
    sparkIssues: number[];
    /** Median PR merge time in hours, when known. */
    medianMergeHours: number | null;
    /** Count of PRs the current user has open at this repo. */
    userOpenPRs: number;
  };
  /** Top languages as [name, percentage] pairs, sorted desc by share. */
  langs: Array<[string, number]>;
  description: string;
  isActive: boolean;
  inactiveAt: string | null;
}

/* =========== TAO emission helpers =========== */

/** Per-repo daily TAO — the full slice that flows into the repo before any internal split. */
export function repoDailyTAO(repo: RepoRow, subnetTAO: number): number {
  return subnetTAO * repo.share * OSS_POOL;
}

/** TAO cut off the top for registered maintainers, before PR/issue split. */
export function repoMaintainerTAO(repo: RepoRow, subnetTAO: number): number {
  return repoDailyTAO(repo, subnetTAO) * (repo.maintCut || 0);
}

/** TAO per registered maintainer (the cut split evenly). */
export function repoPerMaintainerTAO(repo: RepoRow, subnetTAO: number): number {
  const cut = repo.maintCut || 0;
  const n = repo.maintainerCount || 0;
  if (cut === 0 || n === 0) return 0;
  return repoMaintainerTAO(repo, subnetTAO) / n;
}

/** TAO available to non-maintainer PR miners (after the cut). */
export function repoPRTAO(repo: RepoRow, subnetTAO: number): number {
  const afterCut = 1 - (repo.maintCut || 0);
  return repoDailyTAO(repo, subnetTAO) * afterCut * (1 - repo.issue);
}

/** TAO available to issue-discovery miners (after the cut). */
export function repoIssueTAO(repo: RepoRow, subnetTAO: number): number {
  const afterCut = 1 - (repo.maintCut || 0);
  return repoDailyTAO(repo, subnetTAO) * afterCut * repo.issue;
}

/* =========== Strategy / label helpers =========== */

export function effectiveLabelMult(repo: RepoRow, strategy: StrategyKey): number {
  if (strategy === 'none') return 1;
  if (strategy === 'issue') return repo.issue > 0 ? repo.issue : 0;
  if (!repo.labels) return repo.defaultLabel;
  return repo.labels[strategy] ?? repo.defaultLabel;
}

/** Reward signal a contributor PR-miner could earn at full saturation.
 *  Excludes the maintainer cut (that's locked to registered maintainers). */
export function rewardSignal(repo: RepoRow, strategy: StrategyKey): number {
  const afterCut = repo.share * OSS_POOL * (1 - (repo.maintCut || 0));
  if (strategy === 'issue') return afterCut * repo.issue;
  if (strategy === 'none') return afterCut;
  const prSlice = afterCut * (1 - repo.issue);
  return prSlice * effectiveLabelMult(repo, strategy);
}

/* =========== Number formatting =========== */

export function formatTAO(n: number): string {
  if (n === 0) return '0';
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toFixed(4);
}

/* =========== Decision helpers (used in compare modal) =========== */

export interface LevelBadge {
  label: string;
  color: string;
  desc: string;
}

export function competitionLevel(repo: RepoRow): LevelBadge {
  const n = repo.activity.contribs || 0;
  if (n >= 20) return { label: 'crowded',  color: '#c5503a', desc: `${n} active contributors` };
  if (n >= 10) return { label: 'busy',     color: '#eab308', desc: `${n} active contributors` };
  if (n >= 5)  return { label: 'moderate', color: '#86efac', desc: `${n} active contributors` };
  if (n >= 1)  return { label: 'quiet',    color: '#22c55e', desc: `${n} active contributors` };
  return         { label: 'empty',    color: '#62666d', desc: 'no recent activity' };
}

export function mergeSpeedLevel(repo: RepoRow): LevelBadge {
  const h = repo.activity.medianMergeHours;
  if (h == null) return { label: 'unknown',   color: '#62666d', desc: '—' };
  if (h <= 12)   return { label: 'very fast', color: '#22c55e', desc: `~${h}h median` };
  if (h <= 24)   return { label: 'fast',      color: '#86efac', desc: `~${h}h median` };
  if (h <= 48)   return { label: 'normal',    color: '#9eb872', desc: `~${h}h median` };
  if (h <= 96)   return { label: 'slow',      color: '#eab308', desc: `~${Math.round(h / 24)}d median` };
  return           { label: 'very slow', color: '#c5503a', desc: `~${Math.round(h / 24)}d median` };
}

export interface EligibilityRisk {
  level: 'safe' | 'low-volume' | 'borderline' | 'risky';
  color: string;
  text: string;
}

export function eligibilityRisk(repo: RepoRow): EligibilityRisk {
  const merged = repo.activity.merged30d || 0;
  const closed = repo.activity.closed30d || 0;
  const repoCred = merged + closed > 0 ? merged / (merged + closed) : 0;
  if (repoCred < 0.7) {
    return {
      level: 'risky',
      color: '#c5503a',
      text: `Repo merges only ${(repoCred * 100).toFixed(0)}% of PRs. Submitting here hurts your credibility if your PR gets closed.`,
    };
  }
  if (repoCred < 0.8) {
    return {
      level: 'borderline',
      color: '#eab308',
      text: `Repo merge rate ${(repoCred * 100).toFixed(0)}% — under the 0.80 mark you need on your own miner credibility. Contributing here is borderline.`,
    };
  }
  if (merged < 3) {
    return {
      level: 'low-volume',
      color: '#9eb872',
      text: `Only ${merged} merged PRs in the last 30 days. Hard to build the 3-merge minimum from this repo alone.`,
    };
  }
  return {
    level: 'safe',
    color: '#22c55e',
    text: `${(repoCred * 100).toFixed(0)}% merge rate across ${merged + closed} PRs resolved in the last 30 days. Solid pick for building credibility.`,
  };
}

export interface OpenSlotPressure {
  label: string;
  color: string;
  text: string;
}

export function openSlotPressure(repo: RepoRow): OpenSlotPressure {
  const userOpen = repo.activity.userOpenPRs || 0;
  const THRESHOLD = 2;
  if (userOpen === 0) {
    return { color: '#22c55e', label: 'clear', text: 'You have 0 open PRs here. No penalty yet.' };
  }
  if (userOpen < THRESHOLD) {
    return { color: '#86efac', label: 'fine', text: `${userOpen} of your PRs open here. Under the ${THRESHOLD}-PR base threshold.` };
  }
  if (userOpen === THRESHOLD) {
    return { color: '#eab308', label: 'at limit', text: `${userOpen} open PRs — at the base threshold. Next PR triggers the density penalty.` };
  }
  return {
    color: '#c5503a',
    label: 'penalty active',
    text: `${userOpen} open PRs — over the ${THRESHOLD}-PR threshold. Active penalty on every new PR until you close some.`,
  };
}

/** Per-PR yield estimate (rough). Uses the API's recent 14-day window
 *  (`prsThisWeek + prsLastWeek`) for the denominator — dividing the daily
 *  pool by lifetime merges would massively under-estimate the per-PR
 *  yield on old repos (months of merges absorbing one day of emission).
 *  Returns 0 when there's no recent data to estimate from. */
export function expectedTAOPerPR(repo: RepoRow, strategy: StrategyKey, subnetTAO: number): number {
  if (repo.share === 0) return 0;
  const prPoolPerDay = repoPRTAO(repo, subnetTAO);
  const recentPRs = (repo.stats?.prsThisWeek ?? 0) + (repo.stats?.prsLastWeek ?? 0);
  if (recentPRs === 0) return 0;
  const merged = repo.activity.merged30d || 0;
  const closed = repo.activity.closed30d || 0;
  const mergeRate = merged + closed > 0 ? merged / (merged + closed) : 0.5;
  const recentMerges = Math.max(1, recentPRs * mergeRate);
  const taoPerAvgMerge = (prPoolPerDay * 14) / recentMerges;
  if (strategy !== 'none' && strategy !== 'issue') {
    return taoPerAvgMerge * effectiveLabelMult(repo, strategy);
  }
  return taoPerAvgMerge;
}

export function decisionScore(repo: RepoRow, strategy: StrategyKey, subnetTAO: number): number {
  if (repo.share === 0) return 0;
  const expected = expectedTAOPerPR(repo, strategy, subnetTAO);
  const speed = repo.activity.medianMergeHours || 100;
  const speedFactor = Math.max(0.3, Math.min(1.2, 24 / speed));
  const merged = repo.activity.merged30d || 0;
  const closed = repo.activity.closed30d || 0;
  const cred = merged / Math.max(1, merged + closed);
  const credFactor = cred >= 0.8 ? 1.0 : cred >= 0.7 ? 0.7 : 0.4;
  const userOpen = repo.activity.userOpenPRs || 0;
  const slotFactor = userOpen <= 2 ? 1.0 : 0.6;
  return expected * speedFactor * credFactor * slotFactor;
}

/* =========== Repo-fill colors (used in market bar, treemap, leaderboard) =========== */

/* Market-bar / treemap segment colors. Pure-stream repos are flat
 * solid fills. Mixed-stream repos use a hard-stop linear-gradient
 * (both stops at the same percentage → no smooth fade) so the
 * segment reads as two solid bands whose widths are proportional to
 * the repo's PR vs issue-discovery share. */

/** Pick a fill style for a repo. */
export function repoFill(r: RepoRow): string {
  if (r.share === 0) return 'var(--bg-emphasis)';
  if (r.issue === 1) return 'var(--color-stream-issue)';
  if (r.issue === 0) return 'var(--color-stream-pr)';
  // Hard-stop split: same percent on both stops means a sharp boundary
  // rather than a fade. Left band (0% → split%) is the PR share, right
  // band (split% → 100%) is the issue-discovery share.
  const split = ((1 - r.issue) * 100).toFixed(1);
  return `linear-gradient(to right, var(--color-stream-pr) 0%, var(--color-stream-pr) ${split}%, var(--color-stream-issue) ${split}%, var(--color-stream-issue) 100%)`;
}

/** Solid color version (mini stream pills need a single color, not gradient). */
export function repoSolid(r: RepoRow): string {
  if (r.share === 0) return 'var(--bg-emphasis)';
  if (r.issue === 1) return 'var(--color-stream-issue)';
  if (r.issue === 0) return 'var(--color-stream-pr)';
  return 'var(--color-enh)';
}
