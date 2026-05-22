'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Box, Text } from '@primer/react';
import {
  RepoIcon,
  GitMergeIcon, GitPullRequestIcon, GitPullRequestClosedIcon,
  IssueClosedIcon, IssueOpenedIcon, SkipIcon,
  CheckCircleIcon, LinkExternalIcon,
} from '@primer/octicons-react';
import { formatUsd, formatRelativeTime } from '@/lib/format';
import {
  Card, CardHeader, CountCell, RowSizeSelector, PageNav, SearchBox, SortControl,
  EmptyState, MONO, LABEL, NOWRAP,
  computeSparklinePath, summarizeTrend,
  stopPropagation, ratePctOrNull,
  ColumnHeader,
} from '../../components';
import type { ColumnHeaderProps, SortDir } from '../../components';
import { useSearchPage } from './shared';
import type { Mode, PrDetail, IssueDetail, RepoBucket, RepoEval } from './types';

type SortCol = 'repo' | 'merged' | 'valid' | 'open' | 'closed' | 'changes' | 'cred' | 'score' | 'earning' | 'solved' | 'recent';

const REPO_COLS = 'minmax(220px, 280px) minmax(100px, 1fr) 60px 56px 54px 54px 88px minmax(64px, 80px) 60px 80px 60px';
const SPARK_ALL_DAYS = 90;

const SORT_OPTIONS_OSS: { key: SortCol; label: string }[] = [
  { key: 'earning', label: '$/Day' },
  { key: 'score',   label: 'Score' },
  { key: 'merged',  label: 'Merged' },
  { key: 'valid',   label: 'Valid' },
  { key: 'open',    label: 'Open' },
  { key: 'closed',  label: 'Closed' },
  { key: 'changes', label: 'Changes' },
  { key: 'cred',    label: 'Credibility' },
  { key: 'recent',  label: 'Last Activity' },
  { key: 'repo',    label: 'Repository' },
];

const SORT_OPTIONS_DISC: { key: SortCol; label: string }[] = [
  { key: 'earning', label: '$/Day' },
  { key: 'score',   label: 'Score' },
  { key: 'solved',  label: 'Solved' },
  { key: 'valid',   label: 'Valid' },
  { key: 'open',    label: 'Open' },
  { key: 'closed',  label: 'Closed' },
  { key: 'cred',    label: 'Credibility' },
  { key: 'recent',  label: 'Last Activity' },
  { key: 'repo',    label: 'Repository' },
];

export interface RepoBreakdownProps {
  repos: RepoBucket[];
  selectedRepo: string | null;
  onSelectRepo: (repo: string | null) => void;
  mode: Mode;
  ossEarningPerDay: number;
  discEarningPerDay: number;
  issueDiscoveryScore: number;
  repoEvalMap: Map<string, RepoEval>;
  periodDays: number | null;
  periodLabel: string;
}

