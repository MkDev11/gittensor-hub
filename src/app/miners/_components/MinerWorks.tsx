'use client';

/* eslint-disable @next/next/no-img-element */

/* The "all works" lists for the miner detail modal: every repo the miner has a
 * signal on, their scored pull requests, and their issues. Presentational only —
 * the modal owns the tab state and the works fetch. */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueOpenedIcon,
  LinkExternalIcon,
  XCircleIcon,
} from '@primer/octicons-react';
import { formatCount, formatNumber, formatRelativeTime, isRecent } from '@/lib/format';
import { IssueLabels } from '@/components/IssueLabels';
import styles from '../page.module.css';
import type { MinerIssue, MinerPr } from '@/types/entities';
import {
  isBlockedContribution,
  repoEarnsIssueDiscovery,
  repoEarnsPr,
  repoTaoOf,
  score as fmtScore,
  type MinerView,
  type RepoSignal,
} from '../_lib/miners';
import { ISSUE_COLOR, MAINTAINER_COLOR, PR_COLOR } from '../_lib/streams';
import { RepoRingAvatar } from './shared';

const fmtTao = (n: number) => formatNumber(n, { digits: 3, fallback: '0' });

/** Compact relative time. Client-only (the modal never SSRs), so Date.now() here
 *  can't cause a hydration mismatch. */
function relTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return 'today';
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function repoAvatar(repo: string): string {
  return `https://github.com/${encodeURIComponent(repo.split('/')[0])}.png?size=40`;
}

/** Skeleton placeholder rows while works load. */
function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.mmWorkList} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.mmWorkRow}>
          <span className="gt-skeleton" style={{ width: 16, height: 16, borderRadius: 4, flex: '0 0 auto' }} />
          <span className="gt-skeleton" style={{ width: `${40 + ((i * 13) % 45)}%`, height: 12, borderRadius: 4 }} />
          <span className="gt-skeleton" style={{ width: 60, height: 12, borderRadius: 4, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

function FilterChips<T extends string>({
  options,
  active,
  onChange,
}: {
  options: Array<{ key: T; label: string; n?: number }>;
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className={styles.mmChips} role="tablist" aria-label="Filter">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`${styles.mmChip} ${active === o.key ? styles.mmChipOn : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
          {o.n != null ? <span className={styles.mmChipN}>{formatCount(o.n, { fallback: '0' })}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ─── Repositories ──────────────────────────────────────────────────────────────

type RepoRole = { label: string; color: string };

function repoRole(view: MinerView, row: RepoSignal): RepoRole {
  const maintained = view.maintainerRepos.some((r) => r.toLowerCase() === row.repo.toLowerCase());
  if (maintained) return { label: 'Maintainer', color: MAINTAINER_COLOR };
  if (repoEarnsIssueDiscovery(row)) return { label: 'Issue discovery', color: ISSUE_COLOR };
  if (repoEarnsPr(row)) return { label: 'Earning', color: PR_COLOR };
  if (isBlockedContribution(row, false)) return { label: 'Working toward', color: 'var(--attention-fg)' };
  return { label: 'Contributing', color: 'var(--fg-subtle)' };
}

export function RepoWorkList({ view, subnetTao }: { view: MinerView; subnetTao: number }) {
  const rows = [...view.rows].sort(
    (a, b) => repoTaoOf(b, subnetTao) - repoTaoOf(a, subnetTao) || b.prScore + b.issueScore - (a.prScore + a.issueScore),
  );
  if (rows.length === 0) return <div className={styles.mmEmpty}>No repo activity in the feed.</div>;
  return (
    <div className={styles.mmWorkList}>
      {rows.map((row) => {
        const role = repoRole(view, row);
        const tao = repoTaoOf(row, subnetTao);
        const contribScore = row.prScore + row.issueScore;
        return (
          <a
            key={row.repo}
            className={styles.mmRepoRow}
            style={{ '--row-accent': role.color } as React.CSSProperties}
            href={`https://github.com/${row.repo}`}
            target="_blank"
            rel="noreferrer"
            title={row.repo}
          >
            <img className={styles.mmRepoAvatar} src={repoAvatar(row.repo)} alt="" loading="lazy" />
            <div className={styles.mmRepoBody}>
              <div className={styles.mmRepoTop}>
                <span className={styles.mmRepoName}>{row.repo}</span>
                <span className={styles.mmRoleChip} style={{ color: role.color, borderColor: `color-mix(in srgb, ${role.color} 45%, transparent)` }}>
                  {role.label}
                </span>
              </div>
              <div className={styles.mmRepoMeta}>
                <span title="Pull requests">
                  <GitPullRequestIcon size={11} />
                  {formatCount(row.prs, { fallback: '0' })}
                </span>
                <span title="Issues">
                  <IssueOpenedIcon size={11} />
                  {formatCount(row.issues, { fallback: '0' })}
                </span>
                {contribScore > 0 ? <span title="Contribution score">score {fmtScore(contribScore)}</span> : null}
              </div>
            </div>
            <span className={styles.mmRepoTao}>{tao > 0 ? `${fmtTao(tao)} τ/d` : '—'}</span>
          </a>
        );
      })}
    </div>
  );
}

// ─── Pull requests ──────────────────────────────────────────────────────────────

const PR_STATE: Record<MinerPr['state'], { Icon: typeof GitMergeIcon; color: string }> = {
  MERGED: { Icon: GitMergeIcon, color: 'var(--done-fg)' },
  OPEN: { Icon: GitPullRequestIcon, color: 'var(--success-fg)' },
  CLOSED: { Icon: GitPullRequestClosedIcon, color: 'var(--danger-fg)' },
};

