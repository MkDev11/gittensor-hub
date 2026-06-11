'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Text, Box, Label } from '@primer/react';
import { LawIcon } from '@primer/octicons-react';
import { formatDurationHours } from '@/lib/format';
import type { FairnessSignals, MinerFairnessRow } from '@/lib/api-types';
import { Panel, PanelLoading, PanelError, PanelEmpty } from './MaintainerScorecard';

// ─── Fairness Signals card ────────────────────────────────────────────────────
// Per-miner merge-speed vs the repo baseline. Surfaces miners whose PRs merge
// notably faster than the repo's median — a *signal to investigate*, not a
// verdict of maintainer bias. One compact lane per miner: identity + a speed
// bar (with the baseline marker) + median TTM + delta.

const MAX_ROWS = 8;
const PR_GREEN = '#22c55e';
const ISSUE_INDIGO = '#6366f1';

function formatDelta(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  const pct = Math.round(delta * 100);
  if (pct === 0) return 'on par';
  return pct > 0 ? `${pct}% faster` : `${Math.abs(pct)}% slower`;
}

export function FairnessSignalsCard({ repositoryFullName, mode }: { repositoryFullName: string; mode?: 'pr' | 'issue' }) {
  const slash = repositoryFullName.indexOf('/');
  const owner = slash >= 0 ? repositoryFullName.slice(0, slash) : repositoryFullName;
  const name = slash >= 0 ? repositoryFullName.slice(slash + 1) : '';

  const { data, isLoading, isError } = useQuery<FairnessSignals>({
    queryKey: ['repo-fairness', owner, name, mode ?? 'auto'],
    queryFn: async ({ signal }) => {
      const url = `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/fairness${mode ? `?mode=${mode}` : ''}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<FairnessSignals>;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const [page, setPage] = useState(0);
  // Reset paging when the selected repo changes (the explorer reuses this
  // component instance across repos).
  useEffect(() => { setPage(0); }, [owner, name]);

  if (isLoading) return <PanelLoading />;
  if (isError || !data) return <PanelError message="Failed to load fairness signals." />;

  const total = data.miners.length;
  const totalPages = Math.max(1, Math.ceil(total / MAX_ROWS));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * MAX_ROWS;
  const rows = data.miners.slice(start, start + MAX_ROWS);
  // Shared bar scale over ALL miners (not just this page) so bars + the baseline
  // marker stay comparable as you page. Guard against a degenerate max.
  const maxScale = Math.max(...data.miners.map((m) => m.medianTtmHours), data.repoMedianTtmHours ?? 0, 1);
  const baselinePos = data.repoMedianTtmHours != null ? Math.min(1, data.repoMedianTtmHours / maxScale) : null;
  const fastCount = data.miners.filter((m) => m.fasterThanRepo).length;
  // Issue-discovery repos rank issue-close speed instead of PR-merge speed, and
  // wear the issue (indigo) accent instead of the PR (green) one.
  const issue = data.mode === 'issue';
  const accent = issue ? ISSUE_INDIGO : PR_GREEN;
  const t = issue
    ? { lead: 'Miners whose discovered issues close', noun: 'issues', resolved: 'closed', baseline: 'median close time', empty: 'No completed miner issues yet — no close time to rank.', emptyNoun: 'miner issue', scope: 'issue completions' }
    : { lead: 'Miners merging', noun: 'PRs', resolved: 'merged', baseline: 'median merge time', empty: 'No merged miner PRs yet — no time-to-merge to rank.', emptyNoun: 'miner PR', scope: 'PR merges' };

  return (
    <Panel>
      <Box sx={{ p: 3 }}>
        {/* Header — title + inline baseline, all in the card head */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 3 }}>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
              <Box sx={{ color: 'fg.muted', display: 'inline-flex' }}><LawIcon size={16} /></Box>
              <Text sx={{ fontSize: 2, fontWeight: 600 }}>Fairness Signals</Text>
              <Text sx={{ fontSize: 0, color: 'fg.muted', fontFamily: 'mono' }}>· {t.scope}</Text>
              <Label variant="secondary" sx={{ fontSize: '10px' }}>signals, not verdicts</Label>
            </Box>
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
              {t.lead} faster than this repo&apos;s median — a cue to look closer, not proof of bias.
            </Text>
          </Box>
          {data.resolvedSample > 0 && (
            <Box sx={{ flexShrink: 0, width: ['100%', 'auto'], minWidth: [0, 170], maxWidth: ['none', 240], mt: [1, 0] }}>
              {/* The takeaway: how many miners beat the repo median */}
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: ['flex-start', 'flex-end'], gap: 1 }}>
                <Text sx={{ fontSize: 4, fontWeight: 700, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: fastCount > 0 ? accent : 'fg.default' }}>
                  {fastCount}
                </Text>
                <Text sx={{ fontSize: 1, fontFamily: 'mono', color: 'fg.muted' }}>/ {data.minerCount}</Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted', ml: 1 }}>miners faster</Text>
              </Box>
              {/* Share of miners below the baseline */}
              <Box sx={{ mt: '6px', height: 5, borderRadius: 6, bg: 'border.default', overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${data.minerCount > 0 ? (fastCount / data.minerCount) * 100 : 0}%`, bg: accent, borderRadius: 6 }} />
              </Box>
              <Text sx={{ display: 'block', textAlign: ['left', 'right'], fontSize: '10px', color: 'fg.subtle', fontFamily: 'mono', mt: '6px' }}>
                {formatDurationHours(data.repoMedianTtmHours)} {t.baseline} · {data.resolvedSample} {t.noun}
              </Text>
            </Box>
          )}
        </Box>

        {data.resolvedSample === 0 ? (
          <PanelEmpty title="No ranking yet" message={t.empty} />
        ) : data.miners.length === 0 ? (
          <PanelEmpty title="No miner activity" message={`No ${t.emptyNoun} activity recorded.`} />
        ) : (
          <>
            {/* Axis hint (desktop only — mobile drops the bar to its own row). A
              * single static caption so the labels can't overlap when the marker
              * sits near the left. */}
            <Box sx={{ display: ['none', 'grid'], gridTemplateColumns: '180px 1fr 84px', gap: 2, alignItems: 'center', mb: 1, px: 1 }}>
              <Box />
              <Text sx={{ fontSize: '9px', color: 'fg.subtle', fontFamily: 'mono', whiteSpace: 'nowrap' }}>← faster · ┊ repo median</Text>
              <Box />
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {rows.map((m) => (
                <MinerLane key={m.login} miner={m} maxScale={maxScale} baselinePos={baselinePos} resolvedWord={t.resolved} accent={accent} />
              ))}
            </Box>

            {totalPages > 1 && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'border.muted' }}>
                <Text sx={{ fontSize: '10px', color: 'fg.subtle', fontFamily: 'mono', whiteSpace: 'nowrap' }}>
                  {start + 1}–{Math.min(start + MAX_ROWS, total)} of {total} miners
                </Text>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PageBtn disabled={safePage === 0} onClick={() => setPage(safePage - 1)} label="‹ Prev" />
                  <Text sx={{ fontSize: 0, color: 'fg.muted', fontFamily: 'mono', minWidth: 38, textAlign: 'center' }}>{safePage + 1}/{totalPages}</Text>
                  <PageBtn disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} label="Next ›" />
                </Box>
              </Box>
            )}

            {!data.maintainerFiltered && (
              <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.subtle', mt: 2 }}>
                Maintainer list unavailable — maintainers not excluded.
              </Text>
            )}
          </>
        )}
      </Box>
    </Panel>
  );
}

