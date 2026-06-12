'use client';

/* eslint-disable @next/next/no-img-element */

import React from 'react';
import { InfoIcon } from '@primer/octicons-react';
import { formatCount, formatNumber } from '@/lib/format';
import styles from '../page.module.css';
import { incentiveNote, pct, repoTaoOf, score, shareText, type MinerView, type RepoSignal } from '../_lib/miners';
import {
  BlockedRepos,
  ContribSpark,
  IssueActivityStats,
  PrActivityStats,
  RankMedal,
  RepoEmissionBar,
  TrackButton,
} from './shared';

interface MinerCardProps {
  view: MinerView;
  rank: number;
  /** Total miner emission pool (TAO/day) — denominator for "% of pool". */
  poolTao: number;
  /** Whole-subnet daily emission (TAO/day) — denominator for "% of total". */
  totalTao: number;
  /** Per-repo TAO base (active miners + recycle + treasury) — multiplies the
   * server-stamped per-repo/per-stream shares into TAO/day. */
  subnetTao: number;
  /** Per-repo ACTUAL distributed emission (lowercased repo → τ/day), summed across
   * all contributors — the denominator for "repo total / your share". */
  repoTotals: Map<string, number>;
  selected: boolean;
  mine: boolean;
  tracked: boolean;
  onSelect: () => void;
  onToggleTrack: () => void;
}

export default function MinerCard({
  view,
  rank,
  poolTao,
  totalTao,
  subnetTao,
  repoTotals,
  selected,
  mine,
  tracked,
  onSelect,
  onToggleTrack,
}: MinerCardProps) {
  // Per-repo emission (TAO/day) — server-stamped per-repo shares × live subnet
  // TAO. Each repo's figure already sums its PR, issue-discovery, and maintainer
  // streams, matching the repositories page (e.g. MkDev11 ≈ 0.039 on gittensory).
  // The per-repo bar replaces the old card-wide reward-stream split bar (which was
  // a flat single-color bar for all but a handful of multi-stream miners).
  const repoTao = (row: RepoSignal) => repoTaoOf(row, subnetTao);
  // Repo's actual distributed pool (all contributors) — the denominator for the
  // "repo total / your share" line; falls back to the notional pool if a repo is
  // somehow absent from the aggregate.
  const repoTotal = (row: RepoSignal) => repoTotals.get(row.repo.toLowerCase()) ?? subnetTao * row.emissionShare * 0.9;

  // Repos to show: the miner's earning repos, or — when they earn from none yet —
  // their most active contributions (so the card still has substance + context).
  const repoRows = view.topRepos.length > 0 ? view.topRepos : view.rows.slice(0, 3);

  // Plain-language note for the confusing cases (penalty, or active-but-not-earning)
  // — e.g. why 829 issues + a PR still pay 0, and how earning actually happens.
  const note = incentiveNote(view);

  // "+N more" reconciliation — the card shows the top few earning repos, but the
  // headline sums ALL of them; surface the remainder so nothing hides silently.
  const reposShown = 4;
  const shownTao = view.topRepos.slice(0, reposShown).reduce((sum, row) => sum + repoTao(row), 0);
  const moreCount = Math.max(0, view.earningRepoCount - reposShown);
  const moreTao = Math.max(0, view.taoPerDay - shownTao);

  return (
    <article
      className={`${styles.minerCard} ${selected ? styles.selectedCard : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect();
      }}
    >
      <div className={styles.cardCorner}>
        <TrackButton tracked={tracked} login={view.login} onClick={onToggleTrack} />
      </div>

      <div className={styles.cardHead}>
        <div className={styles.avatarWrap}>
          <img src={view.avatarUrl} alt={view.login} loading="lazy" />
          {rank > 0 && rank <= 3 ? <RankMedal rank={rank} className={styles.cardRankMedal} /> : null}
        </div>
        <div className={styles.cardHeadText}>
          <div className={styles.cardNameLine}>
            <strong title={view.login}>{view.login}</strong>
            {mine ? <span className={styles.youPill}>You</span> : null}
            {view.isMaintainer ? <span className={styles.cardMaintBadge}>{pct(view.maintainerCut)} maintainer cut</span> : null}
          </div>
          <div className={styles.cardSub}>
            #{rank || '-'} · uid {view.uid ?? '-'}
          </div>
        </div>
      </div>

      <div className={styles.cardHeadline}>
        <div className={styles.cardHeadlineMain}>
          <div className={styles.cardBig}>
            {formatNumber(view.taoPerDay, { digits: 3, fallback: '0' })}
            <span className={styles.cardBigUnit}>TAO/day</span>
          </div>
          <div className={styles.cardEyebrow}>
            <span>{shareText(view.taoPerDay, poolTao)} of pool</span>
            <span className={styles.cardEyebrowSep}>·</span>
            <span className={styles.cardEyebrowMono}>{shareText(view.taoPerDay, totalTao)} of total emission</span>
          </div>
        </div>
        <div
          className={styles.cardHeadlineSide}
          title="Gross contribution score across all repos. Earnings are NOT proportional to it — they depend on which repos you're eligible on and each repo's emission weight (see per-repo τ/d below)."
        >
          <div className={styles.cardSideNum}>{score(view.totalScore + view.issueScore)}</div>
          <div className={styles.cardSideLabel}>score</div>
        </div>
      </div>

      <div className={styles.cardActivityRow}>
        <div>
          <div className={styles.cardActLabel}>PR activity</div>
          <PrActivityStats view={view} />
        </div>
        <div>
          <div className={styles.cardActLabel}>Issue activity</div>
          <IssueActivityStats view={view} />
        </div>
        <div className={styles.cardActSide}>
          <div className={styles.cardActLabel}>Contributions</div>
          <ContribSpark rows={view.rows} />
          <div className={styles.cardActSub}>{formatCount(view.uniqueRepos, { fallback: '0' })} repos</div>
        </div>
      </div>

      <div className={styles.cardReposLabel}>Top repos</div>
      <RepoEmissionBar
        rows={repoRows}
        maintainerRepos={view.maintainerRepos}
        repoTao={repoTao}
        repoTotal={repoTotal}
        subnetTao={subnetTao}
        limit={reposShown}
      />
      {moreCount > 0 ? (
        <div className={styles.cardReposMore} title={`${moreCount} more earning ${moreCount === 1 ? 'repo' : 'repos'} beyond the top ${reposShown}`}>
          +{moreCount} more earning {moreCount === 1 ? 'repo' : 'repos'} · {formatNumber(moreTao, { digits: 3, fallback: '0' })} τ/d
        </div>
      ) : null}

      {view.blockedRepos.length > 0 ? (
        <>
          <div
            className={`${styles.cardReposLabel} ${styles.cardReposLabelTight}`}
            title="Repos this miner is contributing to but not yet earning from — clear the gate (≥80% credibility and ≥3 merged PRs / solved issues) to start earning."
          >
            Working toward earning
          </div>
          <BlockedRepos rows={view.blockedRepos} total={view.blockedRepoCount} subnetTao={subnetTao} limit={1} />
        </>
      ) : null}

      {note ? (
        <div className={styles.cardNote}>
          <InfoIcon size={12} />
          <span>{note}</span>
        </div>
      ) : null}
    </article>
  );
}
