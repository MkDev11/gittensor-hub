'use client';

/* eslint-disable @next/next/no-img-element */

/* Treemap headline — a map of the SN74 miner emission slice.
 *
 * Most subnet emission recycles (UID 0) or funds the issues treasury (UID 111),
 * so those would dwarf every miner if drawn as tiles. Instead the allocation
 * bar up top shows the full pool split (miners vs recycle vs treasury), and the
 * treemap below is miners-only — each tile sized by daily TAO, colored by track.
 * Hovering a tile drives the overview panel; clicking a miner opens the drawer. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GraphIcon } from '@primer/octicons-react';
import { formatCount, formatNumber, formatUsd } from '@/lib/format';
import styles from '../page.module.css';
import { buildPoolTiles, score, shareText, type EmissionData, type MinerView, type PoolTile } from '../_lib/miners';
import { fillBadge, repoStreamColor, streamBackground, streamColor, streamLabel, ISSUE_COLOR, MAINTAINER_COLOR, PR_COLOR } from '../_lib/streams';
import { squarify } from '../_lib/squarify';
import { RankMedal } from './shared';
import StreamTags from './StreamTags';

interface HeadlineProps {
  views: MinerView[];
  /** The signed-in user's own miner row, if any — the overview defaults to it. */
  myView: MinerView | null;
  lastSync: string;
  emission?: EmissionData | null;
  /** True until the first miner data arrives — drives the overview skeleton. */
  loading?: boolean;
  onSelectMiner: (view: MinerView) => void;
  onBrowse: () => void;
}

/** Max individual miner tiles by width — fewer on small screens so every tile
 *  stays big enough to show its avatar + UID. The rest fold into one "Others"
 *  tile. */
function maxMinerTiles(width: number): number {
  if (width >= 1000) return 20;
  if (width >= 720) return 16;
  if (width >= 500) return 13;
  return 11;
}

const OTHERS_COLOR = 'var(--border-strong)';

function tileColor(tile: PoolTile): string {
  return tile.kind === 'miner' && tile.view ? streamColor(tile.view) : OTHERS_COLOR;
}

function useMeasuredWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export default function Headline({ views, myView, lastSync, emission, loading, onSelectMiner, onBrowse }: HeadlineProps) {
  return (
    <section className={styles.headline} aria-label="Miner emission map">
      <div className={styles.headlineStage}>
        <Treemap views={views} emission={emission} myView={myView} loading={loading} onSelect={onSelectMiner} onBrowse={onBrowse} />
      </div>
      <div className={styles.headlineFoot}>
        <GraphIcon size={12} />
        hover or tap a tile for details · synced {lastSync}
      </div>
    </section>
  );
}

// ─── Treemap ────────────────────────────────────────────────────────────────

// Placeholder weights for the loading skeleton — a long-tailed distribution (a
// few big tiles, a long tail of small ones) so the squarified skeleton reads
// like a real miner treemap at any width, instead of flat full-height bars.
const SKELETON_WEIGHTS = [8, 5, 3.4, 2.6, 2, 1.7, 1.4, 1.2, 1, 0.9, 0.8, 0.7, 0.6, 0.5];

