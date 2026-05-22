import type React from 'react';
import type { Miner, MinerView, Mode } from './types';

export function num(v: unknown): number {
  let n: number;
  if (typeof v === 'string') {
    n = parseFloat(v);
  } else if (typeof v === 'number') {
    n = v;
  } else {
    n = 0;
  }
  if (!Number.isFinite(n)) return 0;
  return n;
}

export function ghKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase();
}

export function ghName(m: Pick<Miner, 'githubUsername' | 'uid'>): string {
  return m.githubUsername || `uid-${m.uid}`;
}

export function ghAvatar(m: Pick<Miner, 'githubUsername' | 'uid'>, size: number): string {
  return `https://github.com/${ghName(m)}.png?size=${size}`;
}

export function splitEarnings(
  usdPerDay: number,
  ossScore: number,
  issueScore: number,
  ossEligible: boolean,
  issueEligible: boolean,
): { oss: number; disc: number } {
  const combined = ossScore + issueScore;
  let ossShare = 0;
  let discShare = 0;
  if (ossEligible && issueEligible) {
    ossShare = combined > 0 ? ossScore / combined : 0.5;
    discShare = 1 - ossShare;
  } else if (ossEligible) {
    ossShare = 1;
  } else if (issueEligible) {
    discShare = 1;
  }
  return { oss: usdPerDay * ossShare, disc: usdPerDay * discShare };
}

function acceptanceRate(positive: number, closed: number): number {
  const denom = positive + closed;
  if (denom <= 0) return 0;
  return positive / denom;
}

export function viewOf(m: Miner, mode: Mode): MinerView {
  const ossScore = num(m.totalScore);
  const issueScore = num(m.issueDiscoveryScore);
  const { oss: ossUsd, disc: discUsd } = splitEarnings(
    num(m.usdPerDay), ossScore, issueScore, !!m.isEligible, !!m.isIssueEligible,
  );

  const ossEligible = !!m.isEligible;
  const issueEligible = !!m.isIssueEligible;
  const combinedScore = ossScore + issueScore;

  const merged = m.totalMergedPrs ?? 0;
  const closedPr = m.totalClosedPrs ?? 0;
  const solved = m.totalSolvedIssues ?? 0;
  const closedIssue = m.totalClosedIssues ?? 0;
  const ossCred = acceptanceRate(merged, closedPr);
  const issueCred = acceptanceRate(solved, closedIssue);

  if (mode === 'discovery') {
    return {
      mode,
      score: issueScore,
      cred: issueCred,
      eligible: issueEligible,
      usd: discUsd,
      counts: {
        primaryLabel: 'Solved',
        primary: solved,
        open: m.totalOpenIssues ?? 0,
        closed: closedIssue,
      },
    };
  }
  if (mode === 'oss') {
    return {
      mode,
      score: ossScore,
      cred: ossCred,
      eligible: ossEligible,
      usd: ossUsd,
      counts: {
        primaryLabel: 'Merged',
        primary: merged,
        open: m.totalOpenPrs ?? 0,
        closed: closedPr,
      },
    };
  }
  const combinedCred = acceptanceRate(merged + solved, closedPr + closedIssue);
  return {
    mode,
    score: combinedScore,
    cred: combinedCred,
    eligible: ossEligible || issueEligible,
    usd: ossUsd + discUsd,
    counts: {
      primaryLabel: 'Done',
      primary: merged + solved,
      open: (m.totalOpenPrs ?? 0) + (m.totalOpenIssues ?? 0),
      closed: closedPr + closedIssue,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function credColor(_v: number): string {
  return 'var(--fg-default)';
}

export interface MinerCounts {
  merged: number;
  solved: number;
  closedTotal: number;
}

export interface MinerCredibility {
  rate: number;
  pct: number;
  denom: number;
}

export interface MinerRowSummary {
  ossScore: number;
  discScore: number;
  combinedScore: number;
  combinedUsd: number;
  counts: MinerCounts;
  credibility: MinerCredibility;
  lastActiveIso: string | null;
}

export function countsFor(m: Miner): MinerCounts {
  return {
    merged: m.totalMergedPrs ?? 0,
    solved: m.totalSolvedIssues ?? 0,
    closedTotal: (m.totalClosedPrs ?? 0) + (m.totalClosedIssues ?? 0),
  };
}

export function credibilityFor(counts: MinerCounts): MinerCredibility {
  const denom = counts.merged + counts.solved + counts.closedTotal;
  let rate = 0;
  if (denom > 0) {
    rate = (counts.merged + counts.solved) / denom;
  }
  return { rate, pct: clampedPct(rate), denom };
}

export function validMergedCount(m: Pick<Miner, 'totalValidMergedPrs' | 'totalMergedPrs'>): number {
  return m.totalValidMergedPrs ?? m.totalMergedPrs ?? 0;
}

export function combinedScore(m: Pick<Miner, 'totalScore' | 'issueDiscoveryScore'>): number {
  return num(m.totalScore) + num(m.issueDiscoveryScore);
}

export interface EligibilityFlags {
  isEligible?: boolean | null;
  isIssueEligible?: boolean | null;
}

export function isDualEligible(m: EligibilityFlags): boolean {
  return !!m.isEligible && !!m.isIssueEligible;
}

export function isAnyEligible(m: EligibilityFlags): boolean {
  return !!m.isEligible || !!m.isIssueEligible;
}

export function latestActivity(m: Pick<Miner, 'lastOssActivityAt' | 'lastDiscoveryActivityAt'>): string | null {
  const a = m.lastOssActivityAt ?? null;
  const b = m.lastDiscoveryActivityAt ?? null;
  if (a && b) return a > b ? a : b;
  return a ?? b ?? null;
}

export function ratePct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

export function ratePctOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

export function blendedCredibility(
  ossScore: number,
  ossCred: number,
  discScore: number,
  discCred: number,
): number {
  const total = ossScore + discScore;
  if (total > 0) {
    return (ossScore * ossCred + discScore * discCred) / total;
  }
  return (ossCred + discCred) / 2;
}

export function clampedPct(fraction: number): number {
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}


export function stopPropagation(e: React.MouseEvent<HTMLElement>): void {
  e.stopPropagation();
}

export function summarizeRow(m: Miner): MinerRowSummary {
  const ossScore = viewOf(m, 'oss').score;
  const discScore = viewOf(m, 'discovery').score;
  const counts = countsFor(m);
  return {
    ossScore,
    discScore,
    combinedScore: ossScore + discScore,
    combinedUsd: num(m.usdPerDay),
    counts,
    credibility: credibilityFor(counts),
    lastActiveIso: latestActivity(m),
  };
}