export function PrWorkList({
  prs,
  counts,
  loading,
}: {
  prs: MinerPr[] | undefined;
  counts: { prs: number; prMerged: number; prOpen: number; prClosed: number } | undefined;
  loading: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'MERGED' | 'OPEN' | 'CLOSED'>('all');
  if (loading && !prs) return <RowsSkeleton />;
  const list = prs ?? [];
  if (list.length === 0) return <div className={styles.mmEmpty}>No scored pull requests found.</div>;
  const shown = filter === 'all' ? list : list.filter((p) => p.state === filter);
  return (
    <>
      <FilterChips
        active={filter}
        onChange={setFilter}
        options={[
          { key: 'all', label: 'All', n: counts?.prs },
          { key: 'MERGED', label: 'Merged', n: counts?.prMerged },
          { key: 'OPEN', label: 'Open', n: counts?.prOpen },
          { key: 'CLOSED', label: 'Closed', n: counts?.prClosed },
        ]}
      />
      <div className={styles.mmWorkList}>
        {shown.map((pr) => {
          const st = PR_STATE[pr.state];
          const Icon = st.Icon;
          return (
            <a
              key={`${pr.repo}#${pr.number}`}
              className={styles.mmWorkRow}
              style={{ '--row-accent': st.color } as React.CSSProperties}
              href={`https://github.com/${pr.repo}/pull/${pr.number}`}
              target="_blank"
              rel="noreferrer"
              title={`${pr.repo}#${pr.number} — ${pr.title}`}
            >
              <span className={styles.mmWorkIcon} style={{ color: st.color }}>
                <Icon size={15} />
              </span>
              <div className={styles.mmWorkBody}>
                <div className={styles.mmWorkTitle}>{pr.title}</div>
                <div className={styles.mmWorkMeta}>
                  <span className={styles.mmWorkRepo}>{pr.repo}</span>
                  <span className={styles.mmWorkNum}>#{pr.number}</span>
                  {pr.additions > 0 || pr.deletions > 0 ? (
                    <span className={styles.mmDiff}>
                      <span className={styles.mmAdd}>+{formatCount(pr.additions, { fallback: '0' })}</span>
                      <span className={styles.mmDel}>−{formatCount(pr.deletions, { fallback: '0' })}</span>
                    </span>
                  ) : null}
                </div>
              </div>
              <div className={styles.mmWorkRight}>
                {pr.score > 0 ? <span className={styles.mmScoreBadge}>{fmtScore(pr.score)}</span> : null}
                <span className={styles.mmWorkDate}>{relTime(pr.mergedAt ?? pr.closedAt ?? pr.createdAt)}</span>
                <LinkExternalIcon size={11} className={styles.mmWorkExt} />
              </div>
            </a>
          );
        })}
        {shown.length === 0 ? <div className={styles.mmEmpty}>No {filter.toLowerCase()} pull requests.</div> : null}
      </div>
    </>
  );
}

// ─── Issues ──────────────────────────────────────────────────────────────────────

function issueState(i: MinerIssue): { Icon: typeof IssueOpenedIcon; color: string; key: 'open' | 'completed' | 'closed' } {
  if (i.state === 'open') return { Icon: IssueOpenedIcon, color: 'var(--attention-fg)', key: 'open' };
  if ((i.stateReason ?? '').toUpperCase() === 'COMPLETED') return { Icon: CheckCircleIcon, color: 'var(--success-fg)', key: 'completed' };
  return { Icon: XCircleIcon, color: 'var(--danger-fg)', key: 'closed' };
}

export function IssueWorkList({
  issues,
  counts,
  loading,
}: {
  issues: MinerIssue[] | undefined;
  counts: { issues: number; issuesOpen: number; issuesCompleted: number } | undefined;
  loading: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('all');
  if (loading && !issues) return <RowsSkeleton />;
  const list = issues ?? [];
  if (list.length === 0) return <div className={styles.mmEmpty}>No issues found for this miner.</div>;
  const shown =
    filter === 'all'
      ? list
      : list.filter((i) => issueState(i).key === filter);
  return (
    <>
      <FilterChips
        active={filter}
        onChange={setFilter}
        options={[
          { key: 'all', label: 'All', n: counts?.issues },
          { key: 'open', label: 'Open', n: counts?.issuesOpen },
          { key: 'completed', label: 'Completed', n: counts?.issuesCompleted },
        ]}
      />
      <div className={styles.mmWorkList}>
        {shown.map((iss) => {
          const st = issueState(iss);
          const Icon = st.Icon;
          const href = iss.htmlUrl ?? `https://github.com/${iss.repo}/issues/${iss.number}`;
          return (
            <a
              key={`${iss.repo}#${iss.number}`}
              className={styles.mmWorkRow}
              style={{ '--row-accent': st.color } as React.CSSProperties}
              href={href}
              target="_blank"
              rel="noreferrer"
              title={`${iss.repo}#${iss.number} — ${iss.title}`}
            >
              <span className={styles.mmWorkIcon} style={{ color: st.color }}>
                <Icon size={15} />
              </span>
              <div className={styles.mmWorkBody}>
                <div className={styles.mmWorkTitle}>{iss.title}</div>
                <div className={styles.mmWorkMeta}>
                  <span className={styles.mmWorkRepo}>{iss.repo}</span>
                  <span className={styles.mmWorkNum}>#{iss.number}</span>
                </div>
              </div>
              <div className={styles.mmWorkRight}>
                <span className={styles.mmWorkDate}>{relTime(iss.createdAt)}</span>
                <LinkExternalIcon size={11} className={styles.mmWorkExt} />
              </div>
            </a>
          );
        })}
        {shown.length === 0 ? <div className={styles.mmEmpty}>No {filter} issues.</div> : null}
      </div>
    </>
  );
}

// ─── Dashboard: combined PR/issue table + heatmap grid ──────────────────────────

export type WorkStatus = 'merged' | 'open' | 'review' | 'closed' | 'completed';
export interface WorkRow {
  kind: 'pr' | 'issue';
  repo: string;
  number: number;
  title: string;
  href: string;
  status: WorkStatus;
  createdAt: string | null;
  updatedAt: string | null;
  /** Sort key — most-recently-updated first. */
  ts: number;
  /** Source PR — full scoring breakdown for the detail view (kind:'pr' only). */
  pr?: MinerPr;
  /** Issue close reason (kind:'issue'). */
  stateReason?: string | null;
  /** GitHub labels (name + hex color) shown inline on the row. */
  labels: Array<{ name: string; color?: string }>;
}

function prStatus(p: MinerPr): WorkStatus {
  if (p.state === 'MERGED') return 'merged';
  if (p.state === 'OPEN') return 'open';
  return 'closed';
}
function issueStatus(i: MinerIssue): WorkStatus {
  if ((i.state ?? '').toLowerCase() === 'open') return 'open';
  if ((i.stateReason ?? '').toUpperCase() === 'COMPLETED') return 'completed';
  return 'closed';
}
function parseTs(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Merge PRs + issues into one list of table rows, most-recently-updated first.
 * PRs have no generic updatedAt in the feed, so mergedAt (or createdAt) stands in. */
export function buildWorkRows(prs: MinerPr[] | undefined, issues: MinerIssue[] | undefined): WorkRow[] {
  const rows: WorkRow[] = [];
  for (const p of prs ?? []) {
    const updatedAt = p.mergedAt ?? p.closedAt ?? p.createdAt;
    rows.push({
      kind: 'pr',
      repo: p.repo,
      number: p.number,
      title: p.title,
      href: `https://github.com/${p.repo}/pull/${p.number}`,
      status: prStatus(p),
      createdAt: p.createdAt,
      updatedAt,
      ts: parseTs(updatedAt) || parseTs(p.createdAt),
      pr: p,
      labels: p.labels ?? [],
    });
  }
  for (const i of issues ?? []) {
    rows.push({
      kind: 'issue',
      repo: i.repo,
      number: i.number,
      title: i.title,
      href: i.htmlUrl ?? `https://github.com/${i.repo}/issues/${i.number}`,
      status: issueStatus(i),
      createdAt: i.createdAt,
      updatedAt: i.updatedAt ?? i.createdAt,
      ts: parseTs(i.updatedAt ?? i.createdAt),
      stateReason: i.stateReason,
      labels: i.labels ?? [],
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  return rows;
}

/** Relative time cell matching the explorer's RecentTime (recent → green + pulse). */
function RecentTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className={styles.mmMuted}>—</span>;
  if (isRecent(iso)) {
    return (
      <span className={styles.mmRecent}>
        <span className={styles.mmRecentDot} />
        {formatRelativeTime(iso)}
      </span>
    );
  }
  return <>{formatRelativeTime(iso)}</>;
}

// Solid emphasis pills matching the explorer's StatusBadge (same colors + octicons).
const STATUS_META: Record<WorkStatus, { label: string; bg: string }> = {
  merged: { label: 'Merged', bg: 'var(--done-emphasis)' },
  open: { label: 'Open', bg: 'var(--success-emphasis)' },
  review: { label: 'Review', bg: 'var(--attention-emphasis)' },
  completed: { label: 'Completed', bg: 'var(--done-emphasis)' },
  closed: { label: 'Closed', bg: 'var(--danger-emphasis)' },
};

function statusIcon(status: WorkStatus, kind: 'pr' | 'issue') {
  if (kind === 'issue') return status === 'open' ? IssueOpenedIcon : IssueClosedIcon;
  if (status === 'merged') return GitMergeIcon;
  if (status === 'closed') return GitPullRequestClosedIcon;
  return GitPullRequestIcon;
}

function StatusPill({ status, kind }: { status: WorkStatus; kind: 'pr' | 'issue' }) {
  const st = STATUS_META[status];
  const Icon = statusIcon(status, kind);
  return (
    <span className={styles.mmPill} style={{ background: st.bg }}>
      <Icon size={12} />
      {st.label}
    </span>
  );
}

interface WorkDetailRow {
  body?: string | null;
  html_url?: string | null;
  author_login?: string | null;
}

// ─── PR/issue detail (rich scoring view) ────────────────────────────────────────

// Default subnet time-decay config (see DEFAULT_SCORING.timeDecay in lib/repos).
const DECAY = { graceHours: 12, midpointDays: 10, steepness: 0.4, minMult: 0.05 };
/** PRs older than this drop out of the validator's scoring window entirely — a merged
 * PR's earning-power contribution goes to 0 past this age. */
export const PR_LOOKBACK_DAYS = 30;
/** Sigmoid time-decay multiplier: fresh ≈ 1×, decaying toward minMultiplier with
 * 50% near the midpoint — reproduces the validator's freshness curve. */
export function decayMultiplier(ageDays: number): number {
  const eff = Math.max(0, ageDays - DECAY.graceHours / 24);
  const sig = 1 / (1 + Math.exp(DECAY.steepness * (eff - DECAY.midpointDays)));
  return DECAY.minMult + (1 - DECAY.minMult) * sig;
}
const fmtMult = (m: number) => `${m.toFixed(2)}×`;
const fmtNum = (n: number) => formatNumber(n, { digits: n >= 100 ? 0 : 2, fallback: '0' });

/** Earned (peak, at merge) vs live (time-decayed) score for a row. The /prs feed score
 * is the un-decayed peak; merged PRs shed value over time via the freshness curve. Only
 * PRs carry a per-item score — issues return null (no per-issue scoring). */
function workScores(row: WorkRow): { earned: number; live: number } | null {
  if (row.kind !== 'pr' || !row.pr || !(row.pr.score > 0)) return null;
  const earned = row.pr.score;
  const days = row.pr.mergedAt ? Math.max(0, (Date.now() - Date.parse(row.pr.mergedAt)) / 86_400_000) : null;
  const live = days != null ? earned * decayMultiplier(days) : earned;
  return { earned, live };
}

/** Freshness tier from the retained fraction (live / initial) — drives the Current
 * chip's color so decay reads at a glance: fresh → fading → stale. */
function freshnessClass(ratio: number): string {
  if (ratio >= 0.7) return styles.mmScoreFresh;
  if (ratio >= 0.3) return styles.mmScoreFading;
  return styles.mmScoreStale;
}
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const truncMid = (s: string, head = 8, tail = 8) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

/** Time-decay sigmoid curve (0–30 days) with a "Now" marker. */
/** A single PR's value decaying over the 30-day window — styled to match the Overview
 * EarningForecastChart (bordered container, dashed gridlines, smooth indigo line + area,
 * dashed "now" divider + dot). */
function TimeDecayChart({ daysSinceMerge, peakScore }: { daysSinceMerge: number; peakScore: number }) {
  const LINE = '#6366f1'; // indigo-500 — same as EarningForecastChart
  // Measure the real width so the viewBox is 1:1 (no label stretching), like the forecast.
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [measured, setMeasured] = useState(560);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setMeasured(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setMeasured(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = Math.max(280, measured);
  const Hc = 220;
  const padL = 36;
  const padR = 14;
  const padT = 14;
  const padB = 32;
  const plotW = W - padL - padR;
  const plotH = Hc - padT - padB;
  const maxDays = 30;
  const x = (d: number) => padL + (Math.min(maxDays, Math.max(0, d)) / maxDays) * plotW;
  const y = (m: number) => padT + (1 - m) * plotH;
  // Split the curve at "now" — solid for the elapsed decay, dashed for the future
  // (same solid-history + dashed-projection treatment as the EarningForecastChart).
  const baseY = padT + plotH;
  const nowD = Math.min(maxDays, Math.max(0, daysSinceMerge));
  const histArr: Array<[number, number]> = [];
  const projArr: Array<[number, number]> = [];
  for (let d = 0; d <= maxDays; d += 0.5) {
    const p: [number, number] = [x(d), y(decayMultiplier(d))];
    if (d < nowD) histArr.push(p);
    else projArr.push(p);
  }
  const nowP: [number, number] = [x(nowD), y(decayMultiplier(nowD))];
  histArr.push(nowP);
  projArr.unshift(nowP);
  const toPath = (arr: Array<[number, number]>) =>
    arr.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const histLine = toPath(histArr);
  const projLine = toPath(projArr);
  const area = `${histLine} L ${nowP[0].toFixed(1)} ${baseY.toFixed(1)} L ${histArr[0][0].toFixed(1)} ${baseY.toFixed(1)} Z`;
  const midDay = DECAY.graceHours / 24 + DECAY.midpointDays;
  const nowX = x(daysSinceMerge);
  const nowY = y(decayMultiplier(daysSinceMerge));

  // Hover anywhere on the plot → read the multiplier at that day (same vertical-line +
  // dot + foreignObject tooltip as the Overview forecast chart).
  const onMove = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const vx = (e.clientX - rect.left) * (W / rect.width);
    setHoverDay(Math.min(maxDays, Math.max(0, ((vx - padL) / plotW) * maxDays)));
  };
  const hover =
    hoverDay == null
      ? null
      : {
          day: hoverDay,
          mult: decayMultiplier(hoverDay),
          hx: x(hoverDay),
          hy: y(decayMultiplier(hoverDay)),
          forecast: hoverDay > daysSinceMerge,
        };
  const tipW = 176;
  const tipH = 80;
  const tipX = hover ? Math.min(W - tipW - 8, Math.max(8, hover.hx - tipW / 2)) : 0;
  const tipY = padT + 8;

  return (
    <div className={styles.mmDecayPlot} ref={boxRef}>
      <svg ref={svgRef} className={styles.mmDecaySvg} viewBox={`0 0 ${W} ${Hc}`} width="100%" height={Hc} preserveAspectRatio="none" role="img" aria-label="Time-decay curve">
        <defs>
          <linearGradient id="mmDecayArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LINE} stopOpacity="0.22" />
            <stop offset="100%" stopColor={LINE} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => {
          const gy = padT + (1 - g) * plotH;
          return (
            <g key={g}>
              <line x1={padL} x2={padL + plotW} y1={gy} y2={gy} stroke="var(--border-default)" strokeDasharray="3 6" />
              <text x={padL - 8} y={gy + 4} textAnchor="end" fill="var(--fg-muted)" fontSize={10}>
                {Math.round(g * 100)}
              </text>
            </g>
          );
        })}
        {[0, 5, 10, 15, 20, 25, 30].map((d) => (
          <text key={d} x={x(d)} y={Hc - 14} textAnchor="middle" fill="var(--fg-muted)" fontSize={10}>
            {d}
          </text>
        ))}
        <text x={padL + plotW / 2} y={Hc - 2} textAnchor="middle" fill="var(--fg-muted)" fontSize={9}>
          days since merge
        </text>
        <path d={area} fill="url(#mmDecayArea)" />
        <path d={histLine} fill="none" stroke={LINE} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <path d={projLine} fill="none" stroke={LINE} strokeWidth={2.5} strokeDasharray="5 5" opacity={0.6} strokeLinecap="round" strokeLinejoin="round" />
        <line x1={x(midDay)} x2={x(midDay)} y1={padT} y2={padT + plotH} stroke="var(--fg-muted)" strokeOpacity="0.35" strokeDasharray="2 3" />
        <text x={x(midDay) + 4} y={padT + 10} fill="var(--fg-muted)" fontSize={9.5}>
          50% @ midpoint
        </text>
        <line x1={nowX} x2={nowX} y1={padT} y2={padT + plotH} stroke="var(--fg-muted)" strokeOpacity="0.42" strokeDasharray="4 6" />
        <circle cx={nowX} cy={nowY} r={4} fill={LINE} stroke="var(--bg-canvas)" strokeWidth={2} />
        <text x={nowX} y={nowY - 9} textAnchor="middle" style={{ fill: 'var(--fg-default)', fontWeight: 700 }} fontSize={10}>
          Now {fmtMult(decayMultiplier(daysSinceMerge))}
        </text>
        <rect
          x={padL}
          y={padT}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverDay(null)}
        />
        {hover ? (
          <g style={{ pointerEvents: 'none' }}>
            <line x1={hover.hx} x2={hover.hx} y1={padT} y2={padT + plotH} stroke="var(--fg-muted)" strokeOpacity="0.5" strokeDasharray="4 6" />
            <circle cx={hover.hx} cy={hover.hy} r={4} fill={LINE} stroke="var(--bg-canvas)" strokeWidth={2} />
            <foreignObject x={tipX} y={tipY} width={tipW} height={tipH}>
              <div className={styles.mmDecayTip}>
                <div className={styles.mmDecayTipHead}>
                  {hover.day.toFixed(1)}d since merge
                  {hover.forecast ? <span className={styles.mmDecayTipMuted}> · forecast</span> : null}
                </div>
                <div className={styles.mmDecayTipRow}>
                  <span className={styles.mmDecayTipDot} style={{ background: LINE }} />
                  <span className={styles.mmDecayTipKey}>Multiplier</span>
                  <strong className={styles.mmDecayTipVal}>{fmtMult(hover.mult)}</strong>
                </div>
                <div className={styles.mmDecayTipRow}>
                  <span className={styles.mmDecayTipDot} style={{ background: 'transparent' }} />
                  <span className={styles.mmDecayTipKey}>Score</span>
                  <strong className={styles.mmDecayTipVal}>{fmtNum(peakScore * hover.mult)}</strong>
                </div>
              </div>
            </foreignObject>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/** Structural vs leaf token-score donut. */
function TokenDonut({ pr }: { pr: MinerPr }) {
  const segs = [
    { key: 's', val: pr.structuralScore, color: 'var(--success-emphasis)' },
    { key: 'l', val: pr.leafScore, color: 'var(--fg-subtle)' },
  ].filter((s) => s.val > 0);
  const total = segs.reduce((a, b) => a + b.val, 0) || 1;
  const circ = 2 * Math.PI * 44;
  let acc = 0;
  return (
    <div className={styles.mmTokenCard}>
      <div className={styles.mmDetailLabel}>Token composition</div>
      <svg className={styles.mmDonut} viewBox="0 0 100 100" aria-hidden>
        <circle cx={50} cy={50} r={44} fill="none" strokeWidth={12} style={{ stroke: 'var(--soft-fill)' }} />
        <g transform="rotate(-90 50 50)">
          {segs.map((s) => {
            const len = (s.val / total) * circ;
            const node = (
              <circle key={s.key} cx={50} cy={50} r={44} fill="none" strokeWidth={12} style={{ stroke: s.color }} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc} />
            );
            acc += len;
            return node;
          })}
        </g>
        <text className={styles.mmDonutHole} x={50} y={48} textAnchor="middle">
          {fmtNum(pr.tokenScore)}
        </text>
        <text className={styles.mmDonutUnit} x={50} y={60} textAnchor="middle">
          token score
        </text>
      </svg>
      <div className={styles.mmTokenLegend}>
        <span>
          <span className={styles.mmSwatch} style={{ background: 'var(--success-emphasis)' }} /> Structural
        </span>
        <span>
          <span className={styles.mmSwatch} style={{ background: 'var(--fg-subtle)' }} /> Leaf
        </span>
      </div>
    </div>
  );
}

/** The scoring breakdown table (base/token/structural/leaf/changes/commits/hotkey). */
function ScoreBreakdown({ pr }: { pr: MinerPr }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Base score', fmtNum(pr.baseScore)],
    ['Tokens scored', formatCount(pr.totalNodesScored, { fallback: '0' })],
    ['Token score', fmtNum(pr.tokenScore)],
    ['Structural', `${formatCount(pr.structuralCount, { fallback: '0' })} · score ${fmtNum(pr.structuralScore)}`],
    ['Leaf', `${formatCount(pr.leafCount, { fallback: '0' })} · score ${fmtNum(pr.leafScore)}`],
    [
      'Changes',
      <React.Fragment key="changes">
        <span className={styles.mmAdd}>+{formatCount(pr.additions, { fallback: '0' })}</span>{' / '}
        <span className={styles.mmDel}>−{formatCount(pr.deletions, { fallback: '0' })}</span>
      </React.Fragment>,
    ],
    ['Commits', formatCount(pr.commitCount, { fallback: '0' })],
    [
      'Hotkey',
      <span key="hotkey" className={styles.mmMono} title={pr.hotkey}>
        {pr.hotkey ? truncMid(pr.hotkey) : '—'}
      </span>,
    ],
  ];
  return (
    <div className={styles.mmBreak}>
      {rows.map(([k, v]) => (
        <div key={k} className={styles.mmBreakRow}>
          <span>{k}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  );
}

/** Master-detail view shown when a table row is clicked. PRs get the full scoring
 * story (multipliers, time-decay curve, breakdown, token donut); issues show the
 * fetched description. */
function WorkDetail({ row, onBack }: { row: WorkRow; onBack: () => void }) {
  const [owner, name] = row.repo.split('/');
  const isPr = row.kind === 'pr';
  const pr = row.pr;
  // PRs render entirely from the feed; only issues need the body fetch.
  const { data, isLoading, isError } = useQuery<WorkDetailRow>({
    queryKey: ['work-detail', row.kind, row.repo, row.number],
    enabled: !isPr,
    staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/${isPr ? 'pull' : 'issue'}/${owner}/${name}/${row.number}`, { signal });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as WorkDetailRow;
    },
  });
  const ghHref = data?.html_url ?? row.href;
  const dateLabel = row.status === 'merged' ? 'Merged' : row.status === 'closed' ? 'Closed' : isPr ? 'Opened' : 'Updated';
  const dateIso = row.status === 'merged' ? row.updatedAt : row.createdAt;
  const daysSinceMerge = isPr && pr?.mergedAt ? Math.max(0, (Date.now() - Date.parse(pr.mergedAt)) / 86_400_000) : null;

  const bodyBlock = isLoading ? (
    <div className="gt-skeleton" style={{ height: 96, borderRadius: 8 }} aria-hidden />
  ) : data?.body ? (
    <pre className={styles.mmDetailBody}>{data.body}</pre>
  ) : (
    <div className={styles.mmMuted}>{isError ? 'Description unavailable on this server.' : 'No description.'}</div>
  );

  return (
    <div className={styles.mmDetail}>
      <div className={styles.mmDetailTop}>
        <button type="button" className={styles.mmDetailBackBtn} onClick={onBack} aria-label="Back to list" title="Back">
          <ChevronLeftIcon size={16} />
        </button>
        <img className={styles.mmDetailAvatar} src={repoAvatar(row.repo)} alt="" loading="lazy" />
        <span className={styles.mmDetailNum}>#{row.number}</span>
        <StatusPill status={row.status} kind={row.kind} />
        {row.labels.length > 0 ? <IssueLabels labels={row.labels} maxVisible={4} maxLabelWidth={140} wrap /> : null}
        {isPr && pr ? (
          <div className={styles.mmDetailScore}>
            <span>Score</span>
            <strong>{fmtNum(pr.score)}</strong>
          </div>
        ) : null}
      </div>

      <h4 className={styles.mmDetailTitle}>
        <a
          className={styles.mmDetailTitleLink}
          href={ghHref}
          target="_blank"
          rel="noreferrer"
          title={`Open ${isPr ? 'pull request' : 'issue'} #${row.number} on GitHub`}
        >
          <span className={styles.mmDetailTitleText}>{row.title}</span>
          <LinkExternalIcon size={13} className={styles.mmDetailTitleIcon} />
        </a>
      </h4>
      <a href={`https://github.com/${row.repo}`} target="_blank" rel="noreferrer" className={styles.mmDetailRepo}>
        {row.repo}
      </a>
      <div className={styles.mmDetailChips}>
        <span className={styles.mmDetailChip}>
          {dateLabel} {fmtDate(dateIso)}
        </span>
      </div>

      {isPr && pr ? (
        <div className={styles.mmOverview}>
          {daysSinceMerge != null ? (
            <div className={styles.mmDecayCard}>
              <div className={styles.mmDecayHead}>
                <div className={styles.mmDetailLabel}>Time decay</div>
                <span className={styles.mmDecayMult}>
                  {fmtMult(decayMultiplier(daysSinceMerge))} <em>· {daysSinceMerge.toFixed(1)}d since merge</em>
                </span>
              </div>
              <TimeDecayChart daysSinceMerge={daysSinceMerge} peakScore={pr.score} />
            </div>
          ) : null}
          <div className={styles.mmScoreGrid}>
            <ScoreBreakdown pr={pr} />
            <TokenDonut pr={pr} />
          </div>
        </div>
      ) : (
        <div className={styles.mmConvPanel}>
          {bodyBlock}
          <a className={styles.mmDetailGh} href={ghHref} target="_blank" rel="noreferrer">
            <LinkExternalIcon size={12} /> View on GitHub
          </a>
        </div>
      )}
    </div>
  );
}

const fmtTaoVal = (n: number) => formatNumber(n, { digits: 3, fallback: '0' });

/** Fallback avatar for a repo with works but no per-repo scoring row (so no
 * credibility) — a neutral gray ring at the same size as the credibility ring
 * avatars, keeping the list visually consistent ("no credibility data" here). */
function NeutralRingAvatar({ repo, size = 34 }: { repo: string; size?: number }) {
  const imgSize = size - 7;
  const r = (size - 2.5) / 2;
  return (
    <span className={styles.repoRing} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className={styles.repoRingSvg} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} style={{ stroke: 'var(--soft-border)' }} />
      </svg>
      <img
        className={styles.repoRingImg}
        src={repoAvatar(repo)}
        alt=""
        loading="lazy"
        style={{ width: imgSize, height: imgSize }}
      />
    </span>
  );
}

/** Custom repository dropdown — a rich row per repo: avatar, the miner's τ/day +
 * score there, and their per-repo credibility gauges (also shown on the trigger). */
function RepoDropdown({
  repos,
  value,
  onChange,
  meta,
  repoSignals,
  maintainerRepos,
}: {
  repos: Array<{ repo: string; n: number; prs: number; issues: number }>;
  value: string;
  onChange: (r: string) => void;
  meta: Map<string, { tao: number; score: number }>;
  repoSignals: Map<string, RepoSignal>;
  maintainerRepos: string[];
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Anchor the (body-portaled, fixed) menu to the trigger, clamped to the viewport
  // so it never spills off-screen on narrow / mobile layouts.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(360, vw - 16);
      let left = r.right - width; // right-align to the trigger
      left = Math.min(left, vw - width - 8);
      left = Math.max(8, left);
      const top = Math.min(r.bottom + 4, vh - 80);
      const maxHeight = Math.max(180, vh - top - 12);
      setPos({ top, left, width, maxHeight: Math.min(360, maxHeight) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Close when the page/modal scrolls — but NOT when scrolling inside the menu itself.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <div className={styles.mmRepoDd}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.mmRepoDdTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Repository"
        onClick={() => setOpen((v) => !v)}
      >
        <img className={styles.mmRepoDdAvatar} src={repoAvatar(value)} alt="" loading="lazy" />
        <span className={styles.mmRepoDdName}>{value}</span>
        <ChevronDownIcon size={12} className={styles.mmRepoDdChevron} />
      </button>
      {mounted && open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.mmRepoDdMenu}
              role="listbox"
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
            >
              {repos.map(({ repo, prs, issues }) => {
                const m = meta.get(repo.toLowerCase());
                const sig = repoSignals.get(repo.toLowerCase());
                const maintained = maintainerRepos.some((r) => r.toLowerCase() === repo.toLowerCase());
                // Dual-cred repos → show only the dominant stream's ring so every
                // avatar stays a single ring at the same size (no shrunk inner image).
                const only: 'pr' | 'issue' | undefined =
                  sig && sig.issueDiscoveryShare > 0 && sig.issueDiscoveryShare < 1
                    ? sig.issueDiscoveryShare >= 0.5
                      ? 'issue'
                      : 'pr'
                    : undefined;
                const sel = repo === value;
                const slash = repo.indexOf('/');
                const owner = slash >= 0 ? repo.slice(0, slash + 1) : '';
                const name = slash >= 0 ? repo.slice(slash + 1) : repo;
                const hasTao = !!(m && m.tao > 0);
                const countParts: string[] = [];
                if (prs > 0) countParts.push(`${prs} ${prs === 1 ? 'PR' : 'PRs'}`);
                if (issues > 0) countParts.push(`${issues} ${issues === 1 ? 'issue' : 'issues'}`);
                const countText = countParts.join(' + ') || '0';
                return (
                  <button
                    key={repo}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    className={`${styles.mmRepoDdOpt} ${sel ? styles.mmRepoDdOptOn : ''}`}
                    onClick={() => {
                      onChange(repo);
                      setOpen(false);
                    }}
                    title={repo}
                  >
                    {sig ? (
                      <RepoRingAvatar row={sig} maintained={maintained} size={34} only={only} />
                    ) : (
                      <NeutralRingAvatar repo={repo} size={34} />
                    )}
                    <span className={styles.mmRepoDdInfo}>
                      <span className={styles.mmRepoDdRepoText}>
                        {owner ? <span className={styles.mmRepoDdOwner}>{owner}</span> : null}
                        {name}
                      </span>
                      <span className={styles.mmRepoDdMeta}>
                        <span className={styles.mmRepoDdScore}>score {m && m.score > 0 ? fmtScore(m.score) : '—'}</span>
                        <span className={styles.mmRepoDdMetaSep}>·</span>
                        <span>{countText}</span>
                      </span>
                    </span>
                    <span className={`${styles.mmRepoDdValue} ${hasTao ? '' : styles.mmRepoDdValueZero}`}>
                      <strong>{hasTao ? fmtTaoVal(m!.tao) : '0'}</strong>
                      <span className={styles.mmRepoDdValueUnit}>τ/day</span>
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** The Pull-requests & Issues card — a sortable table with PR/issue filters and a
 * per-repository dropdown (avatar + the miner's τ/day + score per repo). */
export function PrsIssuesTable({
  prs,
  issues,
  loading,
  login,
  repoMeta,
  repoSignals,
  maintainerRepos,
}: {
  prs: MinerPr[] | undefined;
  issues: MinerIssue[] | undefined;
  loading: boolean;
  login: string;
  repoMeta: Map<string, { tao: number; score: number }>;
  repoSignals: Map<string, RepoSignal>;
  maintainerRepos: string[];
}) {
  const [filter, setFilter] = useState<'pr' | 'issue'>('pr');
  const [repoFilter, setRepoFilter] = useState('');
  const [selected, setSelected] = useState<WorkRow | null>(null);
  // Drop the open detail when the miner (works) changes.
  useEffect(() => setSelected(null), [prs, issues]);
  const all = useMemo(() => buildWorkRows(prs, issues), [prs, issues]);
  // Repos this miner has works on, most-active first — drives the per-repo dropdown.
  // Grouped case-insensitively (the /prs feed lowercases repo names while the issues
  // mirror keeps GitHub's canonical case — otherwise the same repo shows up twice).
  const repoList = useMemo(() => {
    // lowercased → display-variant counts + per-kind tallies
    const groups = new Map<string, { variants: Map<string, number>; prs: number; issues: number }>();
    for (const r of all) {
      const key = r.repo.toLowerCase();
      let g = groups.get(key);
      if (!g) {
        g = { variants: new Map<string, number>(), prs: 0, issues: 0 };
        groups.set(key, g);
      }
      g.variants.set(r.repo, (g.variants.get(r.repo) ?? 0) + 1);
      if (r.kind === 'pr') g.prs += 1;
      else g.issues += 1;
    }
    return [...groups.values()]
      .map(({ variants, prs, issues }) => {
        let repo = '';
        let best = -1;
        for (const [variant, count] of variants) {
          if (count > best) {
            best = count;
            repo = variant; // display the most-common (usually GitHub-canonical) case
          }
        }
        return { repo, n: prs + issues, prs, issues };
      })
      .sort((a, b) => b.n - a.n || a.repo.localeCompare(b.repo));
  }, [all]);
  // Always scoped to ONE repo — defaults to the most-active, and falls back to it
  // when the selection isn't in this miner's set (e.g. after stepping to another).
  const effectiveRepo = repoList.some((r) => r.repo === repoFilter) ? repoFilter : repoList[0]?.repo ?? '';
  const effectiveRepoLc = effectiveRepo.toLowerCase();
  const repoScoped = effectiveRepo ? all.filter((r) => r.repo.toLowerCase() === effectiveRepoLc) : all;
  const nPr = repoScoped.filter((r) => r.kind === 'pr').length;
  const nIssue = repoScoped.filter((r) => r.kind === 'issue').length;
  // Never default onto an empty tab.
  const effFilter = filter === 'pr' && nPr === 0 && nIssue > 0 ? 'issue' : filter === 'issue' && nIssue === 0 && nPr > 0 ? 'pr' : filter;
  const shown = repoScoped.filter((r) => r.kind === effFilter);
  const footHref =
    effFilter === 'issue'
      ? effectiveRepo
        ? `https://github.com/${effectiveRepo}/issues?q=is:issue+author:${encodeURIComponent(login)}`
        : `https://github.com/${login}?tab=issues`
      : effectiveRepo
        ? `https://github.com/${effectiveRepo}/pulls?q=is:pr+author:${encodeURIComponent(login)}`
        : `https://github.com/${login}`;

  if (selected) {
    return (
      <section className={styles.mmCard}>
        <WorkDetail row={selected} onBack={() => setSelected(null)} />
      </section>
    );
  }

  return (
    <section className={`${styles.mmCard} ${styles.mmCardFill}`}>
      <div className={styles.mmCardHead}>
        <h3 className={styles.mmCardTitle}>
          <GitPullRequestIcon size={14} /> Pull requests &amp; issues
        </h3>
        <div className={styles.mmCardControls}>
          {repoList.length > 0 ? (
            <RepoDropdown
              repos={repoList}
              value={effectiveRepo}
              onChange={setRepoFilter}
              meta={repoMeta}
              repoSignals={repoSignals}
              maintainerRepos={maintainerRepos}
            />
          ) : null}
          <div className={styles.mmCardTabs} role="tablist" aria-label="Filter works">
            {(
              [
                { key: 'pr', label: 'PRs', n: nPr },
                { key: 'issue', label: 'Issues', n: nIssue },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={effFilter === t.key}
                className={`${styles.mmCardTab} ${effFilter === t.key ? styles.mmCardTabOn : ''}`}
                onClick={() => setFilter(t.key)}
              >
                {t.label}
                <span className={styles.mmCardTabN}>{formatCount(t.n, { fallback: '0' })}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !prs && !issues ? (
        <RowsSkeleton rows={6} />
      ) : shown.length === 0 ? (
        <div className={styles.mmEmpty}>
          No {effFilter === 'pr' ? 'pull requests' : 'issues'} found
          {effectiveRepo ? ` in ${effectiveRepo}` : ''}.
        </div>
      ) : (
        <div className={styles.mmTableWrap}>
          <table className={styles.mmTable}>
            <thead>
              <tr>
                <th className={styles.mmThState}>State</th>
                <th className={styles.mmThTitle}>{effFilter === 'pr' ? 'Pull request' : 'Issue'}</th>
                <th className={styles.mmThScore} title="Base score at merge (before time decay)">
                  Base
                </th>
                <th className={styles.mmThScore} title="Live score now, after the freshness time-decay curve">
                  Live
                </th>
                <th className={styles.mmThCreated}>Created</th>
                <th className={styles.mmThUpdated}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 150).map((r) => {
                const sc = workScores(r);
                return (
                  <tr
                    key={`${r.kind}-${r.repo}#${r.number}`}
                    className={styles.mmTr}
                    role="button"
                    tabIndex={0}
                    title={`${r.title} — view details`}
                    onClick={() => setSelected(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(r);
                      }
                    }}
                  >
                    <td>
                      <StatusPill status={r.status} kind={r.kind} />
                    </td>
                    <td className={styles.mmTdTitle}>
                      <span className={styles.mmTitleLink}>
                        <span className={styles.mmTitleText}>{r.title}</span>
                        <span className={styles.mmTitleNum}>#{r.number}</span>
                        {r.labels.length > 0 ? <IssueLabels labels={r.labels} maxVisible={3} maxLabelWidth={84} /> : null}
                      </span>
                    </td>
                    <td className={styles.mmTdScore}>
                      {sc ? <span className={styles.mmScoreBase}>{fmtNum(sc.earned)}</span> : <span className={styles.mmMuted}>—</span>}
                    </td>
                    <td className={styles.mmTdScore}>
                      {sc ? (
                        <span
                          className={`${styles.mmScoreChip} ${freshnessClass(sc.live / sc.earned)}`}
                          title={sc.live < sc.earned - 0.01 ? `decayed from ${fmtNum(sc.earned)} · ${Math.round((sc.live / sc.earned) * 100)}% retained` : undefined}
                        >
                          {fmtNum(sc.live)}
                        </span>
                      ) : (
                        <span className={styles.mmMuted}>—</span>
                      )}
                    </td>
                    <td className={styles.mmTdCreated}>{formatRelativeTime(r.createdAt)}</td>
                    <td className={styles.mmTdUpdated}>
                      <RecentTime iso={r.updatedAt} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {shown.length > 0 ? (
        <div className={styles.mmCardFoot}>
          <a className={styles.mmViewAll} href={footHref} target="_blank" rel="noreferrer">
            View all on GitHub <LinkExternalIcon size={11} />
          </a>
        </div>
      ) : null}
    </section>
  );
}

// ─── Repository-activity heatmap grid (GitHub-style) ────────────────────────────

const HM_WEEKS = 26;
const HM_DAY_MS = 86_400_000;
const HM_WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface HeatCell {
  ts: number;
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  pad: boolean;
}
export interface HeatGrid {
  weeks: HeatCell[][];
  monthTicks: Array<{ col: number; label: string }>;
  weekdayLabels: readonly string[];
  total: number;
  busiestCount: number;
  empty: boolean;
}

function hmDayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function hmIso(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Bucket activity events into a 26-week Mon..Sun calendar grid with 5 green
 * intensity levels (relative to the busiest day). Each PR contributes an event on
 * the day it was opened AND the day it was merged; each issue, on the day it was
 * opened — so a merged PR shows up as two distinct days of activity. */
export function buildHeatGrid(prs: MinerPr[] | undefined, issues: MinerIssue[] | undefined): HeatGrid {
  const counts = new Map<number, number>();
  const bump = (iso: string | null) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return;
    const k = hmDayStart(new Date(t));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (const p of prs ?? []) {
    bump(p.createdAt);
    bump(p.mergedAt); // a merge is its own activity event, on its own day
  }
  for (const i of issues ?? []) bump(i.createdAt);

  const todayStart = hmDayStart(new Date());
  const todayWdMon0 = (new Date(todayStart).getDay() + 6) % 7;
  const lastSunday = todayStart + (6 - todayWdMon0) * HM_DAY_MS;
  const startTs = lastSunday - (HM_WEEKS * 7 - 1) * HM_DAY_MS;
  // Normalise intensity over the VISIBLE window only — a busier day outside the rendered
  // 26 weeks must not dim the in-window cells and understate recent activity.
  let busiest = 0;
  for (const [day, v] of counts) if (day >= startTs && day <= lastSunday && v > busiest) busiest = v;
  const level = (c: number): HeatCell['level'] => {
    if (c <= 0) return 0;
    if (busiest <= 1) return 4;
    const q = c / busiest;
    if (q <= 0.25) return 1;
    if (q <= 0.5) return 2;
    if (q <= 0.75) return 3;
    return 4;
  };

  const weeks: HeatCell[][] = [];
  const monthTicks: Array<{ col: number; label: string }> = [];
  let prevMonth = -1;
  let total = 0;
  for (let col = 0; col < HM_WEEKS; col++) {
    const colCells: HeatCell[] = [];
    for (let row = 0; row < 7; row++) {
      const ts = startTs + (col * 7 + row) * HM_DAY_MS;
      const future = ts > todayStart;
      const c = counts.get(ts) ?? 0;
      total += future ? 0 : c;
      colCells.push({ ts, date: hmIso(ts), count: future ? 0 : c, level: future ? 0 : level(c), pad: future });
    }
    weeks.push(colCells);
    const m = new Date(colCells[0].ts).getMonth();
    if (m !== prevMonth) {
      monthTicks.push({ col, label: new Date(colCells[0].ts).toLocaleString(undefined, { month: 'short' }) });
      prevMonth = m;
    }
  }
  return { weeks, monthTicks, weekdayLabels: HM_WD, total, busiestCount: busiest, empty: total === 0 };
}

/** Green fill for a heat level (theme-safe via color-mix on the success token). */
export function heatFill(level: number): string {
  if (level <= 0) return 'color-mix(in srgb, var(--fg-subtle) 12%, transparent)';
  const pctByLevel = [0, 32, 52, 74, 100][level] ?? 100;
  return `color-mix(in srgb, var(--success-emphasis) ${pctByLevel}%, var(--bg-inset))`;
}
