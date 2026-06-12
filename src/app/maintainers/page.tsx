'use client';

export const dynamic = 'force-dynamic';

// Person-centric companion to the repo-centric leaderboard (/repositories →
// Maintainers board): every maintainer across every tracked SN74 repo and how
// much miner work ships through the repos they steward. "Shipping" is
// repo-attributed — GitHub's PR list endpoint omits `merged_by`, so we cannot
// credit an individual merge to one maintainer; a repo's throughput is credited
// to each of its maintainers. Reward (τ/day) is exact, split among a repo's
// registered miner-maintainers.
import React, { useMemo, useState } from 'react';
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

// What the A–F grade means — shown as the Grade-column tooltip. Mirrors
// maintainerGrade() in api-types, and is honest that the speed signal reflects
// the repo's merge/close activity (which a bot or merge-app can drive), not
// necessarily the named maintainers.
const GRADE_HELP =
  'Grade (A–F): how responsive the repo is to miner work.\n' +
  '• PR repos — merge speed 50%, acceptance rate 30%, backlog health 20%\n' +
  '• Issue-discovery repos — resolve speed 60%, completion rate 40%\n' +
  '• Mixed repos blend the two by issue-discovery share\n' +
  '“*” marks a provisional grade (fewer than 5 resolved items).\n' +
  'Based on the repo’s merge/close activity, which can be driven by a bot or ' +
  'app with merge rights — not necessarily the listed maintainers.';

/** Stable per-maintainer key — id when present, else login. Used for both the
 *  React list key and the expanded-row set, so two people who happen to share a
 *  login can't toggle together. */
const keyOf = (m: MaintainerSummary): string => (m.githubId ? `id:${m.githubId}` : `login:${m.login.toLowerCase()}`);

export default function MaintainersPage() {
  const [view, setView] = useState<View>('maintainer');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('reward');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
      <Box
        as="span"
        title={GRADE_HELP}
        sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, cursor: 'help', color: 'fg.muted' }}
      >
        Grade <InfoIcon size={11} />
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
  return (
    <Box sx={{ bg: 'canvas.inset', px: 3, py: 2, borderTop: '1px solid', borderColor: 'border.muted' }}>
      {m.repos.map((r, i) => {
        const tao = r.rewardShare * minerPoolTAO;
        const ship30 = r.mergedPrs30d + r.issuesResolved30d;
        return (
          <Box
            key={`${r.repo}-${i}`}
            sx={{
              display: 'grid',
              gridTemplateColumns: ['1fr', 'minmax(160px,1.4fr) 72px 128px 80px 72px 90px'],
              alignItems: 'center', gap: 2, py: '6px', fontSize: 0,
              borderBottom: '1px solid', borderColor: 'border.muted',
              '&:last-child': { borderBottom: 'none' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://github.com/${r.repo.split('/')[0]}.png?size=32`}
                alt=""
                width={16}
                height={16}
                style={{ borderRadius: 3, flexShrink: 0, background: 'var(--bgColor-muted, #222)' }}
              />
              <a
                href={`https://github.com/${r.repo}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                <Text sx={{ color: 'fg.muted' }}>{r.repo.split('/')[0]}/</Text>
                <Text sx={{ fontWeight: 500 }}>{r.repo.split('/')[1]}</Text>
              </a>
              <Text sx={{ color: MODE_COLOR[r.mode], textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0, fontSize: '9.5px' }}>
                {r.mode === 'PR' ? 'PR' : r.mode === 'issue' ? 'issue' : 'mixed'}
              </Text>
            </Box>
            <Text sx={{ textAlign: ['left', 'right'], color: r.gradeScore != null ? LETTER_COLOR[r.gradeLetter] : 'fg.subtle' }}>
              {r.gradeLetter}{r.gradeScore != null ? ` ${Math.round(r.gradeScore)}` : ''}{r.provisional ? '*' : ''}
            </Text>
            <Text className="tnum" sx={{ textAlign: ['left', 'right'], color: 'fg.muted' }}>
              {ship30} / 30d · {formatDurationHours(r.speedHours)}
            </Text>
            <Text className="tnum" sx={{ textAlign: ['left', 'right'], color: 'fg.subtle' }}>
              {r.mergedPrsTotal + r.issuesCompleted} total
            </Text>
            <Text className="tnum" sx={{ textAlign: ['left', 'right'], color: r.maintainerCut > 0 ? 'fg.muted' : 'fg.subtle' }} title="Maintainer cut — share of this repo's emission reserved for maintainers">
              {(r.maintainerCut * 100).toFixed(r.maintainerCut > 0 && r.maintainerCut < 0.1 ? 1 : 0)}% cut
            </Text>
            <Text className="tnum mono" sx={{ textAlign: ['left', 'right'], color: tao > 0 ? 'success.fg' : 'fg.subtle' }}>
              {fmtTao(tao)} τ/d
            </Text>
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

function RepoMaintainerList({ r, minerPoolTAO }: { r: RepoMaintainersSummary; minerPoolTAO: number }) {
  return (
    <Box sx={{ bg: 'canvas.inset', px: 3, py: 2, borderTop: '1px solid', borderColor: 'border.muted' }}>
      {r.maintainers.map((m, i) => {
        const tao = m.rewardShare * minerPoolTAO;
        return (
          <Box
            key={`${m.githubId ?? m.login}-${i}`}
            sx={{
              display: 'grid', gridTemplateColumns: ['1fr', 'minmax(160px,1fr) 140px 90px'],
              alignItems: 'center', gap: 2, py: '6px', fontSize: 0,
              borderBottom: '1px solid', borderColor: 'border.muted', '&:last-child': { borderBottom: 'none' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://github.com/${m.login}.png?size=32`}
                alt=""
                width={16}
                height={16}
                style={{ borderRadius: '50%', flexShrink: 0, background: 'var(--bgColor-muted, #222)' }}
              />
              <a
                href={`https://github.com/${m.login}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                <Text sx={{ fontWeight: 500 }}>{m.login}</Text>
              </a>
              {m.registered ? (
                <Box sx={{ color: 'accent.fg', display: 'flex', flexShrink: 0 }} title="Registered Gittensor miner">
                  <VerifiedIcon size={12} />
                </Box>
              ) : null}
            </Box>
            <Text sx={{ textAlign: ['left', 'right'], color: 'fg.subtle' }}>
              {m.registered ? 'registered miner' : 'not a registered miner'}
            </Text>
            <Text className="tnum mono" sx={{ textAlign: ['left', 'right'], color: tao > 0 ? 'success.fg' : 'fg.subtle' }}>
              {fmtTao(tao)} τ/d
            </Text>
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
