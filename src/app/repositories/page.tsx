'use client';

/* SN74 repositories explorer.
 *
 * Reimplemented from the `repositories.html` prototype against the live data
 * layer (`/api/gt/repositories` for stats, `useSn74Repos()` for policy). The
 * surface area: TAO emission headline + editable input, market bar, mobile
 * treemap, bar inspector, leaderboard, strategy chips, card/list view, repo
 * cards, compare tray + modal, right-side drawer, command palette, and the
 * collapsible reference panels at the bottom (reward formula, language
 * weights, AST token weights). */

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GtPrSummary, GtRepo, GtReposResponse } from '@/types/entities';
import { useSn74Repos } from '@/lib/use-sn74-repos';
import { useSession } from '@/lib/settings';
import { isTracked as repoIsTracked, useTrackedRepos } from '@/lib/tracked-repos';
import { CardGridSkeleton, TableRowsSkeleton } from '@/components/Skeleton';

import styles from './page.module.css';
import { buildRows, type RepoMeta } from './_lib/rows';
import {
  effectiveLabelMult,
  repoDailyTAO,
  rewardSignal,
  type RepoRow,
  type StrategyKey,
} from './_lib/incentives';
import { LABEL_COLORS, strategyChipClass } from './_lib/colors';

import Dropdown from '@/components/Dropdown';
import MarketSection, { type SelectedSeg } from './_components/MarketSection';
import RepoCard from './_components/RepoCard';
import RepoListRow from './_components/RepoListRow';
import CompareTray from './_components/CompareTray';
import CompareModal from './_components/CompareModal';
import Drawer from './_components/Drawer';
import Palette from './_components/Palette';
import RefPanels from './_components/RefPanels';

const EMPTY_GT: GtRepo[] = [];
const EMPTY_PRS: GtPrSummary[] = [];

type SortKey = 'strategy' | 'tao' | 'share' | 'velocity' | 'name';
type ViewMode = 'card' | 'list';

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'strategy', label: 'Best for strategy' },
  { key: 'tao',      label: 'Daily TAO ↓' },
  { key: 'share',    label: 'Share ↓' },
  { key: 'velocity', label: 'Velocity ↓' },
  { key: 'name',     label: 'Name (A→Z)' },
];

const STRATEGIES: Array<{ key: StrategyKey; label: string; dotClass: string }> = [
  { key: 'none',        label: 'Show all',         dotClass: '' },
  { key: 'bug',         label: 'Bug fixes',        dotClass: 'bug' },
  { key: 'enhancement', label: 'Enhancements',     dotClass: 'enh' },
  { key: 'feature',     label: 'Features',         dotClass: 'feat' },
  { key: 'refactor',    label: 'Refactors',        dotClass: 'refact' },
  { key: 'issue',       label: 'Issue discovery',  dotClass: 'issue' },
];

const MAX_COMPARE = 4;

