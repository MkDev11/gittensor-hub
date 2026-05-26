'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import styles from '../page.module.css';
import Avatar from './Avatar';
import {
  OSS_POOL,
  TREASURY_PCT,
  competitionLevel,
  formatTAO,
  mergeSpeedLevel,
  repoDailyTAO,
  repoFill,
  type RepoRow,
} from '../_lib/incentives';
import { squarify } from '../_lib/squarify';
import type { RepoMiner, RepoMinersResponse } from '@/types/entities';

export type SelectedSeg =
  | { kind: 'repo'; fullName: string }
  | { kind: 'slack' }
  | null;

interface MarketSectionProps {
  rows: RepoRow[];
  /** Miner-pool TAO/day — basis for all per-repo emission math (bar,
   *  treemap, leaderboard, inspector tooltips). = active + recycle +
   *  treasury, excludes validator portion. */
  subnetTAO: number;
  /** Total daily SN74 emission (miners + validators + owner). Displayed
   *  in the headline only. */
  totalSubnetTAO: number;
  /** True once /api/sn74-emission has returned the live daily TAO emission. */
  subnetTAOLoaded: boolean;
  /** Live per-UID breakdown from /api/sn74-emission. When present, the
   *  stat cards display these on-chain values directly instead of
   *  computing them from `configured_share`. */
  minerTAO?: number | null;
  validatorTAO?: number | null;
  recycleTAO?: number | null;
  treasuryTAO?: number | null;
  /** Subnet owner's TAO/day cut, off-UID. Derived server-side from
   *  `dtao.owner_cut_per_block × 7200 blocks/day × alphaPrice`. */
  ownerTAO?: number | null;
  minerCount?: number | null;
  validatorCount?: number | null;
  selected: SelectedSeg;
  onSelect: (next: SelectedSeg) => void;
  onOpenDrawer: (fullName: string) => void;
  onOpenPalette: () => void;
}

