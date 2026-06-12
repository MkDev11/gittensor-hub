'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListUnorderedIcon, SearchIcon, SquareFillIcon, StarIcon } from '@primer/octicons-react';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { useMinerLogin } from '@/lib/use-miner';
import { useTrackedMiners } from '@/lib/tracked-miners';
import { formatCount } from '@/lib/format';
import type { MinersResponse } from '@/types/entities';
import styles from './page.module.css';
import {
  EMPTY_MINERS,
  SORT_OPTIONS,
  compareViews,
  minerTrackKey,
  minerView,
  num,
  rankMap,
  repoStreamShare,
  subnetTaoBase,
  type EmissionData,
  type MinerView,
  type SortDir,
  type SortKey,
  type ViewMode,
} from './_lib/miners';
import Headline from './_components/Headline';
import EmissionHeader from './_components/EmissionHeader';
import MinerCard from './_components/MinerCard';
import { MinerCardGridSkeleton } from './_components/shared';
import MinerListRow from './_components/MinerListRow';
import MinerModal from './_components/MinerModal';
import Palette from './_components/Palette';
import Dropdown from '@/components/Dropdown';
import { InlinePagination } from '@/components/repo-explorer/Pagination';
import { ISSUE_COLOR, MAINTAINER_COLOR, PR_COLOR, fillBadge } from './_lib/streams';

/** Reward-stream filter pills — mirror the treemap/palette stream colors. A miner
 *  matches a stream if they EARN it (a multi-stream miner matches more than one). */
type StreamFilter = 'all' | 'pr' | 'issue' | 'maintainer';
const STREAM_FILTERS: Array<{ key: StreamFilter; label: string; color: string }> = [
  { key: 'all', label: 'Show all', color: '' },
  { key: 'pr', label: 'Pull requests', color: PR_COLOR },
  { key: 'issue', label: 'Issue discovery', color: ISSUE_COLOR },
  { key: 'maintainer', label: 'Maintainer cut', color: MAINTAINER_COLOR },
];