export default function RepositoriesPage() {
  const { repos: policyRepos } = useSn74Repos();
  const { username } = useSession();
  const { tracked, toggle: toggleTrackedRepo } = useTrackedRepos();

  const { data, isLoading, isError, error } = useQuery<GtReposResponse>({
    queryKey: ['gt-repositories'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/gt/repositories', { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<GtReposResponse>;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
  const gtRepos = data?.repos ?? EMPTY_GT;
  // Reserved for future inline activity hints; reference to silence "unused".
  void (data?.recentPrs ?? EMPTY_PRS);

  /* Per-repo description + language breakdown, fetched server-side via the
   * GitHub API. Cached for an hour upstream — metadata is slow-changing. */
  const { data: metaResp } = useQuery<{ repos: Record<string, RepoMeta> }>({
    queryKey: ['repos-metadata'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/repos/metadata', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ repos: Record<string, RepoMeta> }>;
    },
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const metadata = metaResp?.repos ?? null;
  const metadataLoaded = metaResp != null;

  /* Hydration gate: TanStack Query returns empty data on the server (no
   * fetch) but may have warm data on the client (re-mount, navigation
   * cache). Rendering the real `rows` immediately produces a server↔client
   * mismatch on every stat that depends on it. Hold rows empty until after
   * mount so the first client render matches the SSR'd HTML, then re-render
   * with live data. */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  /* "self" repo = any SN74 repo owned by the signed-in GitHub user. Falls
   * through to null when the user isn't a repo owner — we just don't
   * highlight anything as "yours" then. Picks the highest-emission match
   * if the user happens to own more than one tracked repo. */
  const selfFullName = useMemo<string | null>(() => {
    if (!username) return null;
    const ownerLower = username.toLowerCase();
    const owned = policyRepos.filter((r) => r.owner.toLowerCase() === ownerLower);
    if (owned.length === 0) return null;
    return owned.sort((a, b) => b.weight - a.weight)[0].fullName;
  }, [policyRepos, username]);

  /* Merge policy + stats into RepoRow[]. */
  const rows = useMemo(
    () =>
      hydrated
        ? buildRows(policyRepos, gtRepos, { selfFullName, metadata })
        : [],
    [policyRepos, gtRepos, hydrated, metadata, selfFullName],
  );

  /* Live SN74 daily TAO emissions, proxied from TaoMarketCap. The
   * `/api/sn74-emission` endpoint multiplies per-UID `alpha_per_day` by
   * the subnet's alpha-to-TAO price to give us the true on-chain
   * emissions to UID 0 (recycle), UID 111 (treasury), and active miners.
   * The breakdown cards (Claimable / Recycling / Treasury) read these
   * values directly instead of deriving them from `configured_share`. */
  interface EmissionResp {
    totalTaoPerDay?: number;
    minerTaoPerDay?: number;
    validatorTaoPerDay?: number;
    recycleTaoPerDay?: number;
    treasuryTaoPerDay?: number;
    /** Per-UID active-miner alpha — used as the basis for per-repo TAO
     *  math. NOT the same as `minerTaoPerDay`, which is the headline
     *  card value matching TaoMarketCap. */
    activeMinerTaoPerDay?: number;
    ownerTaoPerDay?: number;
    minerCount?: number;
    validatorCount?: number;
  }
  const { data: emissionData } = useQuery<EmissionResp>({
    queryKey: ['sn74-emission'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/sn74-emission', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<EmissionResp>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const totalSubnetTAO = emissionData?.totalTaoPerDay ?? 30.0;
  const subnetTAOLoaded = emissionData?.totalTaoPerDay != null;
  const minerTAO     = emissionData?.minerTaoPerDay ?? null;
  const validatorTAO = emissionData?.validatorTaoPerDay ?? null;
  const recycleTAO   = emissionData?.recycleTaoPerDay ?? null;
  const treasuryTAO  = emissionData?.treasuryTaoPerDay ?? null;
  const activeMinerTAO = emissionData?.activeMinerTaoPerDay ?? null;
  const ownerTAO     = emissionData?.ownerTaoPerDay ?? null;
  const minerCount     = emissionData?.minerCount ?? null;
  const validatorCount = emissionData?.validatorCount ?? null;

  /* The miner pool — the slice of total subnet emission that funds the
   * Gittensor `emission_allocation` (active-miner UIDs + recycle UID 0
   * + treasury UID 111). This is what the protocol formula
   * `emission_share × OSS_POOL` is a fraction of, so per-repo TAO math
   * MUST use this — not the full subnet emission (which would credit
   * the validator portion to miners) and not `minerTaoPerDay` (which
   * is the TaoMarketCap-style headline value that already lumps recycle
   * + treasury in implicitly). */
  const minerPoolTAO = useMemo(() => {
    if (activeMinerTAO == null || recycleTAO == null || treasuryTAO == null) {
      // Fallback while emission data is loading — approximate as half of
      // total (since on SN74 the chain split is ~50/50 miner:validator).
      return totalSubnetTAO / 2;
    }
    return activeMinerTAO + recycleTAO + treasuryTAO;
  }, [activeMinerTAO, recycleTAO, treasuryTAO, totalSubnetTAO]);

  /* `subnetTAO` (passed downstream to repoDailyTAO etc.) is the miner-pool
   * value so per-repo TAO matches what the chain will actually emit.
   * The headline still shows totalSubnetTAO for completeness. */
  const subnetTAO = minerPoolTAO;

  /* =========== State =========== */
  const [strategy, setStrategy] = useState<StrategyKey>('none');
  const [sortKey, setSortKey] = useState<SortKey>('strategy');
  const [view, setView] = useState<ViewMode>('card');
  const [compare, setCompare] = useState<Set<string>>(() => new Set());
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [selectedSeg, setSelectedSeg] = useState<SelectedSeg>(null);

  /* When user picks a strategy, swap the sort to "strategy" automatically;
   * matches the HTML's UX. */
  const setStrategySmart = useCallback(
    (s: StrategyKey) => {
      setStrategy(s);
      if (s !== 'none' && sortKey === 'share') setSortKey('strategy');
      if (s === 'none' && sortKey === 'strategy') setSortKey('tao');
    },
    [sortKey],
  );

  /* Filtered + sorted rows */
  const sortedRows = useMemo(() => {
    let list = rows;
    if (strategy === 'issue') list = list.filter((r) => r.issue > 0);
    const arr = [...list];
    if (sortKey === 'strategy' && strategy !== 'none') {
      arr.sort((a, b) => rewardSignal(b, strategy) - rewardSignal(a, strategy));
    } else if (sortKey === 'tao') {
      arr.sort((a, b) => repoDailyTAO(b, subnetTAO) - repoDailyTAO(a, subnetTAO));
    } else if (sortKey === 'velocity') {
      arr.sort((a, b) => b.activity.merged30d - a.activity.merged30d);
    } else if (sortKey === 'name') {
      arr.sort((a, b) => a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase()));
    } else {
      arr.sort((a, b) => b.share - a.share);
    }
    return arr;
  }, [rows, strategy, sortKey, subnetTAO]);

  /* Best / penalized callouts (mirrors HTML's bestRepo / warnRepo logic) */
  const { bestRepo, warnRepo } = useMemo(() => {
    if (strategy === 'none') return { bestRepo: null as RepoRow | null, warnRepo: null as RepoRow | null };
    if (strategy === 'issue') {
      const best = sortedRows.find((r) => r.issue === 1) ?? sortedRows.find((r) => r.issue > 0) ?? null;
      return { bestRepo: best, warnRepo: null };
    }
    const eligible = sortedRows.filter((r) => r.share > 0);
    if (eligible.length === 0) return { bestRepo: null, warnRepo: null };
    const best = eligible.reduce((a, b) => (rewardSignal(a, strategy) >= rewardSignal(b, strategy) ? a : b));
    const penalized = eligible.filter((r) => effectiveLabelMult(r, strategy) < 0.5);
    const warn = penalized.length > 0
      ? penalized.reduce((a, b) => (effectiveLabelMult(a, strategy) <= effectiveLabelMult(b, strategy) ? a : b))
      : null;
    return { bestRepo: best, warnRepo: warn };
  }, [sortedRows, strategy]);

  const compareRows = useMemo(() => {
    const byKey = new Map(rows.map((r) => [r.fullName.toLowerCase(), r]));
    return Array.from(compare)
      .map((k) => byKey.get(k.toLowerCase()))
      .filter((x): x is RepoRow => Boolean(x));
  }, [compare, rows]);

  const drawerRow = useMemo(
    () => (drawerKey ? rows.find((r) => r.fullName.toLowerCase() === drawerKey.toLowerCase()) ?? null : null),
    [drawerKey, rows],
  );

  /* =========== Handlers =========== */
  const toggleCompare = useCallback(
    (full: string) => {
      setCompare((prev) => {
        const next = new Set(prev);
        const key = full;
        if (next.has(key)) {
          next.delete(key);
        } else {
          if (next.size >= MAX_COMPARE) return prev;
          next.add(key);
        }
        return next;
      });
    },
    [],
  );

  const removeCompare = useCallback((full: string) => {
    setCompare((prev) => {
      const next = new Set(prev);
      next.delete(full);
      return next;
    });
  }, []);

  const clearCompare = useCallback(() => {
    setCompare(new Set());
    setCompareOpen(false);
  }, []);

  const openDrawer = useCallback((full: string) => setDrawerKey(full), []);
  const closeDrawer = useCallback(() => setDrawerKey(null), []);

  // Cmd+K toggles the palette; Esc closes any open overlay.
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

  /* =========== Strategy hint =========== */
  let strategyHint: React.ReactNode = null;
  if (strategy === 'issue') {
    strategyHint = (
      <span>
        Only <span className={`mono ${styles.textFg}`}>{sortedRows.length}</span> repo
        {sortedRows.length === 1 ? '' : 's'} run{sortedRows.length === 1 ? 's' : ''} issue discovery.
      </span>
    );
  } else if (strategy !== 'none' && bestRepo) {
    const m = effectiveLabelMult(bestRepo, strategy);
    const sig = (rewardSignal(bestRepo, strategy) * subnetTAO).toFixed(3);
    const color = LABEL_COLORS[strategy]?.fg ?? 'var(--color-feat)';
    strategyHint = (
      <span>
        Best: <span className="mono" style={{ color }}>{bestRepo.name}</span>{' '}
        · ×<span className={`mono ${styles.textFg}`}>{m.toFixed(2)}</span> for{' '}
        <span className="mono">{strategy}</span> · ~
        <span className={`mono ${styles.textTao}`}>{sig} TAO/day</span> max signal
      </span>
    );
  }

  const totalReal = rows.length;
  const isRepoLoading = !hydrated || isLoading;
  const repoError = isError
    ? error instanceof Error
      ? error.message
      : 'Failed to load repositories.'
    : null;
  const headingPrefix = view === 'card' ? (
    <>
      Add up to <span className={styles.textMine}>4 to compare</span> · click cards for full detail
    </>
  ) : (
    <>
      Click any row for full detail · use <span className={styles.textMine}>+</span> to compare
    </>
  );

  // List view mult-column header label
  const multHeader = strategy === 'none' ? '×Best' : strategy === 'issue' ? 'Issue %' : `×${strategy}`;

  return (
    <div
      className={styles.scope}
      style={{ paddingBottom: compare.size > 0 ? 80 : 24, minHeight: '100%' }}
    >
      <MarketSection
        rows={rows}
        subnetTAO={subnetTAO}
        totalSubnetTAO={totalSubnetTAO}
        subnetTAOLoaded={subnetTAOLoaded}
        minerTAO={minerTAO}
        validatorTAO={validatorTAO}
        recycleTAO={recycleTAO}
        treasuryTAO={treasuryTAO}
        ownerTAO={ownerTAO}
        minerCount={minerCount}
        validatorCount={validatorCount}
        selected={selectedSeg}
        onSelect={setSelectedSeg}
        onOpenDrawer={openDrawer}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {/* Strategy bar */}
      <section
        style={{
          padding: '14px 16px',
          borderTop: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
          borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
          background: 'var(--bg-subtle)',
        }}
      >
        <div
          className={styles.container}
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-subtle)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            Filter by
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {STRATEGIES.map((s) => {
              const active = strategy === s.key;
              const activeCls = active ? styles[strategyChipClass(s.key)] : '';
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`${styles.chip} ${activeCls}`}
                  onClick={() => setStrategySmart(s.key)}
                >
                  {s.dotClass ? (
                    <span
                      className={styles.chipDot}
                      style={{
                        background:
                          s.dotClass === 'bug'    ? 'var(--color-bug)'
                        : s.dotClass === 'enh'    ? 'var(--color-enh)'
                        : s.dotClass === 'feat'   ? 'var(--color-feat)'
                        : s.dotClass === 'refact' ? 'var(--color-refact)'
                        : s.dotClass === 'issue'  ? 'var(--color-stream-issue)'
                        : 'var(--fg-muted)',
                      }}
                    />
                  ) : null}
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className={styles.vDivider} aria-hidden />

          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={styles.hideOnMobile} style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
              Sort
            </span>
            <Dropdown<SortKey>
              value={sortKey}
              options={SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
              onChange={setSortKey}
              size="xsmall"
              width={170}
              ariaLabel="Sort"
              closeOnScroll
            />
          </label>

          <div className={styles.viewToggleGroup}>
            <button
              type="button"
              className={`${styles.viewToggle} ${view === 'card' ? styles.active : ''}`}
              onClick={() => setView('card')}
              title="Card view"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span className={styles.viewToggleLabel}>Cards</span>
            </button>
            <button
              type="button"
              className={`${styles.viewToggle} ${view === 'list' ? styles.active : ''}`}
              onClick={() => setView('list')}
              title="List view"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
              <span className={styles.viewToggleLabel}>List</span>
            </button>
          </div>

          {/* Search trigger — matches HTML's header search button (cmd+K hint).
            * On mobile we render the icon-only variant; on md+ the full pill. */}
          <button
            type="button"
            className={styles.searchTrigger}
            onClick={() => setPaletteOpen(true)}
            aria-label="Search repositories"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-3.6-3.6" />
            </svg>
            <span className={styles.searchTriggerLabel}>Search repos</span>
            <span className={styles.searchTriggerKbd}>
              <span className={styles.kbd}>⌘</span>
              <span className={styles.kbd}>K</span>
            </span>
          </button>

          {strategyHint ? (
            <div
              className={styles.hideOnMobile}
              style={{
                marginLeft: 'auto',
                fontSize: 11.5,
                color: 'var(--fg-muted)',
                maxWidth: 400,
                textAlign: 'right',
              }}
            >
              {strategyHint}
            </div>
          ) : null}
        </div>
      </section>

      {/* Repo cards / list */}
      <section style={{ padding: '20px 16px 0' }}>
        <div className={styles.container}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500 }}>
                {totalReal} repositor{totalReal === 1 ? 'y' : 'ies'}
              </div>
              <h2 style={{ fontSize: 14.5, fontWeight: 500, marginTop: 4, lineHeight: 1.2 }}>{headingPrefix}</h2>
            </div>
            <span className={`tnum ${styles.textFgMute}`} style={{ fontSize: 11.5, flexShrink: 0 }}>
              {sortedRows.length} of {totalReal}
            </span>
          </div>

          {view === 'card' ? (
            <div className={styles.repoGrid}>
              {sortedRows.map((r) => (
                <RepoCard
                  key={r.fullName}
                  row={r}
                  subnetTAO={subnetTAO}
                  strategy={strategy}
                  isSelected={compare.has(r.fullName)}
                  isBest={r === bestRepo}
                  isWarn={r === warnRepo}
                  isTracked={repoIsTracked(tracked, r.fullName)}
                  metadataLoaded={metadataLoaded}
                  onOpen={() => openDrawer(r.fullName)}
                  onToggleCompare={() => toggleCompare(r.fullName)}
                  onToggleTrack={() => toggleTrackedRepo(r.fullName)}
                />
              ))}
              {isRepoLoading ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <CardGridSkeleton count={6} columns={3} cardHeight={220} />
                </div>
              ) : repoError ? (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    padding: 32,
                    textAlign: 'center',
                    fontSize: 13,
                    color: 'var(--danger-fg)',
                    border: '1px dashed var(--danger-subtle)',
                    borderRadius: 8,
                  }}
                >
                  Failed to load repositories: {repoError}
                </div>
              ) : sortedRows.length === 0 ? (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    padding: 32,
                    textAlign: 'center',
                    fontSize: 13,
                    color: 'var(--fg-subtle)',
                    border: '1px dashed var(--soft-border, rgba(255,255,255,0.06))',
                    borderRadius: 8,
                  }}
                >
                  No repositories match the current filter.
                </div>
              ) : null}
            </div>
          ) : (
            <div>
              <div className={styles.repoList}>
                <div className={styles.repoListHeader}>
                  <span />
                  <span>Repository</span>
                  <span style={{ textAlign: 'right' }}>TAO/day</span>
                  <span className={styles.listColMult} style={{ textAlign: 'right' }}>{multHeader}</span>
                  <span className={styles.listColStream}>Stream</span>
                  <span className={styles.listColLangs}>Languages</span>
                  {/* Activity group (30d) — only the leftmost column carries the
                    * qualifier; the rate + submissions columns inherit it. */}
                  <span className={styles.listColAct} style={{ textAlign: 'right' }} title="Merged PRs in the last 30 days.">
                    Merged <span style={{ color: 'var(--border-strong)', fontWeight: 400 }}>(30d)</span>
                  </span>
                  <span className={styles.listColRate} style={{ textAlign: 'right' }} title="Merged ÷ (merged + closed) over the last 30 days.">
                    Merge rate
                  </span>
                  <span className={styles.listColSpark} style={{ textAlign: 'right' }} title="PRs opened per day (last 30 days).">
                    Submissions
                  </span>
                </div>
                <div>
                  {sortedRows.map((r) => (
                    <RepoListRow
                      key={r.fullName}
                      row={r}
                      subnetTAO={subnetTAO}
                      strategy={strategy}
                      isSelected={compare.has(r.fullName)}
                      isBest={r === bestRepo}
                      isWarn={r === warnRepo}
                      isTracked={repoIsTracked(tracked, r.fullName)}
                      metadataLoaded={metadataLoaded}
                      onOpen={() => openDrawer(r.fullName)}
                      onToggleCompare={() => toggleCompare(r.fullName)}
                      onToggleTrack={() => toggleTrackedRepo(r.fullName)}
                    />
                  ))}
                  {isRepoLoading ? (
                    <TableRowsSkeleton
                      rows={8}
                      rowHeight={58}
                      px={14}
                      cols={[
                        { width: 48 },
                        { flex: 1 },
                        { width: 88 },
                        { width: 64 },
                        { width: 90 },
                        { flex: 1 },
                        { width: 52 },
                        { width: 48 },
                      ]}
                    />
                  ) : repoError ? (
                    <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--danger-fg)' }}>
                      Failed to load repositories: {repoError}
                    </div>
                  ) : sortedRows.length === 0 ? (
                    <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--fg-subtle)' }}>
                      No repositories match the current filter.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <RefPanels />

      <CompareTray
        rows={compareRows}
        subnetTAO={subnetTAO}
        onRemove={removeCompare}
        onClear={clearCompare}
        onOpen={() => setCompareOpen(true)}
      />

      <CompareModal
        open={compareOpen}
        repos={compareRows}
        subnetTAO={subnetTAO}
        strategy={strategy}
        onClose={() => setCompareOpen(false)}
        onRemove={(full) => {
          removeCompare(full);
          // If we drop below 2 repos, the modal has nothing to compare.
          if (compare.size <= 2) setCompareOpen(false);
        }}
      />

      <Drawer
        open={drawerRow != null}
        row={drawerRow}
        subnetTAO={subnetTAO}
        isInCompare={drawerRow != null && compare.has(drawerRow.fullName)}
        metadataLoaded={metadataLoaded}
        onClose={closeDrawer}
        onToggleCompare={(full) => toggleCompare(full)}
      />

      <Palette
        open={paletteOpen}
        rows={rows}
        subnetTAO={subnetTAO}
        onClose={() => setPaletteOpen(false)}
        onSelect={(full) => openDrawer(full)}
      />
    </div>
  );
}
