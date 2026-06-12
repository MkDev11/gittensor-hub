'use client';

export const dynamic = 'force-dynamic';

// Person-centric companion to the repo-centric leaderboard (/repositories →
// Maintainers board): every maintainer across every tracked SN74 repo and how
// much miner work ships through the repos they steward. "Shipping" is
// repo-attributed — GitHub's PR list endpoint omits `merged_by`, so we cannot
// credit an individual merge to one maintainer; a repo's throughput is credited
// to each of its maintainers. Reward (τ/day) is exact, split among a repo's
// registered miner-maintainers.
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Heading, Text, TextInput } from '@primer/react';
import { SearchIcon, ChevronRightIcon, ChevronDownIcon, VerifiedIcon, InfoIcon } from '@primer/octicons-react';
import { formatDurationHours } from '@/lib/format';
import type { MaintainersResponse, MaintainerSummary, MaintainerRepoContribution, RepoMaintainersSummary } from '@/lib/api-types';

const LETTER_COLOR: Record<string, string> = {
  A: '#22c55e', B: '#86efac', C: '#9eb872', D: '#eab308', F: '#c5503a', '—': '#62666d',
};
const MODE_COLOR: Record<MaintainerRepoContribution['mode'], string> = {
  PR: '#22c55e', issue: '#6366f1', mixed: '#a78bfa',
};

type View = 'maintainer' | 'repo';
type SortKey = 'reward' | 'ship30d' | 'shipTotal' | 'grade' | 'count';
const SORT_KEYS: SortKey[] = ['reward', 'ship30d', 'shipTotal', 'grade', 'count'];
// The last key counts the other dimension: repos-per-maintainer vs
// maintainers-per-repo, so its label flips with the view.
const sortLabel = (k: SortKey, view: View): string =>
  k === 'reward' ? 'Reward'
  : k === 'ship30d' ? 'Shipping · 30d'
  : k === 'shipTotal' ? 'Shipping · all-time'
  : k === 'grade' ? 'Grade'
  : view === 'maintainer' ? 'Repos' : 'Maintainers';

const M_SORT: Record<SortKey, (m: MaintainerSummary) => number> = {
  reward: (m) => m.rewardShare,
  ship30d: (m) => m.shipped30d,
  shipTotal: (m) => m.shippedTotal,
  grade: (m) => m.gradeScore ?? -1,
  count: (m) => m.repoCount,
};
const R_SORT: Record<SortKey, (r: RepoMaintainersSummary) => number> = {
  reward: (r) => r.rewardShare,
  ship30d: (r) => r.shipped30d,
  shipTotal: (r) => r.shippedTotal,
  grade: (r) => r.gradeScore ?? -1,
  count: (r) => r.maintainerCount,
};

interface EmissionSnapshot {
  activeMinerTaoPerDay?: number;
  recycleTaoPerDay?: number;
  treasuryTaoPerDay?: number;
  totalTaoPerDay?: number;
}

function fmtTao(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v.toFixed(4);
}

// Shared column grid — header + every row align to this. Only the maintainer
// column flexes; every metric is a fixed width so they cluster cleanly on the
// right instead of drifting apart on a wide (1440) layout. Horizontally scrolls
// on narrow viewports via the MIN_WIDTH wrapper.
const GRID = '24px minmax(220px,1fr) 64px 168px 96px 80px 104px';
const MIN_WIDTH = 880;

// Concise Grade-column tooltip (the full breakdown lives in the GradeGuide
// panel). Honest that the speed signal reflects the repo's merge/close
// activity — which a bot or merge-app can drive — not the named maintainers.
const GRADE_TIP = (
  <>
    <Text sx={{ display: 'block', fontWeight: 600, color: 'fg.default', mb: 1 }}>Grade · responsiveness to miner work</Text>
    <Text sx={{ display: 'block', color: 'fg.muted' }}>
      Blends merge / resolve speed, acceptance and backlog health, weighted by the repo&apos;s PR vs
      issue-discovery split. A&nbsp;90+ · B&nbsp;80+ · C&nbsp;70+ · D&nbsp;60+ · F&nbsp;&lt;60.
    </Text>
    <Text sx={{ display: 'block', color: 'fg.subtle', mt: 1 }}>
      Repo-attributed, and can reflect a bot/app with merge rights. See “How grading works”.
    </Text>
  </>
);