function PageBtn({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <Box
      as="button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      sx={{
        px: 2, py: '3px', fontSize: 0, fontFamily: 'inherit', borderRadius: 1, whiteSpace: 'nowrap',
        border: '1px solid', borderColor: 'border.default', bg: 'canvas.subtle',
        color: disabled ? 'fg.subtle' : 'fg.default', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        '&:hover': disabled ? {} : { bg: 'canvas.default', borderColor: 'border.muted' },
      }}
    >
      {label}
    </Box>
  );
}

function MinerLane({ miner, maxScale, baselinePos, resolvedWord, accent }: { miner: MinerFairnessRow; maxScale: number; baselinePos: number | null; resolvedWord: string; accent: string }) {
  const fast = miner.fasterThanRepo;
  const barWidth = Math.max(0.015, Math.min(1, miner.medianTtmHours / maxScale)); // min sliver so it's always visible
  const reject = miner.rejectRate != null ? `${Math.round(miner.rejectRate * 100)}% rej` : null;

  return (
    <Box
      sx={{
        display: 'grid',
        // Mobile: identity + value on top, bar full-width below. Desktop: inline.
        gridTemplateColumns: ['1fr auto', '180px 1fr 84px'],
        gridTemplateAreas: ['"id val" "bar bar"', '"id bar val"'],
        columnGap: 2,
        rowGap: '6px',
        alignItems: 'center',
        py: '7px',
        px: 1,
        borderRadius: 2,
        '&:hover': { bg: 'canvas.subtle' },
      }}
    >
      {/* identity */}
      <Box sx={{ gridArea: 'id', display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://github.com/${miner.login}.png?size=40`}
          alt={miner.login}
          loading="lazy"
          style={{ width: 22, height: 22, borderRadius: '50%', border: `1px solid ${fast ? accent : 'var(--border-muted)'}`, flexShrink: 0 }}
        />
        <Box sx={{ minWidth: 0 }}>
          <a href={`https://github.com/${miner.login}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <Text sx={{ display: 'block', fontWeight: 600, fontSize: 1, color: fast ? accent : 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>
              {miner.login}
            </Text>
          </a>
          <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.subtle', fontFamily: 'mono', whiteSpace: 'nowrap' }}>
            {miner.resolved} {resolvedWord}{reject ? ` · ${reject}` : ''}
          </Text>
        </Box>
      </Box>

      {/* speed bar with baseline marker */}
      <Box sx={{ gridArea: 'bar', position: 'relative', height: 10, borderRadius: 6, bg: 'canvas.inset' }}>
        {baselinePos != null && (
          <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${baselinePos * 100}%`, borderRadius: 6, bg: `${accent}1a` }} />
        )}
        <Box
          sx={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${barWidth * 100}%`,
            borderRadius: 6,
            bg: fast ? accent : 'neutral.emphasis',
          }}
        />
        {baselinePos != null && (
          <Box sx={{ position: 'absolute', left: `${baselinePos * 100}%`, top: -2, bottom: -2, width: '2px', ml: '-1px', bg: 'fg.muted' }} title="Repo baseline" />
        )}
      </Box>

      {/* value + delta */}
      <Box sx={{ gridArea: 'val', textAlign: 'right' }}>
        <Text sx={{ display: 'block', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 1, lineHeight: 1.2, color: fast ? accent : 'fg.default' }}>
          {formatDurationHours(miner.medianTtmHours)}
        </Text>
        <Text sx={{ display: 'block', fontFamily: 'mono', fontSize: '10px', color: fast ? accent : 'fg.subtle' }}>
          {formatDelta(miner.deltaVsRepoMedian)}
        </Text>
      </Box>
    </Box>
  );
}
