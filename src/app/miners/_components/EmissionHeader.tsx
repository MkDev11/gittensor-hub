'use client';

/* SN74 emission overview — the daily TAO headline + per-recipient cards
 * (miners / validators / recycling / treasury / owner). Each card follows the
 * reference UI: a tinted icon chip top-left, a share pill top-right, the daily
 * TAO value, label, and source, on a bordered card with a subtle corner accent.
 * Data is the live /api/sn74-emission feed (proxied from TaoMarketCap). */

import React from 'react';
import { ArchiveIcon, KeyIcon, PeopleIcon, ShieldCheckIcon, SyncIcon, ZapIcon } from '@primer/octicons-react';
import styles from '../page.module.css';
import type { EmissionData, MinerView } from '../_lib/miners';
import MinerDistribution from './MinerDistribution';

export type { EmissionData };

// Corner-decorator colors, grouped by emission tier: the top-level network
// split (owner / miners / validators) vs. the OSS / miner-pool components
// (recycling / treasury / active miners). Cool blue vs warm amber so the two
// groups read as distinct at a glance.
const DECO_EMISSION = 'var(--accent-emphasis)';
const DECO_OSSPOOL = 'var(--attention-emphasis)';

function EmissionStat({
  icon,
  label,
  value,
  color,
  sub,
  share,
  deco,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  sub: string;
  share: string;
  deco: string;
}) {
  return (
    <div className={styles.emissionStat} style={{ '--seg': color, '--deco': deco } as React.CSSProperties}>
      <span className={styles.emissionShare}>{share}</span>
      <span className={styles.emissionIcon} aria-hidden>
        {icon}
      </span>
      <strong style={{ color }}>
        {value}
        <em> τ/day</em>
      </strong>
      <span>{label}</span>
      <small>{sub}</small>
    </div>
  );
}

/** Placeholder card shown while the emission feed loads — same shell as
 * EmissionStat with shimmer blocks instead of real values. */
function SkeletonStat() {
  return (
    <div className={`${styles.emissionStat} ${styles.emissionStatSkeleton}`}>
      <span className="gt-skeleton" style={{ position: 'absolute', top: 11, right: 11, width: 36, height: 16, borderRadius: 999 }} aria-hidden />
      <span className={styles.emissionIcon} aria-hidden>
        <span className="gt-skeleton" style={{ display: 'block', width: 15, height: 15, borderRadius: 4 }} />
      </span>
      <strong>
        <span className="gt-skeleton" style={{ display: 'inline-block', width: 86, height: 20, borderRadius: 5 }} />
      </strong>
      <span>
        <span className="gt-skeleton" style={{ display: 'inline-block', width: 54, height: 8, borderRadius: 3 }} />
      </span>
      <small>
        <span className="gt-skeleton" style={{ display: 'inline-block', width: 72, height: 7, borderRadius: 3 }} />
      </small>
    </div>
  );
}

/** Histogram placeholder shown while the miner feed loads, so the right side of
 * the header doesn't sit empty until the distribution arrives. Mirrors the
 * MinerDistribution panel: header line + a row of bars with bucket labels. */
