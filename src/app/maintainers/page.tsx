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
import type { MaintainersResponse, MaintainerSummary, MaintainerRepoContribution, RepoMaintainersSummary, MaintainerGradeInput } from '@/lib/api-types';

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

type GradeLetter = MaintainerSummary['gradeLetter'];
type GradeMix = 'policy' | 'balanced' | 'pr' | 'issue';

interface DisplayGrade {
  score: number | null;
  letter: GradeLetter;
}

interface GradeSettings {
  prSpeed: number;
  prAcceptance: number;
  prBacklog: number;
  issueSpeed: number;
  issueCompletion: number;
  mix: GradeMix;
}

const DEFAULT_GRADE_SETTINGS: GradeSettings = {
  prSpeed: 50,
  prAcceptance: 30,
  prBacklog: 20,
  issueSpeed: 60,
  issueCompletion: 40,
  mix: 'policy',
};

const MIX_OPTIONS: ReadonlyArray<{ value: GradeMix; label: string; detail: string }> = [
  { value: 'policy', label: 'Repo split', detail: 'Use repo PR / issue split' },
  { value: 'balanced', label: '50 / 50', detail: 'Equal PR and issue weight' },
  { value: 'pr', label: 'PR only', detail: 'Score only PR-side signal' },
  { value: 'issue', label: 'Issues only', detail: 'Score only issue-side signal' },
];

function gradeMixLabel(mix: GradeMix): string {
  return MIX_OPTIONS.find((o) => o.value === mix)?.label ?? 'Repo split';
}

function gradeSettingsEqual(a: GradeSettings, b: GradeSettings): boolean {
  return a.prSpeed === b.prSpeed
    && a.prAcceptance === b.prAcceptance
    && a.prBacklog === b.prBacklog
    && a.issueSpeed === b.issueSpeed
    && a.issueCompletion === b.issueCompletion
    && a.mix === b.mix;
}