function Treemap({
  views,
  emission,
  myView,
  loading,
  onSelect,
  onBrowse,
}: {
  views: MinerView[];
  emission?: EmissionData | null;
  myView: MinerView | null;
  loading?: boolean;
  onSelect: (view: MinerView) => void;
  onBrowse: () => void;
}) {
  const [ref, width] = useMeasuredWidth();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  // Responsive height: narrower viewports get a taller map so the 20+ tiles
  // don't collapse into unreadable slivers. Wide screens stay compact.
  const height = width >= 1024 ? 320 : width >= 680 ? 380 : width >= 480 ? 430 : 470;
  const myKey = myView?.key ?? null;

  const maxTiles = maxMinerTiles(width);
  const tiles = useMemo(() => buildPoolTiles(views, maxTiles), [views, maxTiles]);

  // Pool split: miners (sum of tiles) + recycle (UID 0) + treasury (UID 111).
  const minerPool = tiles.reduce((s, t) => s + t.tao, 0);
  const recycle = emission?.recycleTaoPerDay ?? 0;
  const treasury = emission?.treasuryTaoPerDay ?? 0;
  const fullPool = minerPool + recycle + treasury;
  const minerCount = tiles.filter((t) => t.kind === 'miner').length;
  const maxTile = tiles.length > 0 ? Math.max(...tiles.map((t) => t.tao)) : 1;

  const rects = useMemo(() => {
    if (width <= 0 || tiles.length === 0) return [];
    // The "Others" aggregate sums the whole tail, so cap its DISPLAY weight to
    // the smallest visible miner. That keeps the input in descending order, so
    // squarify packs it cleanly as the last tile (bottom-right) WITHOUT the thin
    // sliver a large out-of-order tile would create. The inspector still reports
    // Others' true TAO/count.
    const minerTaos = tiles.filter((t) => t.kind === 'miner').map((t) => t.tao);
    const othersCap = minerTaos.length ? minerTaos[minerTaos.length - 1] : 0;
    const segs = tiles.map((t) => ({
      w: t.kind === 'others' && othersCap > 0 ? Math.min(t.tao, othersCap) : t.tao,
      data: t,
    }));
    return squarify(segs, 0, 0, width, height, { sort: false });
  }, [tiles, width, height]);

  // Loading skeleton tiles — squarified with the same packer as the real map so
  // the placeholder mosaic matches the treemap's shape on every viewport.
  const skeletonRects = useMemo(
    () =>
      loading && width > 0
        ? squarify(SKELETON_WEIGHTS.map((w) => ({ w, data: null })), 0, 0, width, height, { sort: false })
        : [],
    [loading, width, height],
  );

  // Inspector target: whatever the pointer is over, else whatever a click has
  // pinned. No default tile — on first load nothing is hovered or pinned, so the
  // inspector shows its empty "tap a tile" prompt (mirroring the repositories
  // overview) instead of auto-selecting a miner. mouseleave lives on the
  // container (not per-tile) so moving between tiles never flickers.
  const byKey = useMemo(() => new Map(tiles.map((t) => [t.key, t])), [tiles]);

  const target: PoolTile | null =
    (hoveredKey ? byKey.get(hoveredKey) : null) ?? (pinnedKey ? byKey.get(pinnedKey) : null) ?? null;

  // Clicking a miner tile both updates the panel and opens its detail drawer.
  const onTileClick = (tile: PoolTile) => {
    if (tile.kind === 'miner' && tile.view) {
      setPinnedKey(tile.key);
      onSelect(tile.view);
    } else {
      onBrowse();
    }
  };

  return (
    <div className={styles.treemapWrap}>
      <div ref={ref} className={styles.treemap} style={{ height }} onMouseLeave={() => setHoveredKey(null)}>
        {rects.map(({ x, y, w, h, data }) => {
          const big = w > 64 && h > 34;
          const tiny = w < 34 || h < 22;
          const huge = w > 180 && h > 120;
          const isMiner = data.kind === 'miner' && Boolean(data.view);
          // Show the avatar background + UID on any non-tiny miner tile; only the
          // larger ones also show the $/day line, to avoid clutter.
          const useAvatar = isMiner && w >= 40 && h >= 34;
          // The "others" tile renders a 2x2 face mosaic of its largest miners.
          const useMosaic = data.kind === 'others' && data.avatars.length > 0 && w >= 40 && h >= 34;
          const showUid = isMiner && data.view?.uid != null && w >= 48 && h >= 28;
          const showValue = w >= 76 && h >= 48;
          const showRank = isMiner && data.rank > 0 && data.rank <= 3 && w >= 44 && h >= 32;
          const tone = tileColor(data);
          const intensity = Math.max(0.14, Math.min(0.48, 0.16 + (data.tao / maxTile) * 0.34));

          const tileStyle: React.CSSProperties = {
            left: x,
            top: y,
            width: Math.max(0, w - 2),
            height: Math.max(0, h - 2),
          };
          if (useAvatar && data.view) {
            // Request a crisper avatar for the larger background.
            tileStyle.backgroundImage = `url(${data.view.avatarUrl.replace(/size=\d+/, 'size=288')})`;
          } else if (useMosaic) {
            // The 2x2 face mosaic is rendered as real <img>s below (object-fit:
            // cover) so square avatars crop cleanly instead of stretching to the
            // tile's aspect ratio (which looked distorted); just set the backing
            // color here in case any avatar fails to load.
            tileStyle.backgroundColor = 'var(--bg-inset)';
          } else {
            tileStyle.background = `color-mix(in srgb, ${tone} ${Math.round(intensity * 100)}%, var(--bg-canvas))`;
          }
          const tileTitle =
            data.kind === 'miner'
              ? `${data.label} · ${data.sub} · ${formatUsd(data.usd)}/day · ${shareText(data.tao, fullPool)} of pool`
              : `${data.label} · ${data.count} miners · ${formatUsd(data.usd)}/day · ${shareText(data.tao, fullPool)} of pool`;
          return (
            <button
              key={data.key}
              type="button"
              className={`${styles.treeTile} ${useAvatar || useMosaic ? styles.treeTileAvatarBg : ''} ${data.kind !== 'miner' && !useMosaic ? styles.treeSink : ''}`}
              style={tileStyle}
              title={tileTitle}
              aria-label={tileTitle}
              onMouseEnter={() => setHoveredKey(data.key)}
              onFocus={() => setHoveredKey(data.key)}
              onClick={() => onTileClick(data)}
            >
              {useMosaic && (
                <span className={styles.treeTileMosaic} aria-hidden>
                  {Array.from({ length: 4 }, (_, i) =>
                    data.avatars[i % data.avatars.length].replace(/size=\d+/, 'size=144'),
                  ).map((u, i) => (
                    <img key={i} src={u} alt="" loading="lazy" />
                  ))}
                </span>
              )}
              {showRank && <RankMedal rank={data.rank} className={styles.treeTileRank} />}
              {showUid && data.view && (
                <span
                  className={styles.treeTileUid}
                  style={{ background: streamBackground(data.view) }}
                  title={streamLabel(data.view)}
                >
                  {data.view.uid}
                </span>
              )}
              {!tiny && (
                <span className={styles.treeLabelRow}>
                  <span className={styles.treeName} style={{ fontSize: huge ? 14 : big ? 12 : 11 }}>
                    {data.label}
                  </span>
                </span>
              )}
              {showValue && (
                <span className={styles.treeValue} style={huge ? { fontSize: 12 } : undefined}>
                  {formatUsd(data.usd)}/d
                </span>
              )}
            </button>
          );
        })}
        {loading && tiles.length === 0 ? (
          skeletonRects.length > 0 ? (
            <div className={styles.treemapSkeleton} aria-hidden>
              {skeletonRects.map((r, i) => (
                <span
                  key={i}
                  className="gt-skeleton"
                  style={{ left: r.x, top: r.y, width: Math.max(0, r.w - 2), height: Math.max(0, r.h - 2) }}
                />
              ))}
            </div>
          ) : null
        ) : width <= 0 ? (
          <div className={styles.headlineEmpty}>Measuring layout…</div>
        ) : tiles.length === 0 ? (
          <div className={styles.headlineEmpty}>No earning miners to map yet.</div>
        ) : null}
      </div>

      <div className={styles.treeLegend}>
        <span className={styles.legendBar}>
          <span style={{ background: PR_COLOR }} />
          Pull requests
        </span>
        <span className={styles.legendBar}>
          <span style={{ background: ISSUE_COLOR }} />
          Issue discovery
        </span>
        <span className={styles.legendBar}>
          <span style={{ background: MAINTAINER_COLOR }} />
          Maintainer
        </span>
        <span className={styles.treeLegendNote}>top {minerCount} miners · sized by TAO/day</span>
      </div>

      <TreemapInspector tile={target} pool={fullPool} myKey={myKey} count={views.length} loading={loading} onOpen={onSelect} onBrowse={onBrowse} />
    </div>
  );
}