function DistSkeleton() {
  const bars = [85, 18, 30, 12, 16, 10, 4, 7, 3];
  return (
    <div className={styles.distPanel} aria-hidden>
      <div className={styles.distHead}>
        <span className="gt-skeleton" style={{ display: 'inline-block', width: 128, height: 9, borderRadius: 3 }} />
        <span className="gt-skeleton" style={{ display: 'inline-block', width: 92, height: 9, borderRadius: 3 }} />
      </div>
      <div className={styles.histo}>
        {bars.map((h, i) => (
          <div key={i} className={styles.histoCol}>
            <span className="gt-skeleton" style={{ width: '100%', minHeight: 2, height: `${h}%`, borderRadius: '4px 4px 0 0' }} />
            <span className="gt-skeleton" style={{ width: 16, height: 7, borderRadius: 3 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EmissionHeader({
  emission,
  views = [],
  onSelectMiner,
}: {
  emission?: EmissionData | null;
  views?: MinerView[];
  onSelectMiner?: (view: MinerView) => void;
}) {
  const loaded = emission?.totalTaoPerDay != null;
  const total = emission?.totalTaoPerDay ?? 30;
  const miners = emission?.minerTaoPerDay ?? null;
  const validators = emission?.validatorTaoPerDay ?? null;
  const recycle = emission?.recycleTaoPerDay ?? null;
  const treasury = emission?.treasuryTaoPerDay ?? null;
  const owner = emission?.ownerTaoPerDay ?? null;
  const minerCount = emission?.minerCount ?? null;
  const validatorCount = emission?.validatorCount ?? null;

  // Green group (owner / miners / validators) — share of TOTAL daily emission.
  // total = owner + miners + validators, so these three sum to 100%.
  const totalShareBase = total || 1;
  const pctOf = (v: number | null) => `${Math.round((Math.max(0, v ?? 0) / totalShareBase) * 100)}%`;

  // Amber group (recycling / treasury / active miners) — share of the MINER / OSS
  // pool, NOT of total. Built from the ACTUAL per-UID values: recycle (UID 0),
  // treasury (UID 111) and activeMinerTaoPerDay (Σ miner UIDs), with the pool =
  // their sum (the same subnetTAO base the per-repo math uses). This guarantees the
  // three always sum to 100% and 'active' is the real distributed amount.
  // (Deriving active = minerTaoPerDay − recycle − treasury broke when the recycle
  // sink exceeded the theoretical 41% miner split — active went negative, hiding
  // its card and pushing recycle past 100%.)
  const active = Math.max(0, emission?.activeMinerTaoPerDay ?? 0);
  const ossPool = active + Math.max(0, recycle ?? 0) + Math.max(0, treasury ?? 0);
  const poolPctOf = (v: number | null) => `${Math.round((Math.max(0, v ?? 0) / (ossPool || 1)) * 100)}%`;

  return (
    <section className={styles.emission} aria-label="SN74 emissions today">
      <div className={styles.emissionRow}>
        <div className={styles.emissionTopRow}>
          <div className={styles.emissionLead}>
            <span className={styles.emissionEyebrow}>SN74 emissions today</span>
            <h2 className={styles.emissionValue}>
              {loaded ? (
                <span>{total.toFixed(2)}</span>
              ) : (
                <span className="gt-skeleton" style={{ display: 'inline-block', width: 108, height: 22, borderRadius: 6, verticalAlign: '-3px' }} />
              )}{' '}
              TAO/day
            </h2>
            <p className={styles.emissionDesc}>
              Live daily TAO emission for SN74, pulled from{' '}
              <a href="https://taomarketcap.com/subnets/74" target="_blank" rel="noreferrer">
                taomarketcap
              </a>
              . Miner earnings below are funded from this pool.
            </p>
          </div>
          {views.length > 0 ? (
            <MinerDistribution views={views} onSelectMiner={onSelectMiner} />
          ) : !loaded ? (
            <DistSkeleton />
          ) : null}
        </div>

        <div className={styles.emissionStats}>
          {!loaded ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonStat key={i} />)
          ) : (
            <>
          {owner != null ? (
            <EmissionStat icon={<KeyIcon size={15} />} label="owner" value={owner.toFixed(2)} color="var(--success-fg)" deco={DECO_EMISSION} share={pctOf(owner)} sub="paid to owner_hotkey" />
          ) : null}
          <EmissionStat
            icon={<PeopleIcon size={15} />}
            label="miners"
            value={(miners ?? 0).toFixed(2)}
            color="var(--success-fg)"
            deco={DECO_EMISSION}
            share={pctOf(miners)}
            sub={minerCount != null ? `${minerCount} miner UIDs` : 'miner UIDs'}
          />
          {validators != null ? (
            <EmissionStat
              icon={<ShieldCheckIcon size={15} />}
              label="validators"
              value={validators.toFixed(2)}
              color="var(--success-fg)"
              deco={DECO_EMISSION}
              share={pctOf(validators)}
              sub={validatorCount != null ? `${validatorCount} validator UIDs` : 'validator UIDs'}
            />
          ) : null}
          <EmissionStat icon={<SyncIcon size={15} />} label="recycling" value={(recycle ?? 0).toFixed(2)} color="var(--attention-fg)" deco={DECO_OSSPOOL} share={poolPctOf(recycle)} sub="UID 0" />
          <EmissionStat icon={<ArchiveIcon size={15} />} label="treasury" value={(treasury ?? 0).toFixed(2)} color="var(--attention-fg)" deco={DECO_OSSPOOL} share={poolPctOf(treasury)} sub="UID 111" />
          {active > 0 ? (
            <EmissionStat
              icon={<ZapIcon size={15} />}
              label="active miners"
              value={active.toFixed(2)}
              color="var(--attention-fg)"
              deco={DECO_OSSPOOL}
              share={poolPctOf(active)}
              sub="of OSS pool"
            />
          ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