export default function MinersPage() {
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();

  const [stream, setStream] = useState<StreamFilter>('all');
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('activity');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Hold real rows empty until after mount so the first client render matches
  // the SSR'd HTML (TanStack Query has no data on the server but may have a
  // warm client cache).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const { data, isLoading, isError, error } = useQuery<MinersResponse>({
    queryKey: ['miners', 'activity'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/miners/activity', { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<MinersResponse>;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const { data: emission } = useQuery<EmissionData>({
    queryKey: ['sn74-emission'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/sn74-emission', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<EmissionData>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Per-repo TAO base (active miners + recycle + treasury) — the value the
  // protocol's `emissionShare × OSS_POOL` formula is a fraction of. Drives every
  // emission figure on the page (headline, treemap, podium, per-repo) so they all
  // agree, matching the repositories page exactly.
  const subnetTao = subnetTaoBase(emission);

  const views = useMemo(() => {
    if (!hydrated) return [];
    const raw = data?.miners ?? EMPTY_MINERS;
    // Live TAO→USD rate from the feed (median usd/tao over earning miners) — used
    // to derive each miner's $/day from their ACCURATE TAO, so USD stays
    // consistent with the accurate emission everywhere (display + sort).
    const rates: number[] = [];
    for (const m of raw) {
      const t = num((m as { taoPerDay?: unknown }).taoPerDay);
      const u = num((m as { usdPerDay?: unknown }).usdPerDay);
      if (t > 0 && u > 0) rates.push(u / t);
    }
    rates.sort((a, b) => a - b);
    const usdPerTao = rates.length > 0 ? rates[Math.floor(rates.length / 2)] : 0;
    // Each miner's ACTUAL on-chain τ/day, keyed by uid (alpha_per_day × price) —
    // the exact TaoMarketCap figure, used as the authoritative headline emission.
    const perUid = emission?.perUidTaoPerDay ?? null;
    return raw.map((miner) => {
      // uid > 0 guards a missing uid (coerces to 0) from grabbing UID 0's recycle
      // emission; 0/111 are the recycle/treasury sinks, never real miners.
      const uid = num((miner as { uid?: unknown }).uid);
      const actual = perUid && uid > 0 ? perUid[uid] : undefined;
      return minerView(miner, subnetTao, usdPerTao, actual);
    });
  }, [data?.miners, emission, hydrated, subnetTao]);

  // Each repo's ACTUAL distributed emission (τ/day) — the sum of every contributor's
  // on-chain per-repo share, so the card's "repo total / your share" reconciles with
  // the now-accurate per-miner emission. (The old `emissionShare × subnetTAO` was the
  // NOTIONAL pool — it counted the ~60% that recycles unclaimed, so it overstated.)
  // Maintainer-only earning repos live in topRepos (pinned), not rows, so include both.
  const repoEmissionTotals = useMemo(() => {
    const totals = new Map<string, number>();
    const add = (repo: string, tao: number) => {
      if (tao > 0) totals.set(repo, (totals.get(repo) ?? 0) + tao);
    };
    for (const view of views) {
      const seen = new Set<string>();
      for (const row of view.rows) {
        add(row.repo.toLowerCase(), subnetTao * repoStreamShare(row));
        seen.add(row.repo.toLowerCase());
      }
      for (const row of view.topRepos) {
        if (!seen.has(row.repo.toLowerCase())) add(row.repo.toLowerCase(), subnetTao * repoStreamShare(row));
      }
    }
    return totals;
  }, [views, subnetTao]);

  const filtered = useMemo(() => {
    const list = views.filter((view) => {
      if (trackedOnly && !tracked.has(minerTrackKey(view))) return false;
      if (stream === 'pr' && !view.prEarning) return false;
      if (stream === 'issue' && !view.issueEarning) return false;
      if (stream === 'maintainer' && !view.isMaintainer) return false;
      return true;
    });
    return [...list].sort(compareViews(sortKey, sortDir));
  }, [sortDir, sortKey, stream, tracked, trackedOnly, views]);

  // Pagination — the card grid fits 4 rows (12); the list's compact rows fit more.
  const pageSize = viewMode === 'card' ? 12 : 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );
  // Jump back to the first page whenever the filter / sort / view changes.
  useEffect(() => {
    setPage(1);
  }, [stream, sortKey, sortDir, trackedOnly, viewMode]);

  // Paging from the footer scrolls back to the top of the board so the new page
  // starts in view rather than leaving the viewport at the bottom.
  const boardRef = useRef<HTMLElement>(null);
  const goToPage = useCallback((p: number) => {
    setPage(p);
    boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const selectedMiner = useMemo(
    () => (selectedId ? views.find((view) => view.key === selectedId) ?? null : null),
    [views, selectedId],
  );
  // Position of the open miner within the filtered list — powers the modal's
  // prev/next navigation (← / →), stepping across pages.
  const selectedIndex = useMemo(
    () => (selectedMiner ? filtered.findIndex((v) => v.key === selectedMiner.key) : -1),
    [filtered, selectedMiner],
  );

  const ranks = useMemo(
    () => ({
      activity: rankMap(views, 'activity'),
      score: rankMap(views, 'score'),
      earnings: rankMap(views, 'earnings'),
      repos: rankMap(views, 'repos'),
    }),
    [views],
  );

  const myKey = useMemo(() => {
    if (!me) return null;
    const found = views.find((view) => view.login.toLowerCase() === me.toLowerCase());
    return found?.key ?? null;
  }, [me, views]);

  // The signed-in user's own miner row, if they are one — lets us surface their
  // UID directly even when they're too small to appear as a treemap tile.
  const myView = useMemo(() => (myKey ? views.find((view) => view.key === myKey) ?? null : null), [myKey, views]);

  const lastSync = data?.fetched_at
    ? new Date(data.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'pending';

  // ⌘K opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectMiner = useCallback((view: MinerView) => {
    setSelectedId(view.key);
  }, []);

  const errorMessage = isError ? (error instanceof Error ? error.message : 'unknown error') : null;
  const showSkeleton = (!hydrated || isLoading) && !data;
  // Miner emission pool (TAO/day) — the denominator for each card/row share bar.
  // subnetTao (active miners + recycle + treasury) keeps per-card "% of pool" in
  // step with the treemap's fullPool and the repositories page, rather than the
  // distinct minerTaoPerDay field, which diverges from both.
  const poolTao = subnetTao;
  // Whole-subnet daily emission — denominator for each card's "% of total".
  const totalTao = emission?.totalTaoPerDay ?? 0;
  // Rank board for the ACTIVE sort, so a card's medal/#rank matches the list order
  // (null for non-rankable sorts like name/cred → cards show no rank).
  const rankBoard =
    sortKey === 'activity' || sortKey === 'score' || sortKey === 'earnings' || sortKey === 'repos'
      ? ranks[sortKey]
      : null;

  return (
    <main className={styles.page}>
      <section className={styles.section}>
      <div className={styles.container}>
        <EmissionHeader emission={emission} views={views} onSelectMiner={selectMiner} />
        <Headline
          views={views}
          myView={myView}
          lastSync={lastSync}
          emission={emission}
          loading={!data && !isError}
          onSelectMiner={selectMiner}
          onBrowse={() => setPaletteOpen(true)}
        />
      </div>
      </section>

      <section className={styles.toolbar} aria-label="Miner controls">
        <div className={styles.toolbarInner}>
        <div className={styles.toolbarFilters}>
        <span className={styles.filterBy}>Filter by</span>
        <div className={styles.filterChips}>
          {STREAM_FILTERS.map((f) => {
            const active = stream === f.key;
            return (
              <button
                key={f.key}
                type="button"
                className={styles.chip}
                style={active ? fillBadge(f.color || 'var(--accent-emphasis)') : undefined}
                aria-pressed={active}
                onClick={() => setStream(f.key)}
              >
                {f.color ? <span className={styles.chipDot} style={{ background: f.color }} /> : null}
                {f.label}
              </button>
            );
          })}
        </div>
        </div>

        <div className={styles.toolbarRight}>
          <button
            type="button"
            className={trackedOnly ? styles.trackedButtonActive : styles.trackedButton}
            aria-pressed={trackedOnly}
            onClick={() => setTrackedOnly((current) => !current)}
          >
            <StarIcon size={14} />
            <span className={styles.hideOnMobile}>Tracked</span>
            <span className={styles.countPill}>{tracked.size}</span>
          </button>
          <label className={styles.toolbarSort}>
            <span className={`${styles.sortLabel} ${styles.hideOnMobile}`}>Sort</span>
            <Dropdown<SortKey>
              value={sortKey}
              options={SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
              onChange={(next) => {
                setSortKey(next);
                setSortDir(next === 'name' ? 'asc' : 'desc');
              }}
              size="xsmall"
              width={170}
              ariaLabel="Sort miners"
              closeOnScroll
            />
          </label>

          <div className={styles.viewToggleGroup} role="group" aria-label="View mode">
            <button
              type="button"
              className={`${styles.viewToggle} ${viewMode === 'card' ? styles.viewToggleActive : ''}`}
              onClick={() => setViewMode('card')}
              title="Card view"
              aria-pressed={viewMode === 'card'}
            >
              <SquareFillIcon size={11} />
              <span className={styles.viewToggleLabel}>Cards</span>
            </button>
            <button
              type="button"
              className={`${styles.viewToggle} ${viewMode === 'list' ? styles.viewToggleActive : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
              aria-pressed={viewMode === 'list'}
            >
              <ListUnorderedIcon size={12} />
              <span className={styles.viewToggleLabel}>List</span>
            </button>
          </div>

          <button type="button" className={styles.searchTrigger} onClick={() => setPaletteOpen(true)} aria-label="Search miners">
            <SearchIcon size={13} />
            <span className={styles.searchTriggerLabel}>Search miners</span>
            <span className={styles.searchTriggerKbd}>
              <span className={styles.kbd}>⌘</span>
              <span className={styles.kbd}>K</span>
            </span>
          </button>
        </div>
        </div>
      </section>

      <section className={styles.section}>
      <div className={styles.container}>
      <section className={styles.boardShell} ref={boardRef}>
        <div className={styles.boardHead}>
          <div>
            <div className={styles.boardEyebrow}>{formatCount(filtered.length, { fallback: '0' })} miners</div>
            <h2 className={styles.boardHeading}>All miners</h2>
          </div>
          <span className={styles.boardSync}>repo-scoped feed · synced {lastSync}</span>
        </div>

        {errorMessage && <div className={styles.errorState}>Failed to load repo-scoped miners: {errorMessage}</div>}

        {showSkeleton ? (
          viewMode === 'card' ? (
            <MinerCardGridSkeleton count={6} />
          ) : (
            <div className={styles.skeletonWrap}>
              <TableRowsSkeleton rows={10} rowHeight={52} px={14} cols={[{ width: 28 }, { flex: 1.6 }, { width: 72 }, { width: 90 }, { width: 56 }, { width: 84 }, { flex: 1.2 }, { width: 60 }]} />
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>No miners match this filter.</div>
        ) : viewMode === 'card' ? (
          <div className={styles.minerGrid}>
            {paged.map((view) => {
              const trackKey = minerTrackKey(view);
              return (
                <MinerCard
                  key={view.key}
                  view={view}
                  rank={rankBoard?.get(view.key) ?? 0}
                  poolTao={poolTao}
                  totalTao={totalTao}
                  subnetTao={subnetTao}
                  repoTotals={repoEmissionTotals}
                  selected={selectedMiner?.key === view.key}
                  mine={view.key === myKey}
                  tracked={tracked.has(trackKey)}
                  onSelect={() => selectMiner(view)}
                  onToggleTrack={() => toggle(trackKey)}
                />
              );
            })}
          </div>
        ) : (
          <div className={styles.listWrap}>
            <div className={styles.listHeader}>
              <span className={styles.listActions} />
              <span>Miner</span>
              <span className={styles.listHeadRight}>Emission</span>
              <span className={`${styles.listHeadRight} ${styles.listColHideSm}`}>Score</span>
              <span className={styles.listColHideMd}>PR activity</span>
              <span className={styles.listColHideMd}>Issues activity</span>
              <span className={styles.listColHideLg}>Contributions</span>
              <span className={styles.listColHideLg}>Top repos</span>
            </div>
            {paged.map((view) => {
              const trackKey = minerTrackKey(view);
              return (
                <MinerListRow
                  key={view.key}
                  view={view}
                  rank={rankBoard?.get(view.key) ?? 0}
                  poolTao={poolTao}
                  subnetTao={subnetTao}
                  selected={selectedMiner?.key === view.key}
                  mine={view.key === myKey}
                  tracked={tracked.has(trackKey)}
                  onSelect={() => selectMiner(view)}
                  onToggleTrack={() => toggle(trackKey)}
                />
              );
            })}
          </div>
        )}

        {!showSkeleton && totalPages > 1 ? (
          <div className={styles.pagerRow}>
            <InlinePagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={pageSize}
              onChange={goToPage}
            />
          </div>
        ) : null}
      </section>
      </div>
      </section>

      {selectedMiner && (
        <MinerModal
          view={selectedMiner}
          subnetTao={subnetTao}
          tracked={tracked.has(minerTrackKey(selectedMiner))}
          onClose={() => setSelectedId(null)}
          onToggleTrack={() => toggle(minerTrackKey(selectedMiner))}
          onPrev={selectedIndex > 0 ? () => setSelectedId(filtered[selectedIndex - 1].key) : undefined}
          onNext={
            selectedIndex >= 0 && selectedIndex < filtered.length - 1
              ? () => setSelectedId(filtered[selectedIndex + 1].key)
              : undefined
          }
        />
      )}

      <Palette
        open={paletteOpen}
        views={views}
        onClose={() => setPaletteOpen(false)}
        onSelect={(key) => setSelectedId(key)}
      />
    </main>
  );
}