/** Stable per-maintainer key — id when present, else login. Used for both the
 *  React list key and the expanded-row set, so two people who happen to share a
 *  login can't toggle together. */
const keyOf = (m: MaintainerSummary): string => (m.githubId ? `id:${m.githubId}` : `login:${m.login.toLowerCase()}`);

export default function MaintainersPage() {
  const [view, setView] = useState<View>('maintainer');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('reward');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showGuide, setShowGuide] = useState(false);

  const dataQuery = useQuery<MaintainersResponse>({
    queryKey: ['all-maintainers'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/maintainers', { signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    },
    refetchInterval: 2 * 60 * 1000,
    staleTime: 90_000,
  });

  const emissionQuery = useQuery<EmissionSnapshot>({
    queryKey: ['all-maintainers-emission'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/sn74-emission', { signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });

  // Miner-pool τ/day: reward shares × this = τ/day. Mirrors the dashboard's
  // Top-Rewarded-Maintainers basis (active miners + recycle + treasury).
  const minerPoolTAO = useMemo(() => {
    const e = emissionQuery.data;
    if (e?.activeMinerTaoPerDay != null && e?.recycleTaoPerDay != null && e?.treasuryTaoPerDay != null) {
      return e.activeMinerTaoPerDay + e.recycleTaoPerDay + e.treasuryTaoPerDay;
    }
    return (e?.totalTaoPerDay ?? 30) / 2;
  }, [emissionQuery.data]);

  const filtered = useMemo(() => {
    const all = dataQuery.data?.maintainers ?? [];
    const q = query.trim().toLowerCase();
    const base = q
      ? all.filter((m) => m.login.toLowerCase().includes(q) || m.repos.some((r) => r.repo.toLowerCase().includes(q)))
      : all;
    const get = M_SORT[sortKey];
    return [...base].sort((a, b) => get(b) - get(a) || b.shipped30d - a.shipped30d || a.login.localeCompare(b.login));
  }, [dataQuery.data?.maintainers, query, sortKey]);

  const filteredRepos = useMemo(() => {
    const all = dataQuery.data?.repos ?? [];
    const q = query.trim().toLowerCase();
    const base = q
      ? all.filter((r) => r.repo.toLowerCase().includes(q) || r.maintainers.some((m) => m.login.toLowerCase().includes(q)))
      : all;
    const get = R_SORT[sortKey];
    return [...base].sort((a, b) => get(b) - get(a) || b.shipped30d - a.shipped30d || a.repo.localeCompare(b.repo));
  }, [dataQuery.data?.repos, query, sortKey]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const data = dataQuery.data;

  return (
    <Box sx={{ width: '100%', maxWidth: 1440, mx: 'auto', px: [3, 3, 4], py: [3, 4] }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Heading sx={{ fontSize: [3, 4], fontWeight: 600, letterSpacing: '-0.02em' }}>Maintainers</Heading>
        <Text sx={{ display: 'block', mt: 1, fontSize: 1, color: 'fg.muted', maxWidth: 680, lineHeight: 1.5 }}>
          Everyone stewarding an SN74 repo, and how much miner work ships through the repos they maintain.
          Throughput is credited to a repo&apos;s maintainers collectively; reward (τ/day) is split among a repo&apos;s
          registered miner-maintainers.
        </Text>
        {data && !data.minerFiltered ? (
          <Text sx={{ display: 'block', mt: 2, fontSize: 0, color: 'attention.fg' }}>
            Miner list unavailable — counting all contributors&apos; work, not just registered miners.
          </Text>
        ) : null}
      </Box>

      <GradeGuide open={showGuide} onToggle={() => setShowGuide((v) => !v)} />

      {/* Controls */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
          <ViewTab active={view === 'maintainer'} onClick={() => setView('maintainer')}>By maintainer</ViewTab>
          <ViewTab active={view === 'repo'} onClick={() => setView('repo')}>By repo</ViewTab>
        </Box>
        <TextInput
          aria-label="Search maintainers or repos"
          leadingVisual={SearchIcon}
          placeholder="Search maintainer or repo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: [1, 240] }}
        />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {SORT_KEYS.map((k) => (
            <SortChip key={k} active={sortKey === k} onClick={() => setSortKey(k)} label={sortLabel(k, view)} />
          ))}
        </Box>
        {data ? (
          <Text sx={{ ml: ['0', 'auto'], fontSize: 0, color: 'fg.subtle' }}>
            {data.maintainerCount} maintainers · {data.repoCount} repos
          </Text>
        ) : null}
      </Box>

      {/* Table */}
      {dataQuery.isLoading ? (
        <Stateful>Loading…</Stateful>
      ) : dataQuery.isError ? (
        <Stateful tone="danger">Couldn&apos;t load maintainers. {(dataQuery.error as Error)?.message}</Stateful>
      ) : view === 'maintainer' ? (
        filtered.length === 0 ? (
          <Stateful>No maintainers match “{query}”.</Stateful>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{ minWidth: MIN_WIDTH, border: '1px solid', borderColor: 'border.subtle', borderRadius: 2, overflow: 'hidden' }}>
              <HeaderRow first="Maintainer" count="Repos" />
              {filtered.map((m) => {
                const k = keyOf(m);
                return (
                  <MaintainerRow key={k} m={m} minerPoolTAO={minerPoolTAO} expanded={expanded.has(k)} onToggle={() => toggle(k)} />
                );
              })}
            </Box>
          </Box>
        )
      ) : filteredRepos.length === 0 ? (
        <Stateful>No repos match “{query}”.</Stateful>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: MIN_WIDTH, border: '1px solid', borderColor: 'border.subtle', borderRadius: 2, overflow: 'hidden' }}>
            <HeaderRow first="Repository" count="Maintainers" />
            {filteredRepos.map((r) => {
              const k = `repo:${r.repo}`;
              return (
                <RepoRow key={k} r={r} minerPoolTAO={minerPoolTAO} expanded={expanded.has(k)} onToggle={() => toggle(k)} />
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** Linear-style hover tooltip — dark elevated surface, hairline border, soft
 *  shadow, short open delay. Portaled to <body> so the table's overflow:hidden
 *  can't clip it, and right-aligned to the trigger so right-edge columns don't
 *  push it off-screen. Opens on hover and keyboard focus. */
function Tooltip({ content, children, maxWidth = 320 }: { content: React.ReactNode; children: React.ReactNode; maxWidth?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  const open = (delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 8, left: Math.min(r.right, window.innerWidth - 8) });
    }, delay);
  };
  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };

  return (
    <Box
      as="span"
      ref={ref}
      tabIndex={0}
      onMouseEnter={() => open(250)}
      onMouseLeave={close}
      onFocus={() => open(0)}
      onBlur={close}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, cursor: 'help', outline: 'none' }}
    >
      {children}
      {mounted && pos
        ? createPortal(
            <Box
              role="tooltip"
              sx={{
                position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)',
                zIndex: 1000, maxWidth, pointerEvents: 'none',
                bg: 'canvas.overlay', color: 'fg.default',
                border: '1px solid', borderColor: 'border.muted', borderRadius: 2,
                boxShadow: '0 8px 28px rgba(0,0,0,0.36), 0 1px 3px rgba(0,0,0,0.28)',
                px: '12px', py: '10px', fontSize: 0, lineHeight: 1.5,
                letterSpacing: '-0.003em', whiteSpace: 'normal',
                animation: 'tooltipIn 90ms ease-out',
              }}
            >
              {content}
            </Box>,
            document.body,
          )
        : null}
    </Box>
  );
}

function HeaderRow({ first, count }: { first: string; count: string }) {
  return (
    <Box
      sx={{
        display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 2,
        px: 3, py: 2, fontSize: 0, color: 'fg.subtle', textTransform: 'uppercase', letterSpacing: '0.05em',
        borderBottom: '1px solid', borderColor: 'border.subtle', bg: 'canvas.subtle',
      }}
    >
      <span />
      <span>{first}</span>
      <span style={{ textAlign: 'right' }}>{count}</span>
      <span style={{ textAlign: 'right' }}>Shipping · 30d</span>
      <span style={{ textAlign: 'right' }}>All-time</span>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', color: 'fg.muted' }}>
        <Tooltip content={GRADE_TIP}>
          Grade <Box as="span" sx={{ display: 'inline-flex', color: 'fg.subtle' }}><InfoIcon size={11} /></Box>
        </Tooltip>
      </Box>
      <span style={{ textAlign: 'right' }}>τ / day</span>
    </Box>
  );
}

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box
      as="button"
      type="button"
      onClick={onClick}
      sx={{
        px: 3, py: 1, fontSize: 1, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
        bg: active ? 'accent.subtle' : 'transparent',
        color: active ? 'accent.fg' : 'fg.muted', fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </Box>
  );
}

function MaintainerRow({
  m, minerPoolTAO, expanded, onToggle,
}: {
  m: MaintainerSummary; minerPoolTAO: number; expanded: boolean; onToggle: () => void;
}) {
  const tao = m.rewardShare * minerPoolTAO;
  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'border.muted' }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        sx={{
          display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 2,
          px: 3, py: '10px', cursor: 'pointer', fontSize: 1,
          '&:hover': { bg: 'canvas.subtle' },
        }}
      >
        {/* caret */}
        <Box sx={{ color: 'fg.subtle', display: 'flex' }}>
          {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </Box>

        {/* maintainer identity */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://github.com/${m.login}.png?size=40`}
            alt=""
            width={22}
            height={22}
            style={{ borderRadius: '50%', flexShrink: 0, background: 'var(--bgColor-muted, #222)' }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Text sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.login}
              </Text>
              {m.registered ? (
                <Box sx={{ color: 'accent.fg', display: 'flex', flexShrink: 0 }} title="Registered Gittensor miner">
                  <VerifiedIcon size={12} />
                </Box>
              ) : null}
            </Box>
            <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>
              {m.repos.slice(0, 2).map((r) => r.repo.split('/')[1]).join(', ')}
              {m.repoCount > 2 ? ` +${m.repoCount - 2}` : ''}
            </Text>
          </Box>
        </Box>

        {/* repo count */}
        <Text className="tnum" sx={{ textAlign: 'right', color: 'fg.muted' }}>{m.repoCount}</Text>

        {/* shipping 30d */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.25 }}>
          <Text className="tnum" sx={{ fontWeight: 500 }}>{m.shipped30d}</Text>
          <Text sx={{ fontSize: 0, color: 'fg.subtle', whiteSpace: 'nowrap' }}>
            {m.mergedPrs30d} PR{m.mergedPrs30d === 1 ? '' : 's'} · {m.issuesResolved30d} issue{m.issuesResolved30d === 1 ? '' : 's'}
          </Text>
        </Box>

        {/* all-time */}
        <Text className="tnum" sx={{ textAlign: 'right', color: 'fg.muted' }}>{m.shippedTotal}</Text>

        {/* grade */}
        <Box sx={{ textAlign: 'right' }}>
          <Text sx={{ fontWeight: 600, fontSize: 2, color: LETTER_COLOR[m.gradeLetter] ?? '#62666d' }}>{m.gradeLetter}</Text>
          {m.gradeScore != null ? (
            <Text className="tnum" sx={{ fontSize: 0, color: 'fg.subtle', ml: 1 }}>{Math.round(m.gradeScore)}</Text>
          ) : null}
        </Box>

        {/* τ / day */}
        <Box sx={{ textAlign: 'right' }}>
          <Text className="tnum mono" sx={{ color: tao > 0 ? 'success.fg' : 'fg.subtle', fontWeight: 500 }}>{fmtTao(tao)}</Text>
        </Box>
      </Box>

      {expanded ? <RepoBreakdown m={m} minerPoolTAO={minerPoolTAO} /> : null}
    </Box>
  );
}

function RepoBreakdown({ m, minerPoolTAO }: { m: MaintainerSummary; minerPoolTAO: number }) {
  // Columns line up with the parent table's GRID, so each repo's figures sit
  // directly under Shipping / All-time / Grade / τ-day and visibly sum to the
  // maintainer's aggregate row above.
  return (
    <Box sx={{ bg: 'canvas.inset', borderTop: '1px solid', borderColor: 'border.muted' }}>
      {m.repos.map((r, i) => {
        const tao = r.rewardShare * minerPoolTAO;
        const ship30 = r.mergedPrs30d + r.issuesResolved30d;
        const total = r.mergedPrsTotal + r.issuesCompleted;
        const modeLabel = r.mode === 'PR' ? 'PR review' : r.mode === 'issue' ? 'issue discovery' : 'mixed';
        const cutPct = (r.maintainerCut * 100).toFixed(r.maintainerCut > 0 && r.maintainerCut < 0.1 ? 1 : 0);
        return (
          <Box
            key={`${r.repo}-${i}`}
            sx={{
              display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 2,
              px: 3, py: '8px', fontSize: 0,
              borderBottom: '1px solid', borderColor: 'border.muted', '&:last-child': { borderBottom: 'none' },
            }}
          >
            {/* connector tick (under the caret column) */}
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box sx={{ width: '1px', height: '16px', bg: 'border.default' }} />
            </Box>

            {/* repo identity + mode / cut subtext */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://github.com/${r.repo.split('/')[0]}.png?size=40`}
                alt=""
                width={18}
                height={18}
                style={{ borderRadius: 4, flexShrink: 0, background: 'var(--bgColor-muted, #222)' }}
              />
              <Box sx={{ minWidth: 0 }}>
                <a
                  href={`https://github.com/${r.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: 'inherit', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  <Text sx={{ color: 'fg.muted' }}>{r.repo.split('/')[0]}/</Text>
                  <Text sx={{ fontWeight: 500, color: 'fg.default' }}>{r.repo.split('/')[1]}</Text>
                </a>
                <Text sx={{ display: 'block', whiteSpace: 'nowrap' }}>
                  <Text as="span" sx={{ color: MODE_COLOR[r.mode], textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '9.5px' }}>{modeLabel}</Text>
                  <Text as="span" sx={{ color: 'fg.subtle' }}> · {cutPct}% cut</Text>
                </Text>
              </Box>
            </Box>

            {/* Repos column position — left blank for sub-rows */}
            <span />

            {/* Shipping · 30d (+ median response time) */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.25 }}>
              <Text className="tnum" sx={{ fontWeight: 500, color: 'fg.default' }}>{ship30}</Text>
              {r.speedHours != null ? (
                <Text className="tnum" sx={{ color: 'fg.subtle', whiteSpace: 'nowrap' }}>~{formatDurationHours(r.speedHours)}</Text>
              ) : null}
            </Box>

            {/* All-time */}
            <Text className="tnum" sx={{ textAlign: 'right', color: 'fg.muted' }}>{total}</Text>

            {/* Grade */}
            <Box sx={{ textAlign: 'right' }}>
              <Text sx={{ fontWeight: 600, color: r.gradeScore != null ? LETTER_COLOR[r.gradeLetter] : 'fg.subtle' }}>{r.gradeLetter}</Text>
              {r.gradeScore != null ? <Text className="tnum" sx={{ color: 'fg.subtle', ml: 1 }}>{Math.round(r.gradeScore)}{r.provisional ? '*' : ''}</Text> : null}
            </Box>

            {/* τ / day */}
            <Text className="tnum mono" sx={{ textAlign: 'right', color: tao > 0 ? 'success.fg' : 'fg.subtle' }}>{fmtTao(tao)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function RepoRow({
  r, minerPoolTAO, expanded, onToggle,
}: {
  r: RepoMaintainersSummary; minerPoolTAO: number; expanded: boolean; onToggle: () => void;
}) {
  const tao = r.rewardShare * minerPoolTAO;
  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'border.muted' }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        sx={{
          display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 2,
          px: 3, py: '10px', cursor: 'pointer', fontSize: 1,
          '&:hover': { bg: 'canvas.subtle' },
        }}
      >
        {/* caret */}
        <Box sx={{ color: 'fg.subtle', display: 'flex' }}>
          {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </Box>

        {/* repo identity */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://github.com/${r.owner}.png?size=40`}
            alt=""
            width={22}
            height={22}
            style={{ borderRadius: 4, flexShrink: 0, background: 'var(--bgColor-muted, #222)' }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Text sx={{ color: 'fg.muted' }}>{r.owner}/</Text>
              <Text sx={{ fontWeight: 500 }}>{r.name}</Text>
            </Box>
            <Text sx={{ fontSize: 0, color: MODE_COLOR[r.mode], textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {r.mode === 'PR' ? 'PR review' : r.mode === 'issue' ? 'issue discovery' : 'mixed'}
              <Text as="span" sx={{ color: 'fg.subtle', textTransform: 'none', letterSpacing: 0 }}>
                {' · '}{(r.maintainerCut * 100).toFixed(r.maintainerCut > 0 && r.maintainerCut < 0.1 ? 1 : 0)}% cut
              </Text>
            </Text>
          </Box>
        </Box>

        {/* maintainer count */}
        <Text className="tnum" sx={{ textAlign: 'right', color: 'fg.muted' }}>{r.maintainerCount}</Text>

        {/* shipping 30d */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.25 }}>
          <Text className="tnum" sx={{ fontWeight: 500 }}>{r.shipped30d}</Text>
          <Text sx={{ fontSize: 0, color: 'fg.subtle', whiteSpace: 'nowrap' }}>
            {r.mergedPrs30d} PR{r.mergedPrs30d === 1 ? '' : 's'} · {r.issuesResolved30d} issue{r.issuesResolved30d === 1 ? '' : 's'}
          </Text>
        </Box>

        {/* all-time */}
        <Text className="tnum" sx={{ textAlign: 'right', color: 'fg.muted' }}>{r.shippedTotal}</Text>

        {/* grade */}
        <Box sx={{ textAlign: 'right' }}>
          <Text sx={{ fontWeight: 600, fontSize: 2, color: LETTER_COLOR[r.gradeLetter] ?? '#62666d' }}>{r.gradeLetter}</Text>
          {r.gradeScore != null ? (
            <Text className="tnum" sx={{ fontSize: 0, color: 'fg.subtle', ml: 1 }}>{Math.round(r.gradeScore)}</Text>
          ) : null}
        </Box>

        {/* τ / day (repo's whole maintainer pool) */}
        <Box sx={{ textAlign: 'right' }}>
          <Text className="tnum mono" sx={{ color: tao > 0 ? 'success.fg' : 'fg.subtle', fontWeight: 500 }}>{fmtTao(tao)}</Text>
        </Box>
      </Box>

      {expanded ? <RepoMaintainerList r={r} minerPoolTAO={minerPoolTAO} /> : null}
    </Box>
  );
}

function RolePill({ role }: { role: string }) {
  return (
    <Box
      as="span"
      sx={{
        flexShrink: 0, px: 1, fontSize: '10px', lineHeight: '16px', borderRadius: 1,
        bg: 'neutral.muted', color: 'fg.muted', textTransform: 'lowercase', letterSpacing: '0.02em',
      }}
    >
      {role.toLowerCase()}
    </Box>
  );
}

function RepoMaintainerList({ r, minerPoolTAO }: { r: RepoMaintainersSummary; minerPoolTAO: number }) {
  const registeredCount = r.maintainers.filter((m) => m.registered).length;
  const cutPct = (r.maintainerCut * 100).toFixed(r.maintainerCut > 0 && r.maintainerCut < 0.1 ? 1 : 0);
  return (
    <Box sx={{ bg: 'canvas.inset', px: 3, py: 2, borderTop: '1px solid', borderColor: 'border.muted' }}>
      {/* legend — replaces the per-row "registered / not" text */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, fontSize: 0, color: 'fg.subtle' }}>
        <Box as="span" sx={{ color: 'accent.fg', display: 'inline-flex' }}><VerifiedIcon size={11} /></Box>
        <Text>
          {registeredCount} / {r.maintainerCount} registered {registeredCount === 1 ? 'miner' : 'miners'}
          {r.maintainerCut > 0 ? <> — split this repo&apos;s {cutPct}% maintainer cut</> : ' — no maintainer cut on this repo'}
        </Text>
      </Box>

      {r.maintainers.map((m, i) => {
        const tao = m.rewardShare * minerPoolTAO;
        return (
          <Box
            key={`${m.githubId ?? m.login}-${i}`}
            sx={{
              display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 2,
              py: '7px', fontSize: 1, opacity: m.registered ? 1 : 0.62,
              borderBottom: '1px solid', borderColor: 'border.muted', '&:last-child': { borderBottom: 'none' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://github.com/${m.login}.png?size=40`}
                alt=""
                width={20}
                height={20}
                style={{ borderRadius: '50%', flexShrink: 0, background: 'var(--bgColor-muted, #222)' }}
              />
              <a
                href={`https://github.com/${m.login}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
              >
                <Text sx={{ fontWeight: 500, color: m.registered ? 'fg.default' : 'fg.muted' }}>{m.login}</Text>
              </a>
              {m.registered ? (
                <Box sx={{ color: 'accent.fg', display: 'flex', flexShrink: 0 }} title="Registered Gittensor miner — earns the maintainer reward">
                  <VerifiedIcon size={12} />
                </Box>
              ) : null}
              {m.association ? <RolePill role={m.association} /> : null}
            </Box>

            {m.registered ? (
              <Text className="tnum mono" sx={{ textAlign: 'right', color: tao > 0 ? 'success.fg' : 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>
                {fmtTao(tao)} τ/d
              </Text>
            ) : (
              <Text sx={{ textAlign: 'right', color: 'fg.subtle', fontSize: 0 }}>—</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function SortChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <Box
      as="button"
      type="button"
      onClick={onClick}
      sx={{
        px: 2, py: 1, fontSize: 0, borderRadius: 2, cursor: 'pointer',
        border: '1px solid', borderColor: active ? 'accent.emphasis' : 'border.default',
        bg: active ? 'accent.subtle' : 'transparent',
        color: active ? 'accent.fg' : 'fg.muted', fontWeight: active ? 600 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  );
}

function GuideRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '170px 1fr'], gap: [0, 2], mt: 2 }}>
      <Text sx={{ color: 'fg.default', fontWeight: 500 }}>{label}</Text>
      <Text sx={{ color: 'fg.muted' }}>{children}</Text>
    </Box>
  );
}

const GRADE_BANDS: ReadonlyArray<[string, string]> = [['A', '90+'], ['B', '80+'], ['C', '70+'], ['D', '60+'], ['F', '<60']];

function GradeGuide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Box sx={{ mb: 3, border: '1px solid', borderColor: 'border.subtle', borderRadius: 2, overflow: 'hidden', bg: 'canvas.subtle' }}>
      <Box
        as="button"
        type="button"
        onClick={onToggle}
        sx={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 2,
          border: 'none', bg: 'transparent', cursor: 'pointer', color: 'fg.default', fontSize: 1, textAlign: 'left',
        }}
      >
        <Box sx={{ color: 'fg.subtle', display: 'flex' }}>{open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}</Box>
        <Box sx={{ color: 'accent.fg', display: 'flex' }}><InfoIcon size={14} /></Box>
        <Text sx={{ fontWeight: 500 }}>How grading works</Text>
        <Text sx={{ color: 'fg.subtle', fontSize: 0, display: ['none', 'inline'] }}>— what A–F means and how to read it</Text>
      </Box>

      {open ? (
        <Box sx={{ px: 3, pb: 3, pt: 2, fontSize: 1, color: 'fg.muted', lineHeight: 1.55, borderTop: '1px solid', borderColor: 'border.muted' }}>
          <Text sx={{ display: 'block' }}>
            One A–F read of how responsive a repo is to miner work — how fast miner PRs merge / issues resolve,
            whether that work actually lands, and how healthy the open queue is.
          </Text>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mt: 2, alignItems: 'baseline' }}>
            {GRADE_BANDS.map(([letter, range]) => (
              <Box key={letter} sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Text sx={{ fontWeight: 700, color: LETTER_COLOR[letter] }}>{letter}</Text>
                <Text className="tnum" sx={{ fontSize: 0, color: 'fg.subtle' }}>{range}</Text>
              </Box>
            ))}
          </Box>

          <GuideRow label="PR repos">merge speed 50% · acceptance (% of miner PRs merged) 30% · backlog health 20%</GuideRow>
          <GuideRow label="Issue-discovery repos">resolve speed 60% · completion rate 40%</GuideRow>
          <GuideRow label="Mixed repos">the two, blended by the repo&apos;s issue-discovery share</GuideRow>
          <GuideRow label="PR speed">≤12h very fast · ≤24h fast · ≤48h normal · ≤96h slow · slower very slow</GuideRow>
          <GuideRow label="Issue speed">≤2d very fast · ≤1w fast · ≤3w normal · ≤6w slow · slower very slow</GuideRow>

          <Text sx={{ display: 'block', mt: 3, fontWeight: 600, color: 'fg.default' }}>Reading it</Text>
          <Box as="ul" sx={{ mt: 1, pl: '18px', '& li': { mb: 1 } }}>
            <li><strong>A / B</strong> — miner work lands fast and mostly gets accepted, with a clean queue.</li>
            <li><strong>D / F</strong> — miner PRs/issues stall, get rejected, or pile up.</li>
            <li><strong>“*”</strong> — provisional: fewer than 5 resolved items, so treat it as low-confidence.</li>
            <li>Pair the grade with the shipping numbers — a <strong>B over hundreds</strong> of merges is stronger evidence than an <strong>A over a handful</strong>.</li>
          </Box>

          <Text sx={{ display: 'block', mt: 3, fontWeight: 600, color: 'fg.default' }}>Caveats</Text>
          <Box as="ul" sx={{ mt: 1, pl: '18px', '& li': { mb: 1 } }}>
            <li>Repo-attributed: all of a repo&apos;s maintainers share its grade (an individual merge can&apos;t be credited — GitHub&apos;s PR list omits <code>merged_by</code>).</li>
            <li>Speed reflects the repo&apos;s merge/close activity, which a <strong>bot or app with merge rights can drive</strong> — not necessarily the listed maintainers.</li>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function Stateful({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <Box
      sx={{
        py: 5, textAlign: 'center', fontSize: 1,
        color: tone === 'danger' ? 'danger.fg' : 'fg.muted',
        border: '1px solid', borderColor: 'border.subtle', borderRadius: 2,
      }}
    >
      {children}
    </Box>
  );
}
