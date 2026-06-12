'use client';

/* eslint-disable @next/next/no-img-element */

/* Small presentational primitives shared by the card, list row, drawer,
 * headline, and palette. Keeping them here (rather than re-declaring per
 * surface) keeps the visual language consistent. */

import React, { useId } from 'react';
import {
  CheckCircleIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  StarFillIcon,
  StarIcon,
  XCircleIcon,
} from '@primer/octicons-react';
import { formatCount, formatNumber } from '@/lib/format';
import styles from '../page.module.css';
import { blockGate, eligibilityLabel, pct, score, type MinerView, type RepoSignal } from '../_lib/miners';
import { fillBadge, streamsOf, ISSUE_COLOR, MAINTAINER_COLOR, NEUTRAL_COLOR, PR_COLOR } from '../_lib/streams';

export type Tone = 'green' | 'purple' | undefined;

export function MiniStat({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className={`${styles.miniStat} ${tone === 'green' ? styles.greenText : tone === 'purple' ? styles.purpleText : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/* Gold / silver / bronze medal palettes for the top-3 rank badges. */
const MEDALS: Record<number, { light: string; mid: string; dark: string; text: string; ribbon: string }> = {
  1: { light: '#ffe88a', mid: '#f5cf63', dark: '#c9941f', text: '#4a3500', ribbon: '#b8860b' },
  2: { light: '#ffffff', mid: '#d4dae3', dark: '#9ba2af', text: '#2a2d33', ribbon: '#828a97' },
  3: { light: '#f6c39c', mid: '#dd9266', dark: '#a05e3a', text: '#3a1e0d', ribbon: '#8a4d2e' },
};

/** A real medal icon (ribbon + metallic disc) wrapping the rank number — gold/
 * silver/bronze for ranks 1–3. Shared by the treemap tiles, the cards, and the
 * tile inspector so the top-3 marker reads identically everywhere. The wrapper
 * takes a `className` for positioning per surface. */
export function RankMedal({ rank, className }: { rank: number; className?: string }) {
  const c = MEDALS[rank] ?? MEDALS[1];
  // Unique gradient id per instance (the same rank can render on a tile AND a
  // card at once, so a fixed id would collide).
  const gid = `medal${useId().replace(/[^a-zA-Z0-9]/g, '')}r${rank}`;
  return (
    <span className={className} aria-label={`Rank ${rank}`}>
      <svg viewBox="0 0 22 26" width="18" height="21" role="img">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.light} />
            <stop offset="50%" stopColor={c.mid} />
            <stop offset="100%" stopColor={c.dark} />
          </linearGradient>
        </defs>
        {/* ribbon V (behind the disc) */}
        <polygon points="5,1 9,1 12,11 9,13" fill={c.ribbon} />
        <polygon points="17,1 13,1 10,11 13,13" fill={c.ribbon} />
        {/* metallic disc */}
        <circle cx="11" cy="16" r="9" fill={`url(#${gid})`} stroke={c.dark} strokeWidth="0.8" />
        <circle cx="11" cy="16" r="6.6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.7" />
        <text
          x="11"
          y="16.4"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="9.5"
          fontWeight="800"
          fontFamily="var(--mono)"
          fill={c.text}
        >
          {rank}
        </text>
      </svg>
    </span>
  );
}

/** Named, color-tinted chips for the reward streams a miner actually earns —
 * green PRs, purple issue discovery, orange maintainer cut (with the cut %).
 * A miner with no attributable stream gets a single neutral chip. */
export function StreamBadges({ view }: { view: MinerView }) {
  const { pr, issue, maintainer } = streamsOf(view);
  if (!pr && !issue && !maintainer) {
    return (
      <div className={styles.streamBadges}>
        <span className={styles.streamBadge} style={fillBadge(NEUTRAL_COLOR)}>
          No active reward stream
        </span>
      </div>
    );
  }
  return (
    <div className={styles.streamBadges} aria-label="Reward streams">
      {pr ? (
        <span className={styles.streamBadge} style={fillBadge(PR_COLOR)}>
          Pull requests
        </span>
      ) : null}
      {issue ? (
        <span className={styles.streamBadge} style={fillBadge(ISSUE_COLOR)}>
          Issue discovery
        </span>
      ) : null}
      {maintainer ? (
        <span className={styles.streamBadge} style={fillBadge(MAINTAINER_COLOR)}>
          {pct(view.maintainerCut)} maintainer cut
        </span>
      ) : null}
    </div>
  );
}

export function TrackButton({ tracked, login, onClick }: { tracked: boolean; login: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={tracked ? styles.starActive : styles.starButton}
      aria-label={tracked ? `Untrack ${login}` : `Track ${login}`}
      title={tracked ? 'Untrack miner' : 'Track miner'}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {tracked ? <StarFillIcon size={12} /> : <StarIcon size={12} />}
    </button>
  );
}

/** A shimmer block on the shared `.gt-skeleton` animation. */
function SkelBar({ w, h, r = 4 }: { w: number | string; h: number; r?: number }) {
  return <span className="gt-skeleton" style={{ display: 'block', width: w, height: h, borderRadius: r }} />;
}

/** Loading placeholder shaped like a real MinerCard — same container, header,
 * headline + score, 3-up activity row and top-repo rows (reusing the card's own
 * CSS classes for spacing) — so the loading state previews the actual layout
 * instead of the generic two-bars-and-a-floating-block placeholder. */
export function MinerCardSkeleton({ opacity = 1 }: { opacity?: number }) {
  return (
    <div className={styles.minerCard} style={{ opacity, cursor: 'default' }} aria-hidden>
      <div className={styles.cardCorner}>
        <SkelBar w={22} h={22} r={5} />
        <SkelBar w={22} h={22} r={5} />
      </div>

      <div className={styles.cardHead}>
        <div className={styles.avatarWrap}>
          <SkelBar w={40} h={40} r={7} />
        </div>
        <div className={styles.cardHeadText}>
          <div className={styles.cardNameLine}>
            <SkelBar w={110} h={13} />
          </div>
          <div className={styles.cardSub}>
            <SkelBar w={150} h={10} />
          </div>
        </div>
      </div>

      <div className={styles.cardHeadline}>
        <div className={styles.cardHeadlineMain}>
          <SkelBar w={132} h={32} r={6} />
          <div className={styles.cardEyebrow}>
            <SkelBar w={170} h={9} />
          </div>
        </div>
        <div className={styles.cardHeadlineSide} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <SkelBar w={46} h={26} r={5} />
          <SkelBar w={30} h={8} r={3} />
        </div>
      </div>

      <div className={styles.cardActivityRow}>
        {[0, 1].map((i) => (
          <div key={i}>
            <div className={styles.cardActLabel}>
              <SkelBar w={54} h={9} r={3} />
            </div>
            <SkelBar w={42} h={15} />
            <div className={styles.cardActSub}>
              <SkelBar w={34} h={8} r={3} />
            </div>
          </div>
        ))}
        <div className={styles.cardActSide} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div className={styles.cardActLabel}>
            <SkelBar w={60} h={9} r={3} />
          </div>
          <div className={styles.contribSpark}>
            {[11, 17, 9, 21, 14, 19, 12, 23].map((h, i) => (
              <span key={i} className="gt-skeleton" style={{ width: 5, height: h, borderRadius: 1 }} />
            ))}
          </div>
          <div className={styles.cardActSub}>
            <SkelBar w={44} h={8} r={3} />
          </div>
        </div>
      </div>

      <div className={styles.cardReposLabel}>
        <SkelBar w={58} h={9} r={3} />
      </div>
      <div className={`${styles.repoList} ${styles.repoListLines}`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.repoListRow}>
            <span className="gt-skeleton" style={{ width: 34, height: 34, borderRadius: 999, flex: '0 0 auto' }} />
            <div className={styles.repoListBody}>
              <div className={styles.repoListTop}>
                <SkelBar w="42%" h={11} />
                <SkelBar w={78} h={11} />
              </div>
              <div className={styles.repoListFoot}>
                <SkelBar w={92} h={16} r={999} />
                <SkelBar w={54} h={16} r={999} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The miner card grid in its loading state — N structured skeletons in the same
 * responsive grid as the real cards, fading down to hint more are on the way. */
export function MinerCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.minerGrid} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <MinerCardSkeleton key={i} opacity={Math.max(0.3, 1 - i * 0.08)} />
      ))}
    </div>
  );
}