function gradeLetterFromScore(score: number | null): GradeLetter {
  if (score == null || !Number.isFinite(score)) return '—';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function blendScore(parts: Array<{ value: number | null; weight: number }>): number | null {
  let sum = 0;
  let weight = 0;
  for (const part of parts) {
    if (part.value == null || !Number.isFinite(part.value) || part.weight <= 0) continue;
    sum += part.value * part.weight;
    weight += part.weight;
  }
  return weight > 0 ? sum / weight : null;
}

function prSideScore(pr: MaintainerGradeInput['pr'], settings: GradeSettings): number | null {
  if (!pr) return null;
  const total = settings.prSpeed + settings.prAcceptance + settings.prBacklog;
  if (total <= 0) return null;
  return blendScore([
    { value: pr.speed, weight: settings.prSpeed },
    { value: pr.acceptance, weight: settings.prAcceptance },
    { value: pr.backlog, weight: settings.prBacklog },
  ]);
}

function issueSideScore(issue: MaintainerGradeInput['issue'], settings: GradeSettings): number | null {
  if (!issue) return null;
  const total = settings.issueSpeed + settings.issueCompletion;
  if (total <= 0) return null;
  return blendScore([
    { value: issue.speed, weight: settings.issueSpeed },
    { value: issue.completion, weight: settings.issueCompletion },
  ]);
}

function issueWeightForMix(settings: GradeSettings, issueDiscoveryShare: number, hasPr: boolean, hasIssue: boolean): number {
  if (settings.mix === 'pr') return 0;
  if (settings.mix === 'issue') return 1;
  if (!hasPr && hasIssue) return 1;
  if (hasPr && !hasIssue) return 0;
  if (!hasPr && !hasIssue) return 0;
  if (settings.mix === 'balanced') return 0.5;
  return Math.min(1, Math.max(0, issueDiscoveryShare));
}

function gradeFromInput(input: MaintainerGradeInput, issueDiscoveryShare: number, settings: GradeSettings): DisplayGrade {
  const pr = prSideScore(input.pr, settings);
  const issue = issueSideScore(input.issue, settings);
  const issueWeight = issueWeightForMix(settings, issueDiscoveryShare, pr != null, issue != null);
  const score = blendScore([
    { value: pr, weight: 1 - issueWeight },
    { value: issue, weight: issueWeight },
  ]);
  return { score, letter: gradeLetterFromScore(score) };
}

function gradeForMaintainer(m: MaintainerSummary, settings: GradeSettings): DisplayGrade {
  let sum = 0;
  let sample = 0;
  for (const repo of m.repos) {
    const grade = gradeFromInput(repo.gradeInput, repo.issueDiscoveryShare, settings);
    if (grade.score == null || repo.gradeInput.sample <= 0) continue;
    sum += grade.score * repo.gradeInput.sample;
    sample += repo.gradeInput.sample;
  }
  const score = sample > 0 ? sum / sample : null;
  return { score, letter: gradeLetterFromScore(score) };
}

function fallbackGrade(score: number | null, letter: GradeLetter): DisplayGrade {
  return { score, letter };
}

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
function GradeTip({ settings, customActive }: { settings: GradeSettings; customActive: boolean }) {
  return (
    <>
      <Text sx={{ display: 'block', fontWeight: 600, color: 'fg.default', mb: 1 }}>Grade · responsiveness to miner work</Text>
      <Text sx={{ display: 'block', color: 'fg.muted' }}>
        Blends merge / resolve speed, acceptance and backlog health. Default uses the repo&apos;s PR vs issue-discovery split.
      </Text>
      <Text sx={{ display: 'block', color: customActive ? 'attention.fg' : 'fg.subtle', mt: 1 }}>
        Current: {customActive ? 'custom' : 'default'} · PR {settings.prSpeed}/{settings.prAcceptance}/{settings.prBacklog} · issues {settings.issueSpeed}/{settings.issueCompletion} · {gradeMixLabel(settings.mix)}.
      </Text>
      <Text sx={{ display: 'block', color: 'fg.subtle', mt: 1 }}>
        Repo-attributed, and can reflect a bot/app with merge rights. See “How grading works”.
      </Text>
    </>
  );
}

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
  const [gradeSettings, setGradeSettings] = useState<GradeSettings>(DEFAULT_GRADE_SETTINGS);
  const customGradeActive = !gradeSettingsEqual(gradeSettings, DEFAULT_GRADE_SETTINGS);
  const updateGradeSettings = (patch: Partial<GradeSettings>) => setGradeSettings((prev) => ({ ...prev, ...patch }));

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

  const maintainerGrades = useMemo(() => {
    const map = new Map<string, DisplayGrade>();
    for (const m of dataQuery.data?.maintainers ?? []) map.set(keyOf(m), gradeForMaintainer(m, gradeSettings));
    return map;
  }, [dataQuery.data?.maintainers, gradeSettings]);

  const repoGrades = useMemo(() => {
    const map = new Map<string, DisplayGrade>();
    for (const r of dataQuery.data?.repos ?? []) map.set(r.repo, gradeFromInput(r.gradeInput, r.issueDiscoveryShare, gradeSettings));
    return map;
  }, [dataQuery.data?.repos, gradeSettings]);

  const filtered = useMemo(() => {
    const all = dataQuery.data?.maintainers ?? [];
    const q = query.trim().toLowerCase();
    const base = q
      ? all.filter((m) => m.login.toLowerCase().includes(q) || m.repos.some((r) => r.repo.toLowerCase().includes(q)))
      : all;
    const get = sortKey === 'grade'
      ? (m: MaintainerSummary) => maintainerGrades.get(keyOf(m))?.score ?? -1
      : M_SORT[sortKey];
    return [...base].sort((a, b) => get(b) - get(a) || b.shipped30d - a.shipped30d || a.login.localeCompare(b.login));
  }, [dataQuery.data?.maintainers, maintainerGrades, query, sortKey]);

  const filteredRepos = useMemo(() => {
    const all = dataQuery.data?.repos ?? [];
    const q = query.trim().toLowerCase();
    const base = q
      ? all.filter((r) => r.repo.toLowerCase().includes(q) || r.maintainers.some((m) => m.login.toLowerCase().includes(q)))
      : all;
    const get = sortKey === 'grade'
      ? (r: RepoMaintainersSummary) => repoGrades.get(r.repo)?.score ?? -1
      : R_SORT[sortKey];
    return [...base].sort((a, b) => get(b) - get(a) || b.shipped30d - a.shipped30d || a.repo.localeCompare(b.repo));
  }, [dataQuery.data?.repos, query, repoGrades, sortKey]);

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

      <GradeGuide
        open={showGuide}
        settings={gradeSettings}
        customActive={customGradeActive}
        onChange={updateGradeSettings}
        onReset={() => setGradeSettings(DEFAULT_GRADE_SETTINGS)}
        onToggle={() => setShowGuide((v) => !v)}
      />

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
              <HeaderRow first="Maintainer" count="Repos" settings={gradeSettings} customActive={customGradeActive} />
              {filtered.map((m) => {
                const k = keyOf(m);
                return (
                  <MaintainerRow
                    key={k}
                    m={m}
                    grade={maintainerGrades.get(k) ?? fallbackGrade(m.gradeScore, m.gradeLetter)}
                    gradeSettings={gradeSettings}
                    minerPoolTAO={minerPoolTAO}
                    expanded={expanded.has(k)}
                    onToggle={() => toggle(k)}
                  />
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
            <HeaderRow first="Repository" count="Maintainers" settings={gradeSettings} customActive={customGradeActive} />
            {filteredRepos.map((r) => {
              const k = `repo:${r.repo}`;
              return (
                <RepoRow
                  key={k}
                  r={r}
                  grade={repoGrades.get(r.repo) ?? fallbackGrade(r.gradeScore, r.gradeLetter)}
                  minerPoolTAO={minerPoolTAO}
                  expanded={expanded.has(k)}
                  onToggle={() => toggle(k)}
                />
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

function HeaderRow({ first, count, settings, customActive }: { first: string; count: string; settings: GradeSettings; customActive: boolean }) {
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
        <Tooltip content={<GradeTip settings={settings} customActive={customActive} />}>
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
  m, grade, gradeSettings, minerPoolTAO, expanded, onToggle,
}: {
  m: MaintainerSummary; grade: DisplayGrade; gradeSettings: GradeSettings; minerPoolTAO: number; expanded: boolean; onToggle: () => void;
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
          <Text sx={{ fontWeight: 600, fontSize: 2, color: LETTER_COLOR[grade.letter] ?? '#62666d' }}>{grade.letter}</Text>
          {grade.score != null ? (
            <Text className="tnum" sx={{ fontSize: 0, color: 'fg.subtle', ml: 1 }}>{Math.round(grade.score)}</Text>
          ) : null}
        </Box>

        {/* τ / day */}
        <Box sx={{ textAlign: 'right' }}>
          <Text className="tnum mono" sx={{ color: tao > 0 ? 'success.fg' : 'fg.subtle', fontWeight: 500 }}>{fmtTao(tao)}</Text>
        </Box>
      </Box>

      {expanded ? <RepoBreakdown m={m} gradeSettings={gradeSettings} minerPoolTAO={minerPoolTAO} /> : null}
    </Box>
  );
}

function RepoBreakdown({ m, gradeSettings, minerPoolTAO }: { m: MaintainerSummary; gradeSettings: GradeSettings; minerPoolTAO: number }) {
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
        const grade = gradeFromInput(r.gradeInput, r.issueDiscoveryShare, gradeSettings);
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
              <Text sx={{ fontWeight: 600, color: grade.score != null ? LETTER_COLOR[grade.letter] : 'fg.subtle' }}>{grade.letter}</Text>
              {grade.score != null ? <Text className="tnum" sx={{ color: 'fg.subtle', ml: 1 }}>{Math.round(grade.score)}{r.provisional ? '*' : ''}</Text> : null}
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
  r, grade, minerPoolTAO, expanded, onToggle,
}: {
  r: RepoMaintainersSummary; grade: DisplayGrade; minerPoolTAO: number; expanded: boolean; onToggle: () => void;
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
          <Text sx={{ fontWeight: 600, fontSize: 2, color: LETTER_COLOR[grade.letter] ?? '#62666d' }}>{grade.letter}</Text>
          {grade.score != null ? (
            <Text className="tnum" sx={{ fontSize: 0, color: 'fg.subtle', ml: 1 }}>{Math.round(grade.score)}</Text>
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

function WeightSlider({ label, value, onChange, hint }: { label: string; value: number; onChange: (value: number) => void; hint: string }) {
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'baseline' }}>
        <Text sx={{ color: 'fg.default', fontWeight: 500 }}>{label}</Text>
        <Text className="tnum" sx={{ color: 'fg.subtle', fontSize: 0 }}>{value}%</Text>
      </Box>
      <input
        aria-label={label}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={{ width: '100%', accentColor: 'var(--fgColor-accent, #2f81f7)' }}
      />
      <Text sx={{ color: 'fg.subtle', fontSize: 0 }}>{hint}</Text>
    </Box>
  );
}

function MixButton({ active, label, detail, onClick }: { active: boolean; label: string; detail: string; onClick: () => void }) {
  return (
    <Box
      as="button"
      type="button"
      onClick={onClick}
      sx={{
        minWidth: 118, px: 2, py: 2, textAlign: 'left', borderRadius: 2, cursor: 'pointer',
        border: '1px solid', borderColor: active ? 'accent.emphasis' : 'border.default',
        bg: active ? 'accent.subtle' : 'transparent', color: active ? 'accent.fg' : 'fg.default',
      }}
    >
      <Text sx={{ display: 'block', fontWeight: 600, fontSize: 0 }}>{label}</Text>
      <Text sx={{ display: 'block', color: active ? 'accent.fg' : 'fg.subtle', fontSize: '11px', mt: 1, lineHeight: 1.35 }}>{detail}</Text>
    </Box>
  );
}

function GradeGuide({
  open, settings, customActive, onChange, onReset, onToggle,
}: {
  open: boolean;
  settings: GradeSettings;
  customActive: boolean;
  onChange: (patch: Partial<GradeSettings>) => void;
  onReset: () => void;
  onToggle: () => void;
}) {
  const prTotal = settings.prSpeed + settings.prAcceptance + settings.prBacklog;
  const issueTotal = settings.issueSpeed + settings.issueCompletion;

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
        <Text sx={{ color: 'fg.subtle', fontSize: 0, display: ['none', 'inline'] }}>— customize the A–F formula</Text>
        <Box
          as="span"
          sx={{
            ml: 'auto', px: 2, py: '2px', borderRadius: 1, fontSize: 0,
            border: '1px solid', borderColor: customActive ? 'attention.muted' : 'border.default',
            color: customActive ? 'attention.fg' : 'fg.subtle', whiteSpace: 'nowrap',
          }}
        >
          {customActive ? 'custom' : 'default'}
        </Box>
      </Box>

      {open ? (
        <Box sx={{ px: 3, pb: 3, pt: 2, fontSize: 1, color: 'fg.muted', lineHeight: 1.55, borderTop: '1px solid', borderColor: 'border.muted' }}>
          <Text sx={{ display: 'block' }}>
            One A–F read of how responsive a repo is to miner work: how fast miner PRs merge / issues resolve,
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

          <GuideRow label="Default PR repos">merge speed 50% · acceptance (% of miner PRs merged) 30% · backlog health 20%</GuideRow>
          <GuideRow label="Default issue repos">resolve speed 60% · completion rate 40%</GuideRow>
          <GuideRow label="Default mixed repos">PR and issue sides blend by the repo&apos;s issue-discovery share</GuideRow>
          <GuideRow label="Speed bands">PR: ≤12h very fast · ≤24h fast · ≤48h normal · ≤96h slow. Issues: ≤2d very fast · ≤1w fast · ≤3w normal · ≤6w slow.</GuideRow>

          <Box sx={{ mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'border.muted' }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 2, alignItems: 'center', mb: 2 }}>
              <Box>
                <Text sx={{ display: 'block', fontWeight: 600, color: 'fg.default' }}>Customize grading</Text>
                <Text sx={{ color: 'fg.subtle', fontSize: 0 }}>Weights normalize inside each side; 0 disables that ingredient.</Text>
              </Box>
              <Box
                as="button"
                type="button"
                onClick={onReset}
                disabled={!customActive}
                sx={{
                  px: 2, py: 1, fontSize: 0, borderRadius: 2, cursor: customActive ? 'pointer' : 'default',
                  border: '1px solid', borderColor: 'border.default', bg: 'transparent',
                  color: customActive ? 'fg.muted' : 'fg.subtle', opacity: customActive ? 1 : 0.55,
                }}
              >
                Reset
              </Box>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr 1fr'], gap: 4 }}>
              <Box sx={{ display: 'grid', gap: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  <Text sx={{ fontWeight: 600, color: 'fg.default' }}>PR review</Text>
                  <Text className="tnum" sx={{ color: prTotal > 0 ? 'fg.subtle' : 'attention.fg', fontSize: 0 }}>total {prTotal}%</Text>
                </Box>
                <WeightSlider label="Merge speed" value={settings.prSpeed} onChange={(prSpeed) => onChange({ prSpeed })} hint="How quickly miner PRs reach merge." />
                <WeightSlider label="Acceptance" value={settings.prAcceptance} onChange={(prAcceptance) => onChange({ prAcceptance })} hint="Share of resolved miner PRs that merged." />
                <WeightSlider label="Backlog health" value={settings.prBacklog} onChange={(prBacklog) => onChange({ prBacklog })} hint="Open PR age, stale share, and queue size." />
              </Box>

              <Box sx={{ display: 'grid', gap: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  <Text sx={{ fontWeight: 600, color: 'fg.default' }}>Issue discovery</Text>
                  <Text className="tnum" sx={{ color: issueTotal > 0 ? 'fg.subtle' : 'attention.fg', fontSize: 0 }}>total {issueTotal}%</Text>
                </Box>
                <WeightSlider label="Resolve speed" value={settings.issueSpeed} onChange={(issueSpeed) => onChange({ issueSpeed })} hint="How quickly completed miner issues close." />
                <WeightSlider label="Completion" value={settings.issueCompletion} onChange={(issueCompletion) => onChange({ issueCompletion })} hint="Share of miner issues closed as completed." />
              </Box>
            </Box>

            <Box sx={{ mt: 3 }}>
              <Text sx={{ display: 'block', mb: 2, fontWeight: 600, color: 'fg.default' }}>PR / issue blend</Text>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {MIX_OPTIONS.map((option) => (
                  <MixButton
                    key={option.value}
                    active={settings.mix === option.value}
                    label={option.label}
                    detail={option.detail}
                    onClick={() => onChange({ mix: option.value })}
                  />
                ))}
              </Box>
            </Box>
          </Box>

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