export function RepoBreakdown({
  repos, selectedRepo, onSelectRepo, mode,
  ossEarningPerDay, discEarningPerDay, issueDiscoveryScore, repoEvalMap,
  periodDays, periodLabel,
}: RepoBreakdownProps) {
  const sparkDays = periodDays ?? SPARK_ALL_DAYS;
  const [sortCol, setSortCol] = useState<SortCol>('earning');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    const validKeys = (mode === 'oss' ? SORT_OPTIONS_OSS : SORT_OPTIONS_DISC).map((o) => o.key);
    if (!validKeys.includes(sortCol)) setSortCol('earning');
  }, [mode, sortCol]);

  const sorted = useMemo(() => {
    function recentOf(r: RepoBucket): number {
      let latest = 0;
      const sources: { iso: string | null | undefined }[] = mode === 'oss'
        ? r.prs.map((p) => ({ iso: p.mergedAt ?? p.prCreatedAt }))
        : [
            ...r.discovered.map((i) => ({ iso: i.closedAt ?? i.createdAt })),
            ...r.solvedByPr.map((i) => ({ iso: i.closedAt ?? i.createdAt })),
          ];
      for (const s of sources) {
        if (!s.iso) continue;
        const t = Date.parse(s.iso);
        if (Number.isFinite(t) && t > latest) latest = t;
      }
      return latest;
    }
    function solvedDisplay(r: RepoBucket): number {
      return r.solvedIssue + r.completedIssue;
    }
    function valueOf(r: RepoBucket, col: SortCol): number {
      if (col === 'recent') return recentOf(r);
      if (mode === 'oss') {
        switch (col) {
          case 'merged':  return r.merged;
          case 'valid':   return r.validPrs;
          case 'open':    return r.openPr;
          case 'closed':  return r.closedPr;
          case 'changes': return r.additions + r.deletions;
          case 'cred':    return (r.merged + r.closedPr) > 0 ? r.merged / (r.merged + r.closedPr) : 0;
          case 'score':   return r.realScore;
          case 'earning': return r.predictedUsd;
          case 'solved':  return r.merged;
          case 'repo':    return 0;
        }
      } else {
        const sd = solvedDisplay(r);
        switch (col) {
          case 'solved':  return sd;
          case 'valid':   return repoEvalMap.get(r.repo.toLowerCase())?.totalValidSolvedIssues ?? r.solvedByPr.length;
          case 'open':    return r.openIssue;
          case 'closed':  return r.closedIssue;
          case 'changes': return 0;
          case 'cred':    return (sd + r.closedIssue) > 0 ? sd / (sd + r.closedIssue) : 0;
          case 'score':   return r.solvedIssue;
          case 'earning': return r.solvedIssue;
          case 'merged':  return sd;
          case 'repo':    return 0;
        }
      }
      return 0;
    }
    return [...repos].sort((a, b) => {
      if (sortCol === 'repo') {
        const cmp = a.repo.localeCompare(b.repo);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const cmp = valueOf(a, sortCol) - valueOf(b, sortCol);
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [repos, sortCol, sortDir, mode, repoEvalMap]);

  const { search, setSearch, page, setPage, filtered, paged } = useSearchPage(
    sorted,
    (r, q) => r.repo.toLowerCase().includes(q),
    pageSize,
  );

  const ossEarnScale = useMemo(() => {
    const eligibleRaw = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isEligible ? r.predictedUsd : 0), 0);
    return eligibleRaw > 0 ? ossEarningPerDay / eligibleRaw : 0;
  }, [repos, ossEarningPerDay, repoEvalMap]);
  const discEarnScale = useMemo(() => {
    const totalSolved = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible ? r.solvedIssue : 0), 0);
    return totalSolved > 0 ? discEarningPerDay / totalSolved : 0;
  }, [repos, discEarningPerDay, repoEvalMap]);
  const discScoreScale = useMemo(() => {
    const totalSolved = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible ? r.solvedIssue : 0), 0);
    return totalSolved > 0 ? issueDiscoveryScore / totalSolved : 0;
  }, [repos, issueDiscoveryScore, repoEvalMap]);

  const earningOf = useCallback((r: RepoBucket) => {
    const e = repoEvalMap.get(r.repo.toLowerCase());
    if (mode === 'oss')   return e?.isEligible      ? r.predictedUsd * ossEarnScale : 0;
    if (mode === 'discovery') return e?.isIssueEligible ? r.solvedIssue  * discEarnScale : 0;
    return 0;
  }, [mode, ossEarnScale, discEarnScale, repoEvalMap]);

  const totalEarn = useMemo(() => {
    let s = 0;
    for (const r of repos) s += earningOf(r);
    return s;
  }, [repos, earningOf]);

  const sums = useMemo(() => {
    let merged = 0, open = 0, closed = 0, scoreSum = 0, earnSum = 0;
    let solved = 0, valid = 0;
    let additions = 0, deletions = 0;
    for (const r of repos) {
      const e = repoEvalMap.get(r.repo.toLowerCase());
      if (mode === 'oss') {
        merged += r.merged; open += r.openPr; closed += r.closedPr;
        valid += r.validPrs;
        additions += r.additions; deletions += r.deletions;
        if (e?.isEligible) scoreSum += r.realScore;
        earnSum += e?.isEligible ? r.predictedUsd * ossEarnScale : 0;
      } else {
        solved += r.solvedIssue + r.completedIssue;
        open += r.openIssue; closed += r.closedIssue;
        valid += e?.totalValidSolvedIssues ?? r.solvedByPr.length;
        if (e?.isIssueEligible) earnSum += r.solvedIssue * discEarnScale;
      }
    }
    if (mode === 'discovery') scoreSum = issueDiscoveryScore;
    return { merged, solved, valid, open, closed, scoreSum, earnSum, additions, deletions };
  }, [repos, repoEvalMap, mode, ossEarnScale, discEarnScale, issueDiscoveryScore]);

  if (repos.length === 0) {
    return <EmptyState icon={<RepoIcon size={20} />} text="No repository activity in this window." />;
  }

  function toggleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
    setPage(0);
  }

  const primaryLabel = mode === 'oss' ? 'Merged' : 'Solved';

  return (
    <Card>
      <CardHeader
        icon={<RepoIcon size={13} />}
        title="Per-repository P&L"
        sub={selectedRepo ? `filtering · ${selectedRepo}` : `${repos.length} repo${repos.length === 1 ? '' : 's'}`}
        right={
          <>
            <SortControl<SortCol>
              value={sortCol}
              dir={sortDir}
              onChange={(k) => { setSortCol(k); setPage(0); }}
              onToggleDir={() => { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(0); }}
              options={mode === 'oss' ? SORT_OPTIONS_OSS : SORT_OPTIONS_DISC}
              minWidth={130}
            />
            <RowSizeSelector
              value={pageSize}
              onChange={(n) => { setPageSize(n); setPage(0); }}
              showAll={false}
            />
            <SearchBox value={search} onChange={setSearch} placeholder="Filter repos…" />
          </>
        }
      />

      <Box sx={{ overflowX: ['visible', null, 'auto'] }}>
        <Box sx={{ minWidth: [0, null, 880] }}>
          <Box
            sx={{
              display: ['none', null, 'grid'],
              gridTemplateColumns: REPO_COLS,
              alignItems: 'center',
              borderBottom: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
              px: 2,
              py: '8px',
              columnGap: 1,
            }}
          >
            <RepoHdr align="left" active={sortCol === 'repo'} dir={sortDir} onClick={() => toggleSort('repo')}>Repository</RepoHdr>
            <RepoHdr
              align="left"
              active={sortCol === 'recent'}
              dir={sortDir}
              onClick={() => toggleSort('recent')}
              title={`${mode === 'oss' ? 'PR' : 'Issue'} activity in the ${periodLabel.toLowerCase()} window · sort by most-recent activity`}
            >Activity</RepoHdr>
            <RepoHdr active={sortCol === (mode === 'oss' ? 'merged' : 'solved')} dir={sortDir}
              onClick={() => toggleSort(mode === 'oss' ? 'merged' : 'solved')}>{primaryLabel}</RepoHdr>
            <RepoHdr
              active={sortCol === 'valid'} dir={sortDir} onClick={() => toggleSort('valid')}
              title={mode === 'oss' ? 'Merged PRs with tokenScore ≥ 5' : 'Solved issues counted toward eligibility'}
            >Valid</RepoHdr>
            <RepoHdr active={sortCol === 'open'} dir={sortDir} onClick={() => toggleSort('open')}>Open</RepoHdr>
            <RepoHdr active={sortCol === 'closed'} dir={sortDir} onClick={() => toggleSort('closed')}>Closed</RepoHdr>
            <RepoHdr
              active={sortCol === 'changes'} dir={sortDir} onClick={() => toggleSort('changes')}
              title="Total code changes — additions + deletions"
            >Changes</RepoHdr>
            <RepoHdr active={sortCol === 'cred'} dir={sortDir} onClick={() => toggleSort('cred')}>Cred</RepoHdr>
            <RepoHdr
              active={sortCol === 'earning'} dir={sortDir} onClick={() => toggleSort('earning')}
              title="Share of total daily earnings (earning ÷ Σ earnings)"
            >Earn %</RepoHdr>
            <RepoHdr active={sortCol === 'earning'} dir={sortDir} onClick={() => toggleSort('earning')}>$/Day</RepoHdr>
            <RepoHdr active={sortCol === 'score'} dir={sortDir} onClick={() => toggleSort('score')}>Score</RepoHdr>
          </Box>

          {paged.map((r) => (
            <RepoRow
              key={r.repo}
              row={r}
              isSelected={selectedRepo === r.repo}
              onSelect={() => onSelectRepo(r.repo)}
              mode={mode}
              repoEval={repoEvalMap.get(r.repo.toLowerCase())}
              earning={earningOf(r)}
              totalEarn={totalEarn}
              discScoreScale={discScoreScale}
              sparkDays={sparkDays}
              periodLabel={periodLabel}
            />
          ))}

          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
              No repositories match “{search}”
            </Box>
          )}

          <Box
            as="button"
            onClick={() => onSelectRepo(null)}
            title={selectedRepo ? 'Click to clear filter and show all repos' : undefined}
            sx={{
              width: '100%',
              display: ['none', null, 'grid'],
              gridTemplateColumns: REPO_COLS,
              alignItems: 'center',
              columnGap: 1,
              borderTop: '2px solid',
              borderColor: 'border.default',
              bg: selectedRepo ? 'canvas.default' : 'canvas.inset',
              px: 2,
              py: '8px',
              border: 'none',
              fontFamily: 'inherit',
              textAlign: 'left',
              cursor: selectedRepo ? 'pointer' : 'default',
              transition: 'background-color 100ms',
              '&:hover': selectedRepo ? { bg: 'canvas.inset' } : {},
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Text sx={{ ...LABEL, color: 'fg.muted' }}>{repos.length} repos</Text>
              {selectedRepo && (
                <Text sx={{ ...LABEL, color: 'accent.fg' }}>· show all</Text>
              )}
            </Box>
            <span />
            {}
            <SumNum v={mode === 'oss' ? sums.merged : sums.solved} />
            <span />
            <SumNum v={sums.open} />
            <SumNum v={sums.closed} />
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px', pr: '4px', lineHeight: 1 }}>
              {mode === 'oss' && (sums.additions + sums.deletions) > 0 ? (
                <>
                  <Text sx={{ ...MONO, fontSize: '10px', fontWeight: 700, color: 'success.fg' }}>
                    +{formatCompactNum(sums.additions)}
                  </Text>
                  <Text sx={{ ...MONO, fontSize: '10px', fontWeight: 700, color: 'danger.fg' }}>
                    −{formatCompactNum(sums.deletions)}
                  </Text>
                </>
              ) : (
                <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 700, color: 'fg.muted' }}>—</Text>
              )}
            </Box>
            <span />
            <SumNum v={sums.earnSum > 0 ? '100%' : '—'} />
            <SumNum v={sums.earnSum > 0 ? formatUsd(sums.earnSum, { style: 'compact' }) : '—'} tone="success" />
            <SumNum v={sums.scoreSum > 0 ? sums.scoreSum.toFixed(2) : '—'} />
          </Box>

          <Box
            as="button"
            onClick={() => onSelectRepo(null)}
            title={selectedRepo ? 'Tap to clear filter and show all repos' : undefined}
            sx={{
              display: ['flex', null, 'none'],
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              gap: 2,
              borderTop: '2px solid',
              borderColor: 'border.default',
              bg: selectedRepo ? 'canvas.default' : 'canvas.inset',
              px: 2,
              py: '10px',
              border: 'none',
              fontFamily: 'inherit',
              textAlign: 'left',
              cursor: selectedRepo ? 'pointer' : 'default',
              transition: 'background-color 100ms',
              '&:hover': selectedRepo ? { bg: 'canvas.inset' } : {},
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Text sx={{ ...LABEL, color: 'fg.muted' }}>{repos.length} repos</Text>
              {selectedRepo && (
                <Text sx={{ ...LABEL, color: 'accent.fg' }}>· show all</Text>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {sums.earnSum > 0 && (
                <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 700, color: 'success.fg' }}>
                  {formatUsd(sums.earnSum, { style: 'compact' })}/d
                </Text>
              )}
              {sums.scoreSum > 0 && (
                <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 700, color: 'fg.default' }}>
                  score {sums.scoreSum.toFixed(2)}
                </Text>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          px: [2, null, 3],
          py: '8px',
          borderTop: '1px solid',
          borderTopColor: 'border.muted',
          bg: 'canvas.subtle',
        }}
      >
        <PageNav
          page={page + 1}
          pageSize={pageSize}
          filteredCount={filtered.length}
          onPage={(p) => setPage(p - 1)}
        />
      </Box>
    </Card>
  );
}