// ─── Overview inspector ───────────────────────────────────────────────────────

function TreemapInspector({
  tile,
  pool,
  myKey,
  count,
  loading,
  onOpen,
  onBrowse,
}: {
  tile: PoolTile | null;
  pool: number;
  myKey: string | null;
  count: number;
  loading?: boolean;
  onOpen: (view: MinerView) => void;
  onBrowse: () => void;
}) {
  // While the feed is loading there's no miner to show — render a skeleton in
  // the overview's shape so the section reads as "loading", not empty.
  if (!tile && loading) {
    return (
      <div className={`${styles.treeInspector} ${styles.treeInspectorActive}`} aria-busy="true">
        <span className="gt-skeleton" style={{ width: 44, height: 44, borderRadius: 8, flex: '0 0 auto' }} />
        <div className={styles.treeInspectorId}>
          <span className="gt-skeleton" style={{ display: 'block', width: 130, height: 13, borderRadius: 4 }} />
          <span className="gt-skeleton" style={{ display: 'block', width: 210, maxWidth: '90%', height: 11, borderRadius: 4, marginTop: 7 }} />
        </div>
        <div className={styles.treeInspectorSkeletonStats}>
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={styles.treeInspectorSkeletonStat}>
              <span className="gt-skeleton" style={{ display: 'block', width: 34, height: 8, borderRadius: 3 }} />
              <span className="gt-skeleton" style={{ display: 'block', width: 40, height: 13, borderRadius: 3 }} />
            </span>
          ))}
        </div>
        <span className="gt-skeleton" style={{ width: 72, height: 36, borderRadius: 5, flex: '0 0 auto' }} />
      </div>
    );
  }

  if (!tile) {
    return (
      <div className={styles.treeInspector}>
        <div className={styles.treeInspectorEmpty}>
          <div>Tap any tile above to inspect</div>
          <div className={styles.treeInspectorHint}>Or browse the full list — easier when tiles are small</div>
          <button type="button" className={styles.inspectorBrowseBtn} style={{ marginTop: 10 }} onClick={onBrowse}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            Browse all {count} miners
          </button>
        </div>
      </div>
    );
  }

  // The "Others" aggregate tile gets a compact info panel.
  if (tile.kind !== 'miner' || !tile.view) {
    return (
      <div className={`${styles.treeInspector} ${styles.treeInspectorActive}`}>
        {tile.avatars.length > 0 ? (
          <span className={styles.sinkMosaic} aria-hidden>
            {Array.from({ length: 4 }, (_, i) => tile.avatars[i % tile.avatars.length]).map((u, i) => (
              <img key={i} src={u.replace(/size=\d+/, 'size=96')} alt="" loading="lazy" />
            ))}
          </span>
        ) : (
          <span className={styles.sinkSwatch} style={{ background: OTHERS_COLOR }} aria-hidden />
        )}
        <div className={styles.treeInspectorId}>
          <div className={styles.identityLine}>
            <strong>Other miners</strong>
            <span className={styles.uidPill}>{tile.sub}</span>
          </div>
          <div className={styles.treeInspectorSub}>Smaller earners outside the top tiles</div>
          <button type="button" className={styles.treeInspectorBrowse} onClick={onBrowse}>
            Browse all miners →
          </button>
        </div>
        <div className={styles.treeInspectorStats}>
          <InspectorStat label="$/day" value={formatUsd(tile.usd)} tone="green" />
          <InspectorStat label="TAO/day" value={formatNumber(tile.tao, { digits: 2, fallback: '0' })} />
          <InspectorStat label="% pool" value={shareText(tile.tao, pool)} />
          <InspectorStat label="Miners" value={formatCount(tile.count, { fallback: '0' })} />
        </div>
      </div>
    );
  }

  const view = tile.view;
  return (
    <div className={`${styles.treeInspector} ${styles.treeInspectorActive}`}>
      <div className={styles.avatarWrap}>
        <img src={view.avatarUrl} alt={view.login} loading="lazy" />
        {tile.rank > 0 && tile.rank <= 3 ? <RankMedal rank={tile.rank} className={styles.cardRankMedal} /> : null}
      </div>

      <div className={styles.treeInspectorId}>
        <div className={styles.identityLine}>
          <strong title={view.login}>{view.login}</strong>
          <StreamTags view={view} />
          {view.key === myKey ? <span className={styles.youPill}>You</span> : null}
        </div>
        <div className={styles.treeInspectorSub}>
          <span className={styles.badge}>uid {view.uid ?? '-'}</span>
          <span className={styles.badge}>{shareText(view.taoPerDay, pool)} of pool</span>
          <span className={styles.badge} style={{ color: 'var(--success-fg)' }}>{formatNumber(view.taoPerDay, { digits: 3, fallback: '0' })} τ/day</span>
          <span className={styles.badge}>score {score(view.totalScore + view.issueScore)}</span>
          {view.isMaintainer && view.maintainerCut > 0 ? (
            <span className={styles.badge} style={{ color: MAINTAINER_COLOR }}>{Math.round(view.maintainerCut * 100)}% maintainer cut</span>
          ) : null}
        </div>
        <button type="button" className={styles.treeInspectorBrowse} onClick={onBrowse}>
          Not the one? Browse all miners →
        </button>
      </div>

      {view.topRepos.length > 0 ? (
        <>
          <span className={styles.treeDivider} aria-hidden />
          <div className={styles.topRepos}>
            <span className={styles.topReposLabel}>Top repos</span>
          <div className={styles.topReposList}>
            {view.topRepos.slice(0, 3).map((r) => {
              const owner = r.repo.split('/')[0];
              const repoColor = repoStreamColor(r, view.maintainerRepos);
              return (
                <a
                  key={r.repo}
                  href={`https://github.com/${r.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.topRepoChip}
                  style={fillBadge(repoColor)}
                  title={`${r.repo} · ${formatCount(r.prs, { fallback: '0' })} PRs · score ${score(r.prScore + r.issueScore)}`}
                >
                  <img className={styles.topRepoChipAvatar} src={`https://github.com/${encodeURIComponent(owner)}.png?size=48`} alt="" loading="lazy" />
                  <span className={styles.topRepoName} style={{ color: repoColor }}>{r.repo}</span>
                  <span className={styles.topRepoScore} style={{ color: repoColor }}>
                    {score(r.prScore + r.issueScore)}
                  </span>
                </a>
              );
            })}
          </div>
          </div>
        </>
      ) : null}

      <button type="button" className={styles.treeInspectorOpen} onClick={() => onOpen(view)}>
        Open
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

function InspectorStat({
  label,
  value,
  tone,
  sub,
  color,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'purple';
  sub?: string;
  color?: string;
}) {
  return (
    <div className={styles.treeInspectorStat}>
      <span>{label}</span>
      <strong
        className={tone === 'green' ? styles.treeStatGreen : tone === 'purple' ? styles.treeStatPurple : ''}
        style={color ? { color } : undefined}
      >
        {value}
        {sub ? <em className={styles.treeStatSub}>{sub}</em> : null}
      </strong>
    </div>
  );
}