export function EligibilityPill({ view }: { view: MinerView }) {
  const label = eligibilityLabel(view);
  const eligible = label !== 'Inactive';
  return (
    <span className={`${styles.eligibilityPill} ${eligible ? styles.eligible : styles.inactive}`}>
      {eligible ? <CheckCircleIcon size={12} /> : <XCircleIcon size={12} />}
      {label}
    </span>
  );
}

export function ActivityPills({ view }: { view: MinerView }) {
  return (
    <div className={styles.activityPills} aria-label="Miner activity">
      <span title="Pull requests across active repos">
        <GitPullRequestIcon size={12} />
        {formatCount(view.totalPrs, { fallback: '0' })}
      </span>
      <span title="Issues across active repos">
        <IssueOpenedIcon size={12} />
        {formatCount(view.totalIssues, { fallback: '0' })}
      </span>
    </div>
  );
}

/** A small circular progress ring for one credibility value (0..1), its arc
 * colored by the reward stream and the rounded percentage in the center. A tick
 * marks the 0.80 eligibility threshold; the optional `detail` (merged/closed
 * counts) rides along in the tooltip. */
function CredRing({
  value,
  color,
  label,
  detail,
  threshold = 0.8,
}: {
  value: number;
  color: string;
  label: string;
  detail?: string;
  /** This repo's credibility floor (0..1) — positions the tick and the "to earn"
   *  text, and reddens the center % when the value falls short. */
  threshold?: number;
}) {
  const v = Math.max(0, Math.min(1, value));
  const t = Math.max(0, Math.min(1, threshold));
  const below = v < t;
  const r = 13;
  const circ = 2 * Math.PI * r;
  // Per-repo eligibility marker — measured from north (12 o'clock), t clockwise.
  const angle = t * 2 * Math.PI;
  const tx = 16 + r * Math.sin(angle);
  const ty = 16 - r * Math.cos(angle);
  return (
    <span
      className={styles.credRing}
      title={`${label}: ${Math.round(v * 100)}%${detail ? ` · ${detail}` : ''} · ${Math.round(t * 100)}% to earn`}
    >
      <svg viewBox="0 0 32 32" aria-hidden>
        <circle className={styles.credRingTrack} cx="16" cy="16" r={r} fill="none" strokeWidth="3" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          style={{ stroke: color }}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - v)}
          transform="rotate(-90 16 16)"
        />
        <circle className={styles.credRingThreshold} cx={tx} cy={ty} r="1.7" />
      </svg>
      <span className={styles.credRingPct} style={below ? { color: 'var(--danger-fg)' } : undefined}>
        {Math.round(v * 100)}%
      </span>
    </span>
  );
}

