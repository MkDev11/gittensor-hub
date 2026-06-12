'use client';

/* eslint-disable @next/next/no-img-element */

/* Miner earnings distribution — a compact histogram bucketing the current field
 * by $/day (snapshot-only data, so bars animate live on each refresh). Hovering
 * (or focusing) a bar opens a popover listing the miners in that bucket; each
 * row is clickable to open that miner's drawer. */

import React, { useMemo, useState } from 'react';
import { formatCount, formatUsd } from '@/lib/format';
import styles from '../page.module.css';
import type { MinerView } from '../_lib/miners';

// Bucket 0 is the "$0" bucket: miners who submitted PRs/issues but earn nothing
// (low credibility, etc.). The remaining buckets split earners by $/day, labeled
// by their upper edge ("<$X"); the last is the 200+ tail.
const BUCKET_EDGES = [1, 5, 10, 25, 50, 100, 200];
const BUCKET_TICKS = ['$0', '<$1', '<$5', '<$10', '<$25', '<$50', '<$100', '<$200', '$200+'];
const BUCKET_RANGES = ['Submitted · $0 earned', 'Under $1', '$1 – $5', '$5 – $10', '$10 – $25', '$25 – $50', '$50 – $100', '$100 – $200', '$200+'];

export default function MinerDistribution({ views, onSelectMiner }: { views: MinerView[]; onSelectMiner?: (view: MinerView) => void }) {
  const [hover, setHover] = useState<number | null>(null);

  const { buckets, shown } = useMemo(() => {
    const b: MinerView[][] = Array.from({ length: BUCKET_TICKS.length }, () => []);
    let count = 0;
    for (const v of views) {
      if (v.usdPerDay > 0) {
        let idx = BUCKET_EDGES.findIndex((edge) => v.usdPerDay < edge);
        if (idx === -1) idx = BUCKET_EDGES.length; // 200+
        b[idx + 1].push(v); // +1: bucket 0 is reserved for $0 earners
        count++;
      } else if (v.totalPrs > 0 || v.totalIssues > 0 || v.rows.length > 0) {
        // active (submitted PRs/issues / scored on a repo) but no incentive yet
        b[0].push(v);
        count++;
      }
    }
    b.forEach((arr) => arr.sort((a, c) => c.usdPerDay - a.usdPerDay));
    return { buckets: b, shown: count };
  }, [views]);
  const max = Math.max(...buckets.map((b) => b.length), 1);

  return (
    <div className={styles.distPanel} aria-label="Miner earnings distribution">
      <div className={styles.distHead}>
        <span>Earnings spread · $/day</span>
        <span className={styles.distCount}>Total {formatCount(shown, { fallback: '0' })} active miners</span>
      </div>

      <div className={styles.histo} onMouseLeave={() => setHover(null)}>
        {buckets.map((miners, i) => {
          const has = miners.length > 0;
          return (
            <div
              key={BUCKET_TICKS[i]}
              className={styles.histoCol}
              tabIndex={has ? 0 : -1}
              onMouseEnter={() => has && setHover(i)}
              onFocus={() => has && setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={has ? `${BUCKET_RANGES[i]} per day: ${miners.length} miners` : undefined}
            >
              {hover === i && has ? (
                <div className={`${styles.distPop} ${i < BUCKET_TICKS.length / 2 ? styles.distPopLeft : styles.distPopRight}`} role="dialog">
                  <div className={styles.distPopHead}>
                    <strong>
                      {BUCKET_RANGES[i]}
                      {i > 0 ? <span> / day</span> : null}
                    </strong>
                    <span>
                      {miners.length} miner{miners.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className={styles.distPopList}>
                    {miners.map((v) => (
                      <button key={v.key} type="button" className={styles.distPopRow} onClick={() => onSelectMiner?.(v)} title={`Open ${v.login}`}>
                        <img className={styles.distPopAvatar} src={v.avatarUrl} alt="" loading="lazy" />
                        <span className={styles.distPopName}>
                          {v.login}
                          <em>uid {v.uid ?? '-'}</em>
                        </span>
                        <span className={styles.distPopVal}>{formatUsd(v.usdPerDay)}/d</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <span className={styles.histoBar} style={{ height: `${(miners.length / max) * 100}%` }} data-active={hover === i ? '' : undefined}>
                <em>{miners.length}</em>
              </span>
              <span className={styles.histoLabel}>{BUCKET_TICKS[i]}</span>
            </div>
          );
        })}
      </div>    </div>
  );
}