function RepoHdr(props: ColumnHeaderProps) {
  return <ColumnHeader px="4px" iconSize={9} {...props} />;
}

function SumNum({ v, tone = 'neutral' }: { v: number | string; tone?: 'neutral' | 'success' | 'danger' | 'done' }) {
  const fg = tone === 'success' ? 'success.fg' : tone === 'danger' ? 'danger.fg' : tone === 'done' ? 'done.fg' : 'fg.default';
  const empty = v === '—' || v === 0;
  return (
    <Text
      sx={{ ...MONO, fontSize: '11px', fontWeight: 700, textAlign: 'right', pr: '4px' }}
      style={{ color: empty ? 'var(--fg-muted)' : `var(--${tone}-fg, var(--fg-default))` }}
    >
      <Box as="span" sx={{ color: fg }}>{typeof v === 'number' ? v.toLocaleString() : v}</Box>
    </Text>
  );
}

function RepoRow({
  row, isSelected, onSelect, mode, repoEval, earning, totalEarn, discScoreScale,
  sparkDays, periodLabel,
}: {
  row: RepoBucket;
  isSelected: boolean;
  onSelect: () => void;
  mode: Mode;
  repoEval: RepoEval | undefined;
  earning: number;
  totalEarn: number;
  discScoreScale: number;
  sparkDays: number;
  periodLabel: string;
}) {
  const [owner, name] = row.repo.split('/');
  const isEligible = mode === 'oss' ? repoEval?.isEligible === true : repoEval?.isIssueEligible === true;
  const credPct = mode === 'oss'
    ? ratePctOrNull(row.merged, row.merged + row.closedPr)
    : ratePctOrNull(row.solvedIssue, row.solvedIssue + row.closedIssue);
  const share = totalEarn > 0 ? earning / totalEarn : 0;
  const validCount = mode === 'oss'
    ? row.validPrs
    : (repoEval?.totalValidSolvedIssues ?? row.solvedByPr.length);
  const score = mode === 'oss'
    ? (isEligible && row.realScore > 0 ? row.realScore : 0)
    : (isEligible ? row.solvedIssue * discScoreScale : 0);
  const { lastActivityIso, daily } = useMemo(
    () => mode === 'oss'
      ? deriveRepoActivity(row.prs, sparkDays)
      : deriveIssueActivity(row.discovered, row.solvedByPr, sparkDays),
    [row.prs, row.discovered, row.solvedByPr, mode, sparkDays],
  );

  const totalChanges = row.additions + row.deletions;
  const primaryCount = mode === 'oss' ? row.merged : row.solvedIssue + row.completedIssue;
  const primaryLabel = mode === 'oss' ? 'merged' : 'solved';
  const openCount = mode === 'oss' ? row.openPr : row.openIssue;
  const closedCount = mode === 'oss' ? row.closedPr : row.closedIssue;
  const PrimaryIcon = mode === 'oss' ? GitMergeIcon : IssueClosedIcon;
  const OpenIcon = mode === 'oss' ? GitPullRequestIcon : IssueOpenedIcon;
  const ClosedIcon = mode === 'oss' ? GitPullRequestClosedIcon : SkipIcon;

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      sx={{
        width: '100%',
        display: 'block',
        p: 0,
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        color: 'fg.default',
        textAlign: 'left',
        cursor: 'pointer',
        bg: isSelected ? 'canvas.inset' : 'transparent',
        boxShadow: isSelected ? 'inset 2px 0 0 var(--accent-fg)' : 'none',
        transition: 'background-color 100ms',
        '&:hover': { bg: 'canvas.default' },
        '&:focus-visible': { outline: '2px solid var(--accent-fg)', outlineOffset: '-2px' },
      }}
    >
      <Box sx={{ display: ['flex', null, 'none'], flexDirection: 'column', gap: '8px', px: 2, py: '10px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <Box
            aria-label={isEligible ? 'Eligible' : 'Not eligible'}
            sx={{
              width: 8, height: 8, borderRadius: 999, flexShrink: 0,
              bg: isEligible ? 'success.fg' : 'transparent',
              border: isEligible ? 'none' : '1px solid',
              borderColor: 'border.muted',
            }}
          />
          <Box sx={{ color: 'fg.muted', display: 'inline-flex', flexShrink: 0 }}>
            <RepoIcon size={12} />
          </Box>
          <Text
            sx={{
              flex: 1, minWidth: 0, fontSize: 0, fontWeight: isSelected ? 700 : 600, color: 'fg.default',
              overflow: 'hidden', textOverflow: 'ellipsis', ...NOWRAP, lineHeight: 1.2,
            }}
            title={row.repo}
          >
            {row.repo}
          </Text>
          <Link
            href={`/repos/${owner}/${name}`}
            prefetch={false}
            onClick={stopPropagation}
            aria-label={`Open ${row.repo} repository page`}
            title={`Open ${row.repo}`}
            style={{ textDecoration: 'none', display: 'inline-flex', flexShrink: 0, color: 'inherit' }}
          >
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24, height: 24,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'border.muted',
                bg: 'canvas.default',
                color: 'fg.muted',
                '&:hover': { bg: 'canvas.inset', color: 'fg.default', borderColor: 'border.default' },
              }}
            >
              <LinkExternalIcon size={12} />
            </Box>
          </Link>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', pl: '20px' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <RepoActivitySpark values={daily} mode={mode} periodLabel={periodLabel} />
          </Box>
          {lastActivityIso && (
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap' }}>
              last {formatRelativeTime(lastActivityIso)}
            </Text>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', pl: '20px' }}>
          <MobileCountStat icon={<PrimaryIcon size={11} />} value={primaryCount} label={primaryLabel} tone="done" />
          <MobileCountStat icon={<CheckCircleIcon size={11} />} value={validCount} label="valid" tone="accent" />
          <MobileCountStat icon={<OpenIcon size={11} />} value={openCount} label="open" tone="success" />
          <MobileCountStat icon={<ClosedIcon size={11} />} value={closedCount} label="closed" tone="danger" />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', pl: '20px' }}>
          {mode === 'oss' && totalChanges > 0 && (
            <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}
                 title={`+${row.additions.toLocaleString()} −${row.deletions.toLocaleString()}`}>
              <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 600, color: 'success.fg' }}>
                +{formatCompactNum(row.additions)}
              </Text>
              <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 600, color: 'danger.fg' }}>
                −{formatCompactNum(row.deletions)}
              </Text>
            </Box>
          )}
          {credPct != null && (
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', whiteSpace: 'nowrap' }}>
              cred <Box as="span" sx={{ ...MONO, fontWeight: 700, color: 'fg.default' }}>{credPct}%</Box>
            </Text>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', pl: '20px' }}>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
            earn <Box as="span" sx={{ ...MONO, fontWeight: 700, color: 'fg.default' }}>
              {share > 0 ? `${Math.round(share * 100)}%` : '—'}
            </Box>
          </Text>
          <Text sx={{ color: 'fg.subtle' }}>·</Text>
          <Text
            sx={{ ...MONO, fontSize: '11px', fontWeight: 700 }}
            style={{ color: earning > 0 ? 'var(--success-fg)' : 'var(--fg-muted)' }}
          >
            {earning > 0 ? `${formatUsd(earning, { style: 'compact' })}/d` : '—'}
          </Text>
          <Text sx={{ color: 'fg.subtle' }}>·</Text>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
            score <Box as="span" sx={{ ...MONO, fontWeight: 700, color: 'fg.default' }}>
              {score > 0 ? score.toFixed(2) : '—'}
            </Box>
          </Text>
        </Box>
      </Box>

      <Box
        sx={{
          display: ['none', null, 'grid'],
          gridTemplateColumns: REPO_COLS,
          alignItems: 'center',
          columnGap: 1,
          px: 2,
          py: '8px',
        }}
      >
      {}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, pr: 1 }}>
        <Link
          href={`/repos/${owner}/${name}`}
          prefetch={false}
          onClick={stopPropagation}
          aria-label={`Open ${row.repo} repository page`}
          title={`Open ${row.repo}`}
          style={{ textDecoration: 'none', display: 'inline-flex', flexShrink: 0 }}
        >
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
              color: 'fg.muted',
              transition: 'color 100ms, border-color 100ms, background-color 100ms',
              '&:hover': { bg: 'canvas.inset', color: 'fg.default', borderColor: 'border.default' },
            }}
          >
            <LinkExternalIcon size={11} />
          </Box>
        </Link>
        <Box
          aria-label={isEligible ? 'Eligible' : 'Not eligible'}
          title={isEligible ? 'Eligible for this track' : 'Not eligible'}
          sx={{
            width: 7,
            height: 7,
            borderRadius: 999,
            flexShrink: 0,
            bg: isEligible ? 'success.fg' : 'transparent',
            border: isEligible ? 'none' : '1px solid',
            borderColor: 'border.muted',
          }}
        />
        <RepoIcon size={11} />
        <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <Text
            sx={{
              fontSize: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              ...NOWRAP,
              display: 'block',
              fontWeight: isSelected ? 700 : 600,
              color: 'fg.default',
              lineHeight: 1.2,
            }}
            title={row.repo}
          >
            {row.repo}
          </Text>
          {lastActivityIso && (
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle', lineHeight: 1 }}>
              last {formatRelativeTime(lastActivityIso)}
            </Text>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, pr: '4px' }}>
        <RepoActivitySpark values={daily} mode={mode} periodLabel={periodLabel} />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitMergeIcon size={11} /> : <IssueClosedIcon size={11} />}
          value={primaryCount}
          tone="done"
          title={mode === 'oss'
            ? 'Merged PRs'
            : `Solved issues (closed as completed${row.completedIssue > 0 ? `; ${row.completedIssue} not yet PR-linked` : ''})`}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={<CheckCircleIcon size={11} />}
          value={validCount}
          tone="accent"
          title={mode === 'oss' ? 'Merged PRs with tokenScore ≥ 5' : 'Solved issues counted toward eligibility'}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitPullRequestIcon size={11} /> : <IssueOpenedIcon size={11} />}
          value={mode === 'oss' ? row.openPr : row.openIssue}
          tone="success"
          title={mode === 'oss' ? 'Open PRs' : 'Open issues'}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitPullRequestClosedIcon size={11} /> : <SkipIcon size={11} />}
          value={mode === 'oss' ? row.closedPr : row.closedIssue}
          tone="danger"
          title={mode === 'oss' ? 'Closed (unmerged) PRs' : 'Closed (not-planned) issues'}
        />
      </Box>

      <Box
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px', minWidth: 0, pr: '4px', lineHeight: 1 }}
        title={mode === 'oss' && (row.additions + row.deletions) > 0
          ? `+${row.additions.toLocaleString()} additions · −${row.deletions.toLocaleString()} deletions`
          : 'No code changes'}
      >
        {mode === 'oss' && (row.additions + row.deletions) > 0 ? (
          <>
            <Text sx={{ ...MONO, fontSize: '10px', color: 'success.fg', fontWeight: 600 }}>
              +{formatCompactNum(row.additions)}
            </Text>
            <Text sx={{ ...MONO, fontSize: '10px', color: 'danger.fg', fontWeight: 600 }}>
              −{formatCompactNum(row.deletions)}
            </Text>
          </>
        ) : (
          <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.subtle' }}>—</Text>
        )}
      </Box>

      <NumCell v={credPct != null ? `${credPct}%` : '—'} />

      <NumCell v={share > 0 ? `${Math.round(share * 100)}%` : '—'} />
      <NumCell v={earning > 0 ? formatUsd(earning, { style: 'compact' }) : '—'} tone="success" bold />
      <NumCell v={score > 0 ? score.toFixed(2) : '—'} />
      </Box>
    </Box>
  );
}