/** Per-repo credibility as circular progress rings — one per cred type the repo
 * actually rewards. issueDiscoveryShare splits the repo's emission: 0 = PRs only
 * (PR cred), 1 = issue discovery only (issue cred), in between = both. A
 * maintained repo pays a cut rather than scored work, so it shows a single
 * maintainer badge. Credibility is per-repo — a contributor can be trusted on
 * one repo and unproven on another. */
export function RepoCred({ row, maintainerRepos = [] }: { row: RepoSignal; maintainerRepos?: string[] }) {
  const maintained = maintainerRepos.some((repo) => repo.toLowerCase() === row.repo.toLowerCase());
  if (maintained) {
    return (
      <span className={styles.credBadges}>
        <span className={styles.credBadge} style={fillBadge(MAINTAINER_COLOR)}>
          maintainer
        </span>
      </span>
    );
  }
  const supportsPr = row.issueDiscoveryShare < 1;
  const supportsIssue = row.issueDiscoveryShare > 0;
  const prDetail = `${formatCount(row.mergedPrs, { fallback: '0' })} merged · ${formatCount(row.closedPrs, {
    fallback: '0',
  })} closed${row.openPrs > 0 ? ` · ${formatCount(row.openPrs)} open` : ''}`;
  const issueDetail = `${formatCount(row.solvedIssues, { fallback: '0' })} solved`;
  return (
    <span className={styles.credBadges}>
      {supportsPr ? (
        <CredRing value={row.prCred} color={PR_COLOR} label="PR credibility" detail={prDetail} threshold={row.minPrCred} />
      ) : null}
      {supportsIssue ? (
        <CredRing
          value={row.issueCred}
          color={ISSUE_COLOR}
          label="Issue-discovery credibility"
          detail={issueDetail}
          threshold={row.minIssueCred}
        />
      ) : null}
    </span>
  );
}

/** Top repositories for a miner — each with its owner avatar and the per-repo
 * credibility badges (see RepoCredBadges). */
/** Repo emission weight as a "% pool" — its share of the OSS emission pool, so a
 * miner can see why one repo pays more than another despite similar scores. */
function poolText(emissionShare: number): string {
  const p = emissionShare * 100;
  return `${formatNumber(p, { digits: p < 1 ? 2 : 1, fallback: '0' })}% pool`;
}

