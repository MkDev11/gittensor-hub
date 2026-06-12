'use client';

/* eslint-disable @next/next/no-img-element */

import React from 'react';
import { formatCount, formatNumber } from '@/lib/format';
import styles from '../page.module.css';
import { pct, repoTaoOf, score, shareText, type MinerView, type RepoSignal } from '../_lib/miners';
import { ContribSpark, IssueActivityStats, PrActivityStats, RepoMiniStrip, TrackButton } from './shared';

interface MinerListRowProps {
  view: MinerView;
  rank: number;
  /** Total miner emission pool (TAO/day) — denominator for "% of pool". */
  poolTao: number;
  /** Per-repo TAO base — turns each repo's stream shares into TAO/day. */
  subnetTao: number;
  selected: boolean;
  mine: boolean;
  tracked: boolean;
  onSelect: () => void;
  onToggleTrack: () => void;
}

/* List view of a miner — the same content the card surfaces (emission, score, PR
 * and issue activity, top repos, contributions), laid out as a dense table row in
 * the repositories list-view style and reusing the card's own components so the
 * colours and styling match exactly. */
export default function MinerListRow({
  view,
  rank,
  poolTao,
  subnetTao,
  selected,
  mine,
  tracked,
  onSelect,
  onToggleTrack,
}: MinerListRowProps) {
  const repoTao = (row: RepoSignal) => repoTaoOf(row, subnetTao);
  // Mirror the card: show the earning repos, or the most active rows when none earn.
  const repoRows = view.topRepos.length > 0 ? view.topRepos : view.rows.slice(0, 3);
  return (
    <div
      className={`${styles.listRow} ${selected ? styles.listRowSelected : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect();
      }}
    >
      <div className={styles.listActions}>
        <TrackButton tracked={tracked} login={view.login} onClick={onToggleTrack} />
      </div>

      <div className={styles.listIdentity}>
        <img src={view.avatarUrl} alt={view.login} loading="lazy" />
        <div className={styles.listIdentityText}>
          <div className={styles.identityLine}>
            <strong title={view.login}>{view.login}</strong>
            {mine ? <span className={styles.youPill}>You</span> : null}
            {view.isMaintainer ? <span className={styles.cardMaintBadge}>{pct(view.maintainerCut)} cut</span> : null}
          </div>
          <span className={styles.listMeta}>
            #{rank || '-'} · uid {view.uid ?? '-'}
          </span>
        </div>
      </div>

      <div className={styles.listCell}>
        <div className={`${styles.listCellNum} ${styles.listTaoNum}`}>
          {formatNumber(view.taoPerDay, { digits: 3, fallback: '0' })}
        </div>
        <div className={styles.listCellSub}>{shareText(view.taoPerDay, poolTao)} pool</div>
      </div>

      <div className={`${styles.listCell} ${styles.listColHideSm}`}>
        <div className={styles.listCellNum}>{score(view.totalScore + view.issueScore)}</div>
        <div className={styles.listCellSub}>score</div>
      </div>

      <div className={`${styles.listActCell} ${styles.listColHideMd}`}>
        <PrActivityStats view={view} />
      </div>

      <div className={`${styles.listActCell} ${styles.listColHideMd}`}>
        <IssueActivityStats view={view} />
      </div>

      <div className={`${styles.listContribCell} ${styles.listColHideLg}`} title="Per-repo contributions (PR + issue volume per active repo)">
        <ContribSpark rows={view.rows} />
        <span className={styles.listContribSub}>{formatCount(view.uniqueRepos, { fallback: '0' })} repos</span>
      </div>

      <div className={`${styles.listReposCol} ${styles.listColHideLg}`}>
        <RepoMiniStrip
          rows={repoRows}
          maintainerRepos={view.maintainerRepos}
          repoTao={repoTao}
          limit={4}
          totalCount={view.earningRepoCount}
        />
      </div>
    </div>
  );
}