export default function MarketSection({
  rows,
  subnetTAO,
  totalSubnetTAO,
  subnetTAOLoaded,
  minerTAO,
  validatorTAO,
  recycleTAO,
  treasuryTAO,
  ownerTAO,
  minerCount,
  validatorCount,
  selected,
  onSelect,
  onOpenDrawer,
  onOpenPalette,
}: MarketSectionProps) {
  // Sort once (desc by share); reuse for every render.
  const sorted = useMemo(() => [...rows].sort((a, b) => b.share - a.share), [rows]);
  const realRepos = useMemo(() => sorted.filter((r) => r.share > 0), [sorted]);

  // Configured share = sum of every repo's emission share; the leftover up to
  // OSS_POOL recycles back to UID 0. We compute it from live data instead of
  // the HTML's hardcoded 0.39648.
  const configured = useMemo(
    () => Math.min(1, realRepos.reduce((acc, r) => acc + r.share, 0)),
    [realRepos],
  );
  const recycle = Math.max(0, 1 - configured);

  // Prefer live per-UID values from /api/sn74-emission when present; fall
  // back to the policy formula (configured-share derived) otherwise. The
  // formula gives the *intended* split; the per-UID values give what's
  // actually emitted on-chain (validators + miners + recycle + treasury).
  const minersDaily     = minerTAO     ?? subnetTAO * configured * OSS_POOL;
  const validatorsDaily = validatorTAO ?? null;
  const recyclingTao    = recycleTAO   ?? subnetTAO * recycle    * OSS_POOL;
  const treasury        = treasuryTAO  ?? subnetTAO * TREASURY_PCT;
  const ownerDaily      = ownerTAO     ?? null;
  const repoCount = realRepos.length;

  /* Build bar segments. The HTML floored each repo's visual width on touch
   * devices for tappability — we do the same when the user is on a coarse
   * pointer, otherwise honor the true share. */
  const [isTouchPrimary, setIsTouchPrimary] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(pointer: coarse), (hover: none)');
    const update = () => setIsTouchPrimary(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  interface Seg {
    kind: 'repo' | 'slack';
    w: number;
    repo: RepoRow | null;
    realPct: number;
    visualPct: number;
    left: number;
  }

  const segs = useMemo<Seg[]>(() => {
    const items: Array<{ kind: 'repo' | 'slack'; w: number; repo: RepoRow | null }> = sorted.map(
      (r) => ({ kind: 'repo' as const, w: r.share, repo: r }),
    );
    items.push({ kind: 'slack', w: recycle, repo: null });
    const total = items.reduce((s, x) => s + x.w, 0) || 1;
    const rawPcts = items.map((s) => (s.w / total) * 100);
    let visualPcts = rawPcts;
    if (isTouchPrimary) {
      const MIN_VISUAL = 3.5;
      const floored = rawPcts.map((p) => Math.max(p, MIN_VISUAL));
      const sum = floored.reduce((a, b) => a + b, 0);
      visualPcts = floored.map((p) => (p / sum) * 100);
    }
    let cumulative = 0;
    return items.map((it, i) => {
      const out: Seg = {
        kind: it.kind,
        w: it.w,
        repo: it.repo,
        realPct: rawPcts[i],
        visualPct: visualPcts[i],
        left: cumulative,
      };
      cumulative += visualPcts[i];
      return out;
    });
  }, [sorted, recycle, isTouchPrimary]);

  // Pct callouts only for the top 3 real repos that have a wide-enough segment.
  const topShareCutoff = useMemo(
    () => (realRepos.length >= 3 ? realRepos[2].share : 0),
    [realRepos],
  );

  const onSegClick = useCallback(
    (seg: Seg) => {
      if (seg.kind === 'slack') {
        onSelect({ kind: 'slack' });
        return;
      }
      if (!seg.repo) return;
      onSelect({ kind: 'repo', fullName: seg.repo.fullName });
      if (!isTouchPrimary) onOpenDrawer(seg.repo.fullName);
    },
    [onSelect, isTouchPrimary, onOpenDrawer],
  );

  const isSelected = (seg: Seg) => {
    if (selected == null) return false;
    if (selected.kind === 'slack') return seg.kind === 'slack';
    return seg.kind === 'repo' && seg.repo?.fullName === selected.fullName;
  };

  /* Desktop hover preview — the HTML updated the bar inspector on mouseenter
   * (ephemeral, doesn't change persistent selection) and restored on leave.
   * On touch devices this is a no-op since hover events fire weirdly. */
  const [hoverSeg, setHoverSeg] = useState<SelectedSeg>(null);
  const onSegHover = useCallback(
    (seg: Seg) => {
      if (isTouchPrimary) return;
      setHoverSeg(
        seg.kind === 'slack'
          ? { kind: 'slack' }
          : seg.repo ? { kind: 'repo', fullName: seg.repo.fullName } : null,
      );
    },
    [isTouchPrimary],
  );
  const onSegLeave = useCallback(() => {
    if (isTouchPrimary) return;
    setHoverSeg(null);
  }, [isTouchPrimary]);
  const inspectorTarget: SelectedSeg = hoverSeg ?? selected;

  return (
    <section style={{ padding: '24px 16px 16px' }}>
      <div className={styles.container}>
        {/* Headline — heading left, stats right on lg+ (HTML's flex-col → lg:flex-row) */}
        <div className={styles.headlineRow}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--fg-subtle)',
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                fontWeight: 500,
              }}
            >
              SN74 emissions today
            </div>
            <h1
              style={{
                fontSize: 'clamp(20px, 2.5vw, 26px)',
                fontWeight: 500,
                margin: '4px 0 0',
                lineHeight: 1.2,
              }}
            >
              <span
                className={`${styles.textTao} ${subnetTAOLoaded ? '' : styles.textFgMute}`}
                style={{ fontWeight: 500, letterSpacing: '-0.02em' }}
                title={
                  subnetTAOLoaded
                    ? 'SN74 daily TAO emission = miners + validators (regular dividends) + owner cut. Excludes recycle (UID 0) and treasury (UID 111), which earn alpha on-chain but aren\'t productive emissions to participants. From TaoMarketCap; refreshes every minute.'
                    : 'Loading live SN74 emission from TaoMarketCap… showing fallback value until the first fetch completes.'
                }
              >
                {totalSubnetTAO.toFixed(2)}
              </span>
              <span className={styles.textTao} style={{ fontWeight: 500 }}>
                {' '}TAO/day
              </span>
              {!subnetTAOLoaded ? (
                <span
                  className={styles.textFgFaint}
                  style={{ fontSize: 12, marginLeft: 8, fontStyle: 'italic', fontWeight: 400 }}
                >
                  loading…
                </span>
              ) : null}
            </h1>
            <p
              style={{
                fontSize: 12.5,
                color: 'var(--fg-subtle)',
                marginTop: 8,
                lineHeight: 1.5,
                maxWidth: '36rem',
              }}
            >
              Live daily TAO emission for SN74, pulled from{' '}
              <a
                href="https://taomarketcap.com/subnets/74"
                target="_blank"
                rel="noreferrer"
                style={{
                  color: 'var(--fg-muted)',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--border-strong)',
                }}
              >
                taomarketcap
              </a>
              . All per-repo TAO figures below scale from it.
            </p>
          </div>

          {/* Stat grid — 2-col on mobile, up to 6-col on md+, inline flex-end
            * on lg+. Validator + Owner cards only render once
            * /api/sn74-emission has returned a value (otherwise we don't know
            * the real validator/miner split, nor the owner cut). */}
          <div className={styles.statRow}>
            <Stat
              label="miners / day"
              value={minersDaily.toFixed(2)}
              color="var(--color-feat)"
              sub={
                minerCount != null
                  ? `${minerCount} miner UIDs`
                  : `${(configured * 100).toFixed(1)}% across ${repoCount} repos`
              }
            />
            {validatorsDaily != null ? (
              <Stat
                label="validators / day"
                value={validatorsDaily.toFixed(2)}
                color="var(--color-stream-issue)"
                sub={
                  validatorCount != null
                    ? `${validatorCount} validator UIDs`
                    : 'validator UIDs'
                }
              />
            ) : null}
            <Stat
              label="recycling / day"
              value={recyclingTao.toFixed(2)}
              color="var(--color-refact)"
              sub="UID 0"
            />
            <Stat
              label="treasury / day"
              value={treasury.toFixed(2)}
              color="var(--fg-muted)"
              sub="UID 111"
            />
            {ownerDaily != null ? (
              <Stat
                label="owner / day"
                value={ownerDaily.toFixed(2)}
                color="var(--color-enh)"
                sub="paid to owner_hotkey"
              />
            ) : null}
          </div>
        </div>

        {/* Market bar */}
        <div style={{ position: 'relative', marginBottom: 28 }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--fg-subtle)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              OSS pool · split among repos · slack recycles
            </span>
            <span className={styles.mono} style={{ fontSize: 11, textTransform: 'none', letterSpacing: 0, flexShrink: 0 }}>
              1.000 of pool
            </span>
          </div>

          <div className={`${styles.marketBarWrap} ${styles.hideOnMobile}`}>
            <div className={styles.marketPcts}>
              {segs.map((seg, i) => {
                if (seg.kind === 'slack') {
                  if (seg.visualPct < 8) return null;
                  return (
                    <div
                      key={`pct-slack-${i}`}
                      className={styles.segPctAbs}
                      style={{ left: `${seg.left}%`, width: `${seg.visualPct}%`, color: 'var(--fg-muted)' }}
                    >
                      {(seg.w * 100).toFixed(1)}%
                    </div>
                  );
                }
                const r = seg.repo!;
                if (r.share < topShareCutoff || seg.visualPct < 4) return null;
                return (
                  <div
                    key={`pct-${r.fullName}`}
                    className={styles.segPctAbs}
                    style={{
                      left: `${seg.left}%`,
                      width: `${seg.visualPct}%`,
                      color: r.isSelf ? 'var(--color-mine)' : 'var(--fg-muted)',
                    }}
                  >
                    {(r.share * 100).toFixed(1)}%
                  </div>
                );
              })}
            </div>

            <div className={styles.marketBar}>
              {segs.map((seg, i) => {
                if (seg.kind === 'slack') {
                  const tao = subnetTAO * seg.w * OSS_POOL;
                  return (
                    <div
                      key={`seg-slack-${i}`}
                      className={`${styles.seg} ${isSelected(seg) ? styles.isSelected : ''}`}
                      style={{
                        width: `${seg.visualPct}%`,
                        background:
                          'repeating-linear-gradient(45deg, var(--hatch-a) 0 6px, var(--hatch-b) 6px 12px)',
                      }}
                      onClick={() => onSegClick(seg)}
                      onMouseEnter={() => onSegHover(seg)}
                      onMouseLeave={onSegLeave}
                    >
                      <div className={styles.tip}>
                        <div className={styles.textFg} style={{ fontWeight: 500 }}>Recycle slack</div>
                        <div className={`${styles.mono} ${styles.textFgMute}`} style={{ marginTop: 2 }}>
                          {(seg.w * 100).toFixed(2)}% of pool · {tao.toFixed(2)} TAO/day → UID 0
                        </div>
                      </div>
                    </div>
                  );
                }
                const r = seg.repo!;
                const isSelf = r.isSelf;
                const tao = repoDailyTAO(r, subnetTAO);
                return (
                  <div
                    key={`seg-${r.fullName}`}
                    className={`${styles.seg} ${isSelected(seg) ? styles.isSelected : ''}`}
                    style={{
                      width: `${seg.visualPct}%`,
                      background: repoFill(r),
                      /* Double-ring outline so "your repo" still pops against
                       * the saturated-indigo PR fill (single-color outline
                       * was disappearing into the segment). Outer dark
                       * stroke gives separation; inner light-indigo stroke
                       * carries the brand color. */
                      boxShadow: isSelf
                        ? 'inset 0 0 0 1px var(--bg-canvas), inset 0 0 0 3px var(--color-mine)'
                        : undefined,
                    }}
                    onClick={() => onSegClick(seg)}
                    onMouseEnter={() => onSegHover(seg)}
                    onMouseLeave={onSegLeave}
                    title={r.fullName}
                  >
                    <div className={styles.tip}>
                      <div className={styles.textFg} style={{ fontWeight: 500 }}>
                        {r.fullName}
                        {isSelf ? ' · your repo' : ''}
                      </div>
                      <div className={`${styles.mono} ${styles.textFgMute}`} style={{ marginTop: 2 }}>
                        {(r.share * 100).toFixed(3)}% of pool ·{' '}
                        <span className={styles.textTao}>{tao.toFixed(3)} TAO/day</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.marketLabels}>
              {segs.map((seg, i) => {
                if (seg.kind !== 'slack' || seg.visualPct < 8) return null;
                return (
                  <div
                    key={`label-slack-${i}`}
                    className={styles.segLabelAbs}
                    style={{ left: `${seg.left}%`, width: `${seg.visualPct}%`, color: 'var(--fg-subtle)' }}
                  >
                    Recycle
                  </div>
                );
              })}
            </div>
          </div>

          {/* Treemap on mobile */}
          <Treemap
            rows={realRepos}
            recycle={recycle}
            subnetTAO={subnetTAO}
            onOpenDrawer={onOpenDrawer}
          />

          {/* Bar inspector — desktop only (mobile uses the treemap directly) */}
          <div className={styles.hideOnMobile}>
            <BarInspector
              selected={inspectorTarget}
              rows={rows}
              subnetTAO={subnetTAO}
              recycle={recycle}
              onOpenDrawer={onOpenDrawer}
              onOpenPalette={onOpenPalette}
            />
          </div>

          <div className={`${styles.hideOnMobile} ${styles.marketLegend}`}>
            <LegendDot color="var(--color-stream-pr)" label="PR" />
            <LegendDot color="var(--color-stream-issue)" label="Issue discovery" />
            <LegendDot color="color-mix(in srgb, var(--color-stream-pr) 50%, var(--color-stream-issue))" label="Mixed" />
            <LegendDot border="var(--color-mine)" bg="var(--accent-subtle)" label="Your repo" />
          </div>

          {/* Top-N leaderboard */}
          <Leaderboard
            sorted={sorted}
            subnetTAO={subnetTAO}
            onOpenDrawer={onOpenDrawer}
          />

        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="tnum" style={{ color, fontSize: 26, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 10.5,
          color: 'var(--fg-subtle)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          marginTop: 4,
        }}
      >
        {label}
      </div>
      {sub ? (
        <div className="mono" style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function LegendDot({
  color,
  gradient,
  border,
  bg,
  label,
  style,
}: {
  color?: string;
  gradient?: string;
  border?: string;
  bg?: string;
  label: string;
  style?: React.CSSProperties;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: gradient ?? color ?? bg,
          border: border ? `1px solid ${border}` : undefined,
        }}
      />
      {label}
    </span>
  );
}

/* ============== Treemap (mobile only) ============== */
function Treemap({
  rows,
  recycle,
  subnetTAO,
  onOpenDrawer,
}: {
  rows: RepoRow[];
  recycle: number;
  subnetTAO: number;
  onOpenDrawer: (full: string) => void;
}) {
  type Seg = { kind: 'repo' | 'slack'; w: number; repo: RepoRow | null };
  const segs: Seg[] = [
    ...rows.map((r) => ({ kind: 'repo' as const, w: r.share, repo: r })),
    { kind: 'slack' as const, w: recycle, repo: null },
  ];
  const rects = squarify(
    segs.map((s) => ({ w: s.w, data: s })),
    0,
    0,
    1,
    1,
    { sort: false },
  );

  return (
    <div className={styles.treemapWrap}>
      <div className={styles.treemapGrid}>
        {rects.map((rect, i) => {
          const seg = rect.data;
          const isSlack = seg.kind === 'slack';
          const r = isSlack ? null : seg.repo!;
          const isSelf = !isSlack && r!.isSelf;
          const name = isSlack ? 'Recycle' : r!.name;
          const pct = (seg.w * 100).toFixed(seg.w >= 0.05 ? 1 : 2);
          const tao = isSlack ? subnetTAO * recycle * OSS_POOL : repoDailyTAO(r!, subnetTAO);
          const wPx = rect.w * 360;
          const hPx = rect.h * 400;
          const minDim = Math.min(wPx, hPx);
          let sizeClass = '';
          if (minDim < 38) sizeClass = styles.sizeTiny;
          else if (minDim < 60) sizeClass = styles.sizeSmall;
          const textLight = !isSlack && r!.issue === 1 ? styles.textLight : '';
          const taoStr = isSlack ? '' : formatTAO(tao);
          const classes = [
            styles.treemapCell,
            isSelf ? styles.isSelf : '',
            isSlack ? styles.isSlack : '',
            textLight,
            sizeClass,
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={`cell-${i}`}
              className={classes}
              style={{
                left: `${(rect.x * 100).toFixed(3)}%`,
                top: `${(rect.y * 100).toFixed(3)}%`,
                width: `${(rect.w * 100).toFixed(3)}%`,
                height: `${(rect.h * 100).toFixed(3)}%`,
                background: isSlack ? undefined : repoFill(r!),
              }}
              onClick={() => {
                if (!isSlack) onOpenDrawer(r!.fullName);
              }}
            >
              <div className={styles.treemapCellTop}>
                <div className={styles.treemapCellName}>{name}</div>
                {isSelf ? <div className={styles.treemapSelfDot} title="your repo" /> : null}
              </div>
              <div className={styles.treemapCellBottom}>
                <span className={styles.treemapCellPct}>{pct}%</span>
                {!isSlack && taoStr ? <span className={styles.treemapCellTao}>{taoStr} τ</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============== Bar inspector (below market bar) ============== */
function BarInspector({
  selected,
  rows,
  subnetTAO,
  recycle,
  onOpenDrawer,
  onOpenPalette,
}: {
  selected: SelectedSeg;
  rows: RepoRow[];
  subnetTAO: number;
  recycle: number;
  onOpenDrawer: (full: string) => void;
  onOpenPalette: () => void;
}) {
  if (selected == null) {
    return (
      <div className={`${styles.barInspector}`} style={{ marginTop: 12 }}>
        <div className={styles.inspectorEmpty}>
          <div>Tap any segment above to inspect</div>
          <div className={styles.inspectorHint}>
            Or browse the full list — easier when segments are narrow
          </div>
          <button
            type="button"
            className={styles.inspectorBrowseBtn}
            style={{ marginTop: 10 }}
            onClick={onOpenPalette}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            Browse all {rows.length} repos
          </button>
        </div>
      </div>
    );
  }

  if (selected.kind === 'slack') {
    const tao = subnetTAO * recycle * OSS_POOL;
    return (
      <div className={`${styles.barInspector} ${styles.isActive}`} style={{ marginTop: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 6,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            background:
              'repeating-linear-gradient(45deg, var(--hatch-a) 0 6px, var(--hatch-b) 6px 12px)',
            border: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-subtle)" strokeWidth="2">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{ fontSize: 13, color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
          >
            <span style={{ fontWeight: 500 }}>Recycle slack</span>
            <span
              className={styles.badge}
              style={{
                background: 'rgba(98,102,109,0.08)',
                color: 'var(--fg-muted)',
                borderColor: 'rgba(98,102,109,0.22)',
                fontSize: 9.5,
                padding: '0 4px',
              }}
            >
              unallocated
            </span>
          </div>
          <div className={styles.mono} style={{ fontSize: 11, marginTop: 4 }}>
            <span className={styles.textFgDim}>{(recycle * 100).toFixed(2)}% of pool</span>
            <span className={styles.textFgFaint} style={{ margin: '0 4px' }}>·</span>
            <span className={styles.textTao}>{tao.toFixed(2)} τ/day</span>
            <span className={styles.textFgFaint} style={{ margin: '0 4px' }}>·</span>
            <span className={styles.textFgMute}>→ UID 0</span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--border-strong)', fontStyle: 'italic' }}>
          nothing to open
        </div>
      </div>
    );
  }

  const r = rows.find((x) => x.fullName === selected.fullName);
  if (!r) return null;
  const tao = repoDailyTAO(r, subnetTAO);
  /* Solid mixed-stream blend (no gradient) — matches the segment fill
   * computed by repoFill() in incentives.ts. */
  const streamColor =
    r.share === 0 ? 'var(--border-strong)' :
    r.issue === 1 ? 'var(--color-stream-issue)' :
    r.issue === 0 ? 'var(--color-stream-pr)' :
    `color-mix(in srgb, var(--color-stream-pr) ${((1 - r.issue) * 100).toFixed(1)}%, var(--color-stream-issue))`;
  const streamLabel =
    r.share === 0 ? 'benchmark' : r.issue === 1 ? 'issue discovery' : r.issue === 0 ? 'PR' : 'mixed';
  const cred =
    r.activity.merged30d + r.activity.closed30d > 0
      ? r.activity.merged30d / (r.activity.merged30d + r.activity.closed30d)
      : 0;
  const credColor =
    cred >= 0.85 ? 'var(--color-moss-400)' :
    cred >= 0.7  ? 'var(--color-enh)' :
    cred > 0     ? 'var(--color-refact)' :
    'var(--fg-subtle)';
  const compLevel = competitionLevel(r);
  const merge = mergeSpeedLevel(r);

  return (
    <div className={`${styles.barInspector} ${styles.isActive}`} style={{ marginTop: 12 }}>
      <Avatar fullName={r.fullName} size="md" />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span className={styles.textFgDim}>{r.owner}/</span>
            <span style={{ fontWeight: 500 }}>{r.name}</span>
          </span>
          {r.isSelf ? <span className={`${styles.badge} ${styles.badgeSelf}`}>you</span> : null}
        </div>
        <div className={styles.mono} style={{ fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className={styles.leaderStream} style={{ background: streamColor }} />
          <span className={styles.textFgDim}>{streamLabel}</span>
          <span className={styles.textFgFaint}>·</span>
          <span className={styles.textFgDim}>{(r.share * 100).toFixed(2)}%</span>
          <span className={styles.textFgFaint}>·</span>
          <span className={styles.textTao}>{formatTAO(tao)} τ/day</span>
        </div>
        <button
          type="button"
          className={styles.inspectorBrowseLink}
          style={{ marginTop: 6 }}
          onClick={onOpenPalette}
        >
          Not the right one? Browse all {rows.length} →
        </button>
      </div>

      <div className={styles.inspectorStats}>
        <div className={styles.inspectorStat}>
          <span className={styles.inspectorStatLabel}>30d merged</span>
          <span className={`${styles.inspectorStatValue} ${styles.mono}`}>
            {r.activity.merged30d}
            <span className={styles.textFgMute}> · {r.activity.openPRs} open</span>
          </span>
        </div>
        {r.share > 0 ? (
          <>
            <div className={styles.inspectorStat}>
              <span className={styles.inspectorStatLabel}>Merge cred</span>
              <span className={`${styles.inspectorStatValue} ${styles.mono}`} style={{ color: credColor }}>
                {(cred * 100).toFixed(0)}%
              </span>
            </div>
            <div className={styles.inspectorStat}>
              <span className={styles.inspectorStatLabel}>Competition</span>
              <span className={styles.inspectorStatValue} style={{ color: compLevel.color }}>
                {compLevel.label}
              </span>
            </div>
            <div className={styles.inspectorStat}>
              <span className={styles.inspectorStatLabel}>Time to merge</span>
              <span className={styles.inspectorStatValue} style={{ color: merge.color }}>
                {merge.label}
              </span>
            </div>
          </>
        ) : (
          <div className={styles.inspectorStat}>
            <span className={styles.inspectorStatLabel}>Pool share</span>
            <span className={styles.inspectorStatValue} style={{ color: 'var(--border-strong)' }}>
              zero — benchmark only
            </span>
          </div>
        )}
      </div>

      <TopEarnersRow owner={r.owner} name={r.name} />

      <button
        type="button"
        className={styles.inspectorOpenBtn}
        style={{ marginLeft: 'auto' }}
        onClick={() => onOpenDrawer(r.fullName)}
      >
        <span>Open</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

/* ============== Trending leaderboard ============== */
/** Trending score = PR + issue creates over the last 7 days. Uses the
 *  same 30-bucket sparklines that drive the per-card "wow" indicator so
 *  it stays consistent with what users see on the cards below. */
function trendScore(r: RepoRow): number {
  const last7 = (arr: number[]) => arr.slice(-7).reduce((s, v) => s + v, 0);
  return last7(r.activity.spark) + last7(r.activity.sparkIssues);
}

function Leaderboard({
  sorted,
  subnetTAO,
  onOpenDrawer,
}: {
  sorted: RepoRow[];
  subnetTAO: number;
  onOpenDrawer: (full: string) => void;
}) {
  const realRepos = sorted.filter((r) => r.share > 0);
  const TOP_N = 6;
  // Re-sort by trending activity (7d) for this section; the bar above
  // stays sorted by share since visual area there encodes emission.
  const trendingSorted = [...realRepos].sort((a, b) => trendScore(b) - trendScore(a));
  let topRepos = trendingSorted.slice(0, TOP_N);
  // If "self" exists but isn't in the top, swap it into the last slot so the
  // user can still find their own repo without scrolling.
  const selfRepo = trendingSorted.find((r) => r.isSelf);
  if (selfRepo && !topRepos.includes(selfRepo)) {
    topRepos = [...topRepos.slice(0, TOP_N - 1), selfRepo];
  }
  const remaining = realRepos.length - topRepos.length;

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          fontSize: 10.5,
          color: 'var(--fg-subtle)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>Trending repos · click any to inspect</span>
        <span style={{ color: 'var(--border-strong)', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
          Sorted by PR + issue activity · last 7 days
        </span>
      </div>
      <div className={styles.leaderGrid}>
        {topRepos.map((r) => {
          /* Mixed: blend the two stream colors into a single solid hue
           * (no gradient) — matches repoFill()'s mixed-stream behavior. */
          const streamColor =
            r.issue === 1
              ? 'var(--color-stream-issue)'
              : r.issue === 0
                ? 'var(--color-stream-pr)'
                : `color-mix(in srgb, var(--color-stream-pr) ${((1 - r.issue) * 100).toFixed(1)}%, var(--color-stream-issue))`;
          const rank = topRepos.indexOf(r) + 1;
          const trend7d = trendScore(r);
          return (
            <button
              key={r.fullName}
              type="button"
              className={styles.leaderCard}
              onClick={() => onOpenDrawer(r.fullName)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className={styles.leaderRank}>{rank}</span>
                <Avatar fullName={r.fullName} size="sm" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span className={styles.textFgDim}>{r.owner}/</span>
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span className={styles.leaderStream} style={{ background: streamColor }} />
                    <span className={`${styles.mono} ${styles.textFgDim}`} style={{ fontSize: 10.5 }}>
                      {(r.share * 100).toFixed(2)}%
                    </span>
                    <span className={styles.textFgFaint} style={{ fontSize: 10 }}>·</span>
                    <span className={`${styles.mono} ${styles.textTao}`} style={{ fontSize: 10.5 }}>
                      {formatTAO(repoDailyTAO(r, subnetTAO))} τ/d
                    </span>
                    <span className={styles.textFgFaint} style={{ fontSize: 10 }}>·</span>
                    <span
                      className={`${styles.mono} ${trend7d > 0 ? styles.textFg : styles.textFgFaint}`}
                      style={{ fontSize: 10.5 }}
                      title={`${trend7d} PR + issue create${trend7d === 1 ? '' : 's'} in the last 7 days`}
                    >
                      {trend7d > 0 ? `+${trend7d}` : '0'} 7d
                    </span>
                  </div>
                </div>
                {r.isSelf ? <span className={`${styles.badge} ${styles.badgeSelf}`}>you</span> : null}
              </div>
            </button>
          );
        })}
        {remaining > 0 ? (
          <div className={styles.leaderMore}>
            <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              + {remaining} more
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
              in the list below
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ============== Per-repo top earners (inside BarInspector) ============== */
/** Subtle metallic tints for ranks 1–3 (gold / silver / bronze). */
const EARNER_TINTS = [
  { fg: '#d4a857', glow: 'rgba(212, 168, 87, 0.14)' }, // gold
  { fg: '#a8b3bd', glow: 'rgba(168, 179, 189, 0.12)' }, // silver
  { fg: '#b08763', glow: 'rgba(176, 135, 99, 0.12)' }, // bronze
] as const;


/** Top OSS contributors for the selected repo (top 3 by score, eligible
 *  only). Rendered as a second row inside the BarInspector when a repo
 *  segment is in focus. Empty array → row is not rendered. */
function TopEarnersRow({ owner, name }: { owner: string; name: string }) {
  const { data: repoMiners } = useQuery<RepoMinersResponse>({
    queryKey: ['gt-repo-miners', owner, name],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/gt/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/miners`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<RepoMinersResponse>;
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const top = useMemo<RepoMiner[]>(() => {
    /* Eligibility is computed by the route from the validator's per-repo
     * RepoEvaluation.is_eligible flag (https://api.gittensor.io/repos/.../miners).
     * Only surface contributors who currently meet the repo's thresholds. */
    const list = repoMiners?.ossContributions ?? [];
    return list
      .filter((m) => m.isEligible === true)
      .filter((m) => (m.score ?? 0) > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [repoMiners]);
  // Distinguish "still loading" from "loaded, none eligible" — the loading
  // case stays silent so the inspector doesn't flicker, but once the fetch
  // resolves we surface an explicit empty state so the user can tell the
  // repo simply has nobody eligible right now (vs. data not arriving).
  if (!repoMiners) return null;
  if (top.length === 0) {
    return (
      <div className={styles.inspectorEarners}>
        <span className={styles.inspectorEarnersLabel}>Top earners</span>
        <div className={styles.inspectorEarnersEmpty}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>No miners currently eligible on this repo</span>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.inspectorEarners}>
      <span className={styles.inspectorEarnersLabel}>Top earners</span>
      <div className={styles.inspectorEarnersList}>
        {top.map((m, i) => {
          const tint = EARNER_TINTS[i] ?? EARNER_TINTS[2];
          return (
            <a
              key={m.githubId || m.githubUsername}
              href={`https://github.com/${encodeURIComponent(m.githubUsername)}`}
              target="_blank"
              rel="noreferrer"
              className={styles.inspectorEarnerChip}
              title={`@${m.githubUsername} · score ${m.score.toFixed(2)} · ${m.prCount} merged PR${m.prCount === 1 ? '' : 's'}`}
            >
              <span
                aria-hidden
                className={`mono tnum ${styles.inspectorEarnerRank}`}
                style={{ background: tint.glow, color: tint.fg, borderColor: `${tint.fg}33` }}
              >
                {i + 1}
              </span>
              <Avatar fullName={m.githubUsername} size="sm" />
              <span className={styles.inspectorEarnerName}>@{m.githubUsername}</span>
              <span className={`mono tnum ${styles.inspectorEarnerScore}`} style={{ color: tint.fg }}>
                {m.score.toFixed(1)}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