export function RepoSignals({
  rows,
  maintainerRepos = [],
  repoTao,
  subnetTao = 0,
  limit = 3,
}: {
  rows: RepoSignal[];
  maintainerRepos?: string[];
  /** Optional per-repo emission estimate (TAO/day) — shown in place of the raw
   * repo score when provided (the card has the pool to compute it). */
  repoTao?: (row: RepoSignal) => number;
  /** Per-repo TAO base — used to express each repo's emission weight as a pool. */
  subnetTao?: number;
  limit?: number;
}) {
  if (rows.length === 0) {
    return <div className={styles.repoSignalsEmpty}>No repo-level scoring rows in the miner feed.</div>;
  }

  return (
    <div className={styles.repoSignals} aria-label="Top repositories for this miner">
      {rows.slice(0, limit).map((row) => {
        const owner = row.repo.split('/')[0];
        const repoPool = subnetTao * row.emissionShare * 0.9;
        return (
          <div key={row.repo} className={styles.repoRow} title={row.repo}>
            <img
              className={styles.repoRowAvatar}
              src={`https://github.com/${encodeURIComponent(owner)}.png?size=48`}
              alt=""
              loading="lazy"
            />
            <div className={styles.repoRowBody}>
              <div className={styles.repoRowName}>{row.repo}</div>
              <div className={styles.repoRowMeta}>
                <span title="Pull requests on this repo">
                  <GitPullRequestIcon size={10} />
                  {formatCount(row.prs, { fallback: '0' })}
                </span>
                <span title="Issues on this repo">
                  <IssueOpenedIcon size={10} />
                  {formatCount(row.issues, { fallback: '0' })}
                </span>
                {repoTao ? (
                  <span
                    className={styles.repoRowTao}
                    title={`Estimated ${formatNumber(repoTao(row), { digits: 3, fallback: '0' })} τ/d${
                      row.emissionShare > 0
                        ? ` — out of this repo's ${formatNumber(repoPool, { digits: 3, fallback: '0' })} τ/d contributor pool`
                        : ''
                    }`}
                  >
                    {formatNumber(repoTao(row), { digits: 3, fallback: '0' })} τ/d
                  </span>
                ) : (
                  <span title="Repo contribution score">score {score(row.prScore + row.issueScore + row.issueTokenScore)}</span>
                )}
                {row.emissionShare > 0 ? (
                  <span
                    className={styles.repoRowPool}
                    title={`Repo emission weight — ${poolText(row.emissionShare)} of the OSS emission${
                      subnetTao > 0 ? ` (${formatNumber(repoPool, { digits: 3, fallback: '0' })} τ/d contributor pool)` : ''
                    }`}
                  >
                    {poolText(row.emissionShare)}
                  </span>
                ) : null}
              </div>
            </div>
            <RepoCred row={row} maintainerRepos={maintainerRepos} />
          </div>
        );
      })}
    </div>
  );
}

// ─── "Top repos" per-row list (avatar ring = credibility, bar = emission) ──────

const fmtTao = (n: number) => formatNumber(n, { digits: 3, fallback: '0' });
const isMaintained = (repo: string, maintainerRepos: string[]) =>
  maintainerRepos.some((r) => r.toLowerCase() === repo.toLowerCase());

/** A repo's dominant reward stream color (PR green / issue purple / maintainer
 * orange) — used to tint its per-row emission bar. */
function repoStreamColor(row: RepoSignal, maintained: boolean): string {
  const maint = maintained ? row.maintainerTaoShare : 0;
  if (maint > 0 && maint >= row.prTaoShare && maint >= row.issueTaoShare) return MAINTAINER_COLOR;
  if (row.issueTaoShare > row.prTaoShare) return ISSUE_COLOR;
  return PR_COLOR;
}

function repoTitle(row: RepoSignal, tao: number): string {
  return `${row.repo} · ${fmtTao(tao)} τ/d · ${formatCount(row.prs, { fallback: '0' })} PR · ${formatCount(row.issues, {
    fallback: '0',
  })} iss · ${poolText(row.emissionShare)}`;
}

/** Tinted chip style for a credibility badge, colored by its reward stream. */
function chipStyle(color: string): React.CSSProperties {
  return {
    color,
    background: `color-mix(in srgb, ${color} 22%, var(--bg-canvas))`,
    borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
  };
}

/** Below-threshold credibility reads as a SOLID danger chip (white on red) rather
 * than a tinted one. A pale red tint is hard to tell from the pale issue-discovery
 * purple tint on light mode (both desaturate to similar muted darks); a solid fill
 * is unmistakable and signals "below this repo's bar" at a glance. */
const DANGER_CHIP: React.CSSProperties = {
  color: '#fff',
  background: 'var(--danger-emphasis)',
  borderColor: 'var(--danger-emphasis)',
};

/** Inline style for one number inside the dual pill: a solid red mini-fill when
 * below that stream's threshold, else plain stream-colored text. */
function dualNumStyle(below: boolean, base: string): React.CSSProperties {
  return below ? { color: '#fff', background: 'var(--danger-emphasis)', borderRadius: 4, padding: '0 2px' } : { color: base };
}

/** Small circular repo avatar wrapped by a credibility ring per cred the repo
 * pays: outer green = PR cred, inner purple = issue-discovery cred — so a
 * dual-cred repo shows two clean concentric rings; a maintained repo shows one
 * full orange ring. The precise values also sit in the colored corner badges. */
export function RepoRingAvatar({
  row,
  maintained,
  size = 34,
  only,
  showBadges = true,
}: {
  row: RepoSignal;
  maintained: boolean;
  size?: number;
  /** Restrict to a single credibility ring/badge (the gating stream) instead of
   *  showing both — keeps the badge from overflowing a small avatar. */
  only?: 'pr' | 'issue';
  /** Show the numeric cred corner badges. Off for tiny avatars (e.g. the list
   *  strip) where the ring alone conveys credibility. */
  showBadges?: boolean;
}) {
  const owner = row.repo.split('/')[0];
  const ctr = size / 2;
  const sw = 2.5;
  const rOuter = (size - sw) / 2;
  const rInner = rOuter - sw - 1.5;
  const supportsPr = !maintained && row.issueDiscoveryShare < 1 && only !== 'issue';
  const supportsIssue = !maintained && row.issueDiscoveryShare > 0 && only !== 'pr';
  const rings: Array<{ r: number; color: string; value: number }> = [];
  if (maintained) {
    rings.push({ r: rOuter, color: MAINTAINER_COLOR, value: 1 });
  } else {
    if (supportsPr) rings.push({ r: rOuter, color: PR_COLOR, value: row.prCred });
    if (supportsIssue) rings.push({ r: supportsPr ? rInner : rOuter, color: ISSUE_COLOR, value: row.issueCred });
  }
  const dual = rings.length > 1;
  const imgSize = size - (dual ? 14 : 7);
  // Each stream is judged against THIS repo's OWN credibility floor (validator
  // config, defaulted 0.8 PR / 0.7 issue) — so a repo that lowers the bar (e.g.
  // taopedia-articles at 0.5) doesn't false-flag. Below it → solid danger chip.
  const belowPr = row.prCred < row.minPrCred;
  const belowIssue = row.issueCred < row.minIssueCred;
  return (
    <span className={styles.repoRing} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className={styles.repoRingSvg} aria-hidden>
        {rings.map((ring, i) => {
          const circ = 2 * Math.PI * ring.r;
          const val = Math.max(0, Math.min(1, ring.value));
          return (
            <g key={i}>
              <circle
                className={styles.repoRingTrack}
                cx={ctr}
                cy={ctr}
                r={ring.r}
                fill="none"
                strokeWidth={sw}
                style={{ stroke: `color-mix(in srgb, ${ring.color} 40%, transparent)` }}
              />
              <circle
                cx={ctr}
                cy={ctr}
                r={ring.r}
                fill="none"
                strokeWidth={sw}
                strokeLinecap="round"
                style={{ stroke: ring.color }}
                strokeDasharray={circ}
                strokeDashoffset={circ * (1 - val)}
                transform={`rotate(-90 ${ctr} ${ctr})`}
              />
            </g>
          );
        })}
      </svg>
      <img
        className={styles.repoRingImg}
        src={`https://github.com/${encodeURIComponent(owner)}.png?size=64`}
        alt=""
        loading="lazy"
        style={{ width: imgSize, height: imgSize }}
      />
      {showBadges ? (
        <span className={`${styles.repoRingBadges} ${dual ? styles.repoRingBadgesDual : ''}`}>
          {maintained ? (
            <span className={styles.credChip} style={chipStyle(MAINTAINER_COLOR)} title="Maintainer cut">
              -
            </span>
          ) : dual ? (
            <span
              className={styles.credChipDual}
              title={`PR credibility ${Math.round(row.prCred * 100)}% (need ${Math.round(
                row.minPrCred * 100,
              )}%) · issue-discovery credibility ${Math.round(row.issueCred * 100)}% (need ${Math.round(
                row.minIssueCred * 100,
              )}%)`}
            >
              <span style={dualNumStyle(belowPr, PR_COLOR)}>{Math.round(row.prCred * 100)}</span>
              <span style={dualNumStyle(belowIssue, ISSUE_COLOR)}>{Math.round(row.issueCred * 100)}</span>
            </span>
          ) : (
            <>
              {supportsPr ? (
                <span
                  className={styles.credChip}
                  style={belowPr ? DANGER_CHIP : chipStyle(PR_COLOR)}
                  title={`PR credibility ${Math.round(row.prCred * 100)}% · ${Math.round(row.minPrCred * 100)}% to earn`}
                >
                  {Math.round(row.prCred * 100)}
                </span>
              ) : null}
              {supportsIssue ? (
                <span
                  className={styles.credChip}
                  style={belowIssue ? DANGER_CHIP : chipStyle(ISSUE_COLOR)}
                  title={`Issue-discovery credibility ${Math.round(row.issueCred * 100)}% · ${Math.round(row.minIssueCred * 100)}% to earn`}
                >
                  {Math.round(row.issueCred * 100)}
                </span>
              ) : null}
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}

type RepoLayoutProps = {
  rows: RepoSignal[];
  maintainerRepos?: string[];
  repoTao?: (row: RepoSignal) => number;
  /** A repo's ACTUAL distributed emission (τ/day, all contributors) — the
   * denominator for "repo total / your share". When omitted, falls back to the
   * notional pool (emissionShare × subnetTAO × 0.9), which overstates it by the
   * recycled portion. */
  repoTotal?: (row: RepoSignal) => number;
  /** Per-repo TAO base — to show each repo's TOTAL daily emission alongside the
   * miner's share. */
  subnetTao?: number;
  limit?: number;
};

// Outcome tones for activity states — bright fg colors that read on the card.
const STAT_TONES: Record<string, string> = {
  green: 'var(--success-fg)',
  amber: 'var(--attention-fg)',
  red: 'var(--danger-fg)',
};

type StatItem = { n: number; tone: string; Icon: typeof GitMergeIcon; label: string };

/** Per-repo activity, grouped into one badge per type: a PR badge (open / merged
 * / closed) and — only on repos that actually pay issue discovery
 * (issueDiscoveryShare > 0) — an issue badge (open / closed / completed, where
 * completed = solved by a MERGED PR, distinct from plain closed). On PR-only repos
 * the "issues" are really issue-*solving* (paid via the PR pool), so no issue badge
 * is shown there. Each state is an icon + count, tinted green = merged/completed,
 * amber = open, red = closed; only non-zero states show. */
function RepoBreakdown({ row }: { row: RepoSignal }) {
  const c = (n: number) => formatCount(n, { fallback: '0' });
  const pr: StatItem[] = [
    { n: row.openPrs, tone: 'amber', Icon: GitPullRequestIcon, label: 'open PRs' },
    { n: row.mergedPrs, tone: 'green', Icon: GitMergeIcon, label: 'merged PRs' },
    { n: row.closedPrs, tone: 'red', Icon: GitPullRequestClosedIcon, label: 'closed PRs' },
  ].filter((s) => s.n > 0);
  const iss: StatItem[] =
    row.issueDiscoveryShare > 0
      ? [
          { n: row.openIssues, tone: 'amber', Icon: IssueOpenedIcon, label: 'open issues' },
          { n: row.closedIssues, tone: 'red', Icon: XCircleIcon, label: 'closed issues' },
          { n: row.solvedIssues, tone: 'green', Icon: CheckCircleIcon, label: 'completed issues (solved by a merged PR)' },
        ].filter((s) => s.n > 0)
      : [];
  if (pr.length === 0 && iss.length === 0) return null;
  const badge = (stats: StatItem[], title: string, accent: string) =>
    stats.length ? (
      <span
        className={styles.statBadge}
        style={{ borderColor: `color-mix(in srgb, ${accent} 45%, transparent)` }}
        title={title}
      >
        {stats.map((s) => {
          const Icon = s.Icon;
          return (
            <span key={s.label} className={styles.statItem} style={{ color: STAT_TONES[s.tone] }} title={`${c(s.n)} ${s.label}`}>
              <Icon size={10} />
              {c(s.n)}
            </span>
          );
        })}
      </span>
    ) : null;
  return (
    <div className={styles.repoStats}>
      {badge(pr, 'Pull requests — open / merged / closed', PR_COLOR)}
      {badge(iss, 'Issue discovery — open / closed / completed', ISSUE_COLOR)}
    </div>
  );
}

/** Card-header activity readout — a fixed icon+count triplet tinted by outcome
 * (green merged/completed, amber open, red closed); zero counts are muted. Same
 * visual vocabulary as the per-repo RepoBreakdown badges so the card reads
 * consistently. NOTE: counts are cumulative (all-time) — the per-miner feed has
 * no 30-day window (see MinerView.prOpen). */
function ActivityStats({ stats }: { stats: StatItem[] }) {
  const c = (n: number) => formatCount(n, { fallback: '0' });
  return (
    <div className={styles.actStats}>
      {stats.map((s, i) => {
        const Icon = s.Icon;
        return (
          <React.Fragment key={s.label}>
            {i > 0 ? (
              <span className={styles.actSep} aria-hidden>
                /
              </span>
            ) : null}
            <span className={styles.actStat} style={{ color: STAT_TONES[s.tone] }} title={`${c(s.n)} ${s.label}`}>
              <Icon size={11} />
              {c(s.n)}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** PR outcome triplet for the card header — open / merged / closed. */
export function PrActivityStats({ view }: { view: MinerView }) {
  return (
    <ActivityStats
      stats={[
        { n: view.prOpen, tone: 'amber', Icon: GitPullRequestIcon, label: 'open PRs' },
        { n: view.prMerged, tone: 'green', Icon: GitMergeIcon, label: 'merged PRs' },
        { n: view.prClosed, tone: 'red', Icon: GitPullRequestClosedIcon, label: 'closed PRs' },
      ]}
    />
  );
}

/** Issue outcome triplet — open / closed / completed, where completed = solved by
 * a MERGED PR (distinct from plain closed). */
export function IssueActivityStats({ view }: { view: MinerView }) {
  return (
    <ActivityStats
      stats={[
        { n: view.issueOpen, tone: 'amber', Icon: IssueOpenedIcon, label: 'open issues' },
        { n: view.issueClosed, tone: 'red', Icon: XCircleIcon, label: 'closed issues' },
        { n: view.issueCompleted, tone: 'green', Icon: CheckCircleIcon, label: 'completed issues (solved by a merged PR)' },
      ]}
    />
  );
}

/* Per-repo contributions sparkline — one bar per active repo (height ∝ PRs+issues,
 * stacked issue-over-PR). Shared by the card's Contributions cell and the list. */
export function ContribSpark({ rows }: { rows: RepoSignal[] }) {
  const data = rows
    .map((r) => ({ pr: r.prs, issue: r.issues, total: r.prs + r.issues }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 14);
  if (data.length === 0) return <div className={styles.contribEmpty}>—</div>;
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <div className={styles.contribSpark} aria-hidden>
      {data.map((d, i) => {
        const h = Math.max(10, (d.total / max) * 100);
        const issuePct = (d.issue / d.total) * 100;
        return (
          <span
            key={i}
            title={`${d.pr} PR${d.pr === 1 ? '' : 's'} · ${d.issue} issue${d.issue === 1 ? '' : 's'}`}
            style={{
              height: `${h}%`,
              backgroundImage: `linear-gradient(to top, ${ISSUE_COLOR} 0%, ${ISSUE_COLOR} ${issuePct}%, ${PR_COLOR} ${issuePct}%, ${PR_COLOR} 100%)`,
            }}
          />
        );
      })}
    </div>
  );
}

/** Top repos as a per-row list: a small circular avatar ringed by its
 * credibility, the repo name + its τ/d, and a per-repo bar whose fill is the
 * miner's share of that repo's total emission pool (yourShare ÷ repoTotal —
 * directly the ratio of the two τ/d numbers shown), tinted by reward stream. */
export function RepoEmissionBar({
  rows,
  maintainerRepos = [],
  repoTao,
  repoTotal,
  subnetTao = 0,
  limit = 4,
}: RepoLayoutProps) {
  const items = rows.slice(0, limit).map((row) => ({
    row,
    tao: repoTao ? repoTao(row) : 0,
    maintained: isMaintained(row.repo, maintainerRepos),
  }));
  if (items.length === 0)
    return <div className={styles.repoSignalsEmpty}>No repo-level scoring rows in the miner feed.</div>;
  return (
    <div className={`${styles.repoList} ${styles.repoListLines}`}>
      {items.map(({ row, tao, maintained }) => {
        // The repo's TOTAL daily contributor emission (actual distribution across
        // all contributors), and this miner's share of it. Falls back to the
        // notional pool when no aggregate is supplied.
        const repoTotalTao = repoTotal ? repoTotal(row) : subnetTao * row.emissionShare * 0.9;
        // The row itself is the bar: a stream-tinted fill from the left up to the
        // miner's share of THIS repo's pool (yourShare / repoTotal — exactly the
        // ratio of the two τ/d numbers shown), on a neutral track.
        const frac = repoTotalTao > 0 ? tao / repoTotalTao : 0;
        const contribScore = row.prScore + row.issueScore;
        const fillPct = (tao > 0 ? Math.max(Math.min(frac, 1), 0.04) * 100 : 0).toFixed(1);
        const rowBg = `linear-gradient(to right, color-mix(in srgb, ${repoStreamColor(row, maintained)} 30%, var(--soft-fill)) ${fillPct}%, var(--soft-fill) ${fillPct}%)`;
        return (
          <div key={row.repo} className={styles.repoListRow} style={{ background: rowBg }} title={repoTitle(row, tao)}>
            <RepoRingAvatar row={row} maintained={maintained} />
            <div className={styles.repoListBody}>
              <div className={styles.repoListTop}>
                <span className={styles.repoListName}>{row.repo}</span>
                <span className={styles.repoListTao} title="repo's total emission / this miner's share (τ/day)">
                  {repoTotalTao > 0 ? <span className={styles.repoListTaoRepo}>{fmtTao(repoTotalTao)} / </span> : null}
                  {tao > 0 ? fmtTao(tao) : '—'} τ/d
                </span>
              </div>
              <div className={styles.repoListFoot}>
                <RepoBreakdown row={row} />
                {contribScore > 0 || row.collateralScore > 0 ? (
                  <span
                    className={styles.scoreBadge}
                    title="Contribution score / collateral (pending score from open PRs, converts on merge)"
                  >
                    <span className={styles.scoreBadgeLabel}>score</span>
                    <span className={styles.scoreBadgeNums}>
                      <span className={styles.scoreBadgeVal}>{contribScore > 0 ? score(contribScore) : '0'}</span>
                      {row.collateralScore > 0 ? (
                        <span className={styles.scoreBadgeColl}>/+{formatNumber(row.collateralScore, { digits: 1, fallback: '0' })}</span>
                      ) : null}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact top-repos list for dense contexts (the list view) — one tight line per
 * repo: a small avatar, the name, and the miner's τ/d, on a stream-tinted emission
 * fill (yourShare ÷ repoTotal). A leaner alternative to RepoEmissionBar's full
 * card rows, so a table row stays short. */
export function RepoMiniStrip({
  rows,
  maintainerRepos = [],
  repoTao,
  limit = 4,
  totalCount,
}: RepoLayoutProps & { totalCount?: number }) {
  const items = rows.slice(0, limit);
  if (items.length === 0) return <span className={styles.repoMiniEmpty}>—</span>;
  const top = items[0];
  const topTao = repoTao ? repoTao(top) : 0;
  const more = Math.max(0, (totalCount ?? rows.length) - items.length);
  return (
    <div className={styles.repoStrip}>
      <div className={styles.repoStripAvatars}>
        {items.map((row) => {
          const maintained = isMaintained(row.repo, maintainerRepos);
          const t = repoTao ? repoTao(row) : 0;
          return (
            <span key={row.repo} className={styles.repoStripAvatar} title={`${row.repo} — ${t > 0 ? fmtTao(t) : '—'} τ/d`}>
              <RepoRingAvatar
                row={row}
                maintained={maintained}
                size={28}
                only={maintained ? undefined : row.issueTaoShare > row.prTaoShare ? 'issue' : 'pr'}
              />
            </span>
          );
        })}
      </div>
      <span className={styles.repoStripName} title={`Top repo: ${top.repo}`}>
        {top.repo}
      </span>
      <span className={styles.repoStripTao}>{topTao > 0 ? `${fmtTao(topTao)} τ/d` : '—'}</span>
      {more > 0 ? (
        <span className={styles.repoStripMore} title={`${more} more earning ${more === 1 ? 'repo' : 'repos'}`}>
          +{more}
        </span>
      ) : null}
    </div>
  );
}

/** Repos the miner is contributing to but not yet earning from — a compact,
 * avatar-less list (secondary to the earning "top repos") showing the gate reason
 * (≥80% credibility / ≥3 merged PRs or solved issues) and the repo's emission
 * weight, so the best "almost earning" opportunities stand out without inflating
 * the card. Capped at `limit`, with a "+N more" tail. */
export function BlockedRepos({
  rows,
  total,
  subnetTao = 0,
  limit = 2,
}: {
  rows: RepoSignal[];
  total?: number;
  subnetTao?: number;
  limit?: number;
}) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, limit);
  const extra = Math.max(0, (total ?? rows.length) - shown.length);
  return (
    <ul className={styles.blockedList} aria-label="Repos this miner is working toward earning on">
      {shown.map((row) => {
        const gate = blockGate(row);
        const isPr = gate.stream === 'pr';
        // Outcome split for the binding stream — the positive outcome (merged PRs
        // or solved issues) in the stream's color, plus closed in red, so the bar
        // shows BOTH the volume and the credibility ratio that gates eligibility.
        const good = isPr ? row.mergedPrs : row.solvedIssues;
        const closed = isPr ? row.closedPrs : row.closedIssues;
        const goodColor = isPr ? PR_COLOR : ISSUE_COLOR;
        const total = good + closed;
        // Bar fills toward the count threshold, so 1 of 3 reads as a third full
        // (not "done"); once attempts exceed the threshold the same widths become
        // the merged-vs-closed credibility ratio.
        const denom = Math.max(gate.target, total) || 1;
        const repoPool = subnetTao * row.emissionShare * 0.9;
        return (
          <li
            key={row.repo}
            className={styles.blockedRow}
            title={`${row.repo} — ${gate.text}; ${good} ${isPr ? 'merged' : 'solved'} vs ${closed} closed (${Math.round(
              gate.progress * 100,
            )}% to eligibility)`}
          >
            <RepoRingAvatar row={row} maintained={false} size={30} only={gate.stream} />
            <div className={styles.blockedBody}>
              <div className={styles.blockedTop}>
                <span className={styles.blockedRepo}>{row.repo}</span>
                {row.emissionShare > 0 ? (
                  <span
                    className={styles.blockedPool}
                    title={`Repo emission weight — ${poolText(row.emissionShare)} of the OSS emission${
                      subnetTao > 0 ? `; ${formatNumber(repoPool, { digits: 3, fallback: '0' })} τ/d pool to compete for` : ''
                    }`}
                  >
                    {poolText(row.emissionShare)}
                  </span>
                ) : null}
              </div>
              <div className={styles.blockedGate}>
                <span className={styles.blockedBarTrack} aria-hidden>
                  {good > 0 ? (
                    <span className={styles.blockedBarSeg} style={{ width: `${(good / denom) * 100}%`, background: goodColor }} />
                  ) : null}
                  {closed > 0 ? (
                    <span
                      className={styles.blockedBarSeg}
                      style={{ width: `${(closed / denom) * 100}%`, background: 'var(--danger-emphasis)' }}
                    />
                  ) : null}
                </span>
                <span className={styles.blockedReason}>
                  <span className={styles.blockedNum} style={{ color: goodColor }}>
                    {formatCount(good, { fallback: '0' })}
                  </span>{' '}
                  {isPr ? 'merged' : 'solved'} ·{' '}
                  <span className={styles.blockedNum} style={{ color: 'var(--danger-fg)' }}>
                    {formatCount(closed, { fallback: '0' })}
                  </span>{' '}
                  closed
                  {gate.need ? ` · ${gate.need}` : ''}
                </span>
              </div>
            </div>
          </li>
        );
      })}
      {extra > 0 ? <li className={styles.blockedMore}>+{extra} more</li> : null}
    </ul>
  );
}

export function TrackRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className={styles.trackRow}>
      <span>{label}</span>
      <strong className={good === undefined ? undefined : good ? styles.goodValue : styles.mutedValue}>{value}</strong>
    </div>
  );
}

export function ProgressBar({ label, value, tone }: { label: string; value: number; tone: 'green' | 'purple' }) {
  const clamped = Math.max(0, Math.min(value, 1));
  return (
    <div className={styles.progressBlock}>
      <div>
        <span>{label}</span>
        <strong>{Math.round(clamped * 100)}%</strong>
      </div>
      <span className={styles.progressTrack}>
        <span className={tone === 'green' ? styles.progressGreen : styles.progressPurple} style={{ width: `${clamped * 100}%` }} />
      </span>
    </div>
  );
}