function MobileCountStat({
  icon, value, label, tone,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone: 'done' | 'accent' | 'success' | 'danger';
}) {
  const empty = value === 0;
  const colorVar = empty
    ? 'var(--fg-muted)'
    : tone === 'done'    ? 'var(--done-fg)'
    : tone === 'accent'  ? 'var(--accent-fg)'
    : tone === 'success' ? 'var(--success-fg)'
    : 'var(--danger-fg)';
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px', minWidth: 0 }}
         style={{ color: colorVar, opacity: empty ? 0.55 : 1 }}>
      <Box sx={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</Box>
      <Text sx={{ ...MONO, fontSize: '12px', fontWeight: empty ? 400 : 700, lineHeight: 1 }}>
        {value.toLocaleString()}
      </Text>
      <Text sx={{ fontSize: '10px', color: 'fg.subtle', textTransform: 'lowercase' }}>{label}</Text>
    </Box>
  );
}

function NumCell({
  v, tone = 'neutral', bold = false,
}: {
  v: number | string;
  tone?: 'neutral' | 'success' | 'danger' | 'done';
  bold?: boolean;
}) {
  const fg =
    tone === 'success' ? 'success.fg'
    : tone === 'danger'  ? 'danger.fg'
    : tone === 'done'    ? 'done.fg'
    : 'fg.default';
  const empty = v === '—' || v === 0;
  return (
    <Text
      sx={{
        ...MONO,
        fontSize: '11px',
        fontWeight: bold ? 700 : 600,
        textAlign: 'right',
        pr: '4px',
        color: empty ? 'fg.muted' : fg,
      }}
    >
      {typeof v === 'number' ? v.toLocaleString() : v}
    </Text>
  );
}

function formatCompactNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `${Math.round(n / 1000)}K`;
  if (n >= 1_000)     return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function deriveRepoActivityFromIsos(isos: (string | null | undefined)[], days: number): { lastActivityIso: string | null; daily: number[] } {
  const daily = new Array<number>(days).fill(0);
  if (!isos || isos.length === 0) return { lastActivityIso: null, daily };
  const dayMs = 86_400_000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  let lastActivityIso: string | null = null;
  let lastT = 0;
  for (const iso of isos) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    if (t > lastT) { lastT = t; lastActivityIso = iso; }
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((todayMs - d.getTime()) / dayMs);
    if (daysAgo < 0 || daysAgo >= days) continue;
    daily[days - 1 - daysAgo] += 1;
  }
  return { lastActivityIso, daily };
}

function deriveRepoActivity(prs: PrDetail[], days: number): { lastActivityIso: string | null; daily: number[] } {
  return deriveRepoActivityFromIsos(prs.map((p) => p.mergedAt ?? p.prCreatedAt), days);
}

function deriveIssueActivity(discovered: IssueDetail[], solvedByPr: IssueDetail[], days: number): { lastActivityIso: string | null; daily: number[] } {
  const isos = [
    ...discovered.map((i) => i.closedAt ?? i.createdAt),
    ...solvedByPr.map((i) => i.closedAt ?? i.createdAt),
  ];
  return deriveRepoActivityFromIsos(isos, days);
}

function RepoActivitySpark({
  values, height = 22, mode = 'oss', periodLabel,
}: { values: number[]; height?: number; mode?: Mode; periodLabel: string }) {
  const cols = values.length;
  const total = values.reduce((a, b) => a + b, 0);
  const itemLabel = mode === 'oss' ? 'PR' : 'issue';
  const windowLabel = periodLabel.toLowerCase();
  const strokeColor = mode === 'oss' ? 'var(--accent-fg)' : 'var(--done-fg)';

  if (cols === 0 || total === 0) {
    return (
      <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }} title={`No ${itemLabel} activity in the ${windowLabel} window`}>—</Text>
    );
  }

  if (cols < 7) {
    const max = Math.max(...values);
    const title = `${total} ${itemLabel}${total === 1 ? '' : 's'} in the ${windowLabel} window`;
    return (
      <Box
        title={title}
        aria-label={title}
        sx={{
          width: '100%', height, display: 'flex', alignItems: 'flex-end',
          gap: cols <= 2 ? '4px' : '2px', justifyContent: cols === 1 ? 'center' : 'flex-start',
        }}
      >
        {values.map((v, i) => {
          const h = max > 0 ? Math.max(2, Math.round((v / max) * height)) : 2;
          return (
            <Box
              key={i}
              sx={{
                width: cols === 1 ? 8 : `${100 / cols}%`,
                maxWidth: 14,
                height: h,
                borderRadius: '1px',
                opacity: v > 0 ? 0.85 : 0.2,
              }}
              style={{ backgroundColor: strokeColor }}
            />
          );
        })}
      </Box>
    );
  }

  const vbWidth = 100;
  const { last7, trendText } = summarizeTrend(values);
  const title = `${total} ${itemLabel}${total === 1 ? '' : 's'} in the ${windowLabel} window · ${last7} in the last 7d${trendText}`;

  const { linePoints, areaD } = computeSparklinePath(values, { width: vbWidth, height });

  return (
    <Box
      title={title}
      aria-label={title}
      sx={{ width: '100%', height, display: 'block' }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${vbWidth} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'hidden' }}
      >
        <path d={areaD} fill={strokeColor} opacity={0.08} />
        <polyline
          points={linePoints}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.7}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Box>
  );
}
