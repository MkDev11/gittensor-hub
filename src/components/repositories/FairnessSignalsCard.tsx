'use client';

import React from 'react';
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
const FAST = '#22c55e';

function formatDelta(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  const pct = Math.round(delta * 100);
  if (pct === 0) return 'on par';
  return pct > 0 ? `${pct}% faster` : `${Math.abs(pct)}% slower`;
}

export function FairnessSignalsCard({ repositoryFullName }: { repositoryFullName: string }) {
  const slash = repositoryFullName.indexOf('/');
  const owner = slash >= 0 ? repositoryFullName.slice(0, slash) : repositoryFullName;
  const name = slash >= 0 ? repositoryFullName.slice(slash + 1) : '';

  const { data, isLoading, isError } = useQuery<FairnessSignals>({
    queryKey: ['repo-fairness', owner, name],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/fairness`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<FairnessSignals>;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <PanelLoading />;
  if (isError || !data) return <PanelError message="Failed to load fairness signals." />;

  const rows = data.miners.slice(0, MAX_ROWS);
  // Shared bar scale: the slowest shown TTM (or the baseline, whichever's larger)
  // fills the bar, so every lane reads on one axis and the baseline marker lands
  // consistently. Guard against a degenerate max.
  const maxScale = Math.max(...rows.map((m) => m.medianTtmHours), data.repoMedianTtmHours ?? 0, 1);
  const baselinePos = data.repoMedianTtmHours != null ? Math.min(1, data.repoMedianTtmHours / maxScale) : null;
  const fastCount = data.miners.filter((m) => m.fasterThanRepo).length;

  return (
    <Panel>
      <Box sx={{ p: 3 }}>
        {/* Header — title + inline baseline, all in the card head */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 3 }}>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
              <Box sx={{ color: 'fg.muted', display: 'inline-flex' }}><LawIcon size={16} /></Box>
              <Text sx={{ fontSize: 2, fontWeight: 600 }}>Fairness Signals</Text>
              <Label variant="secondary" sx={{ fontSize: '10px' }}>signals, not verdicts</Label>
            </Box>
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
              Miners merging faster than this repo&apos;s median — a cue to look closer, not proof of bias.
            </Text>
          </Box>
          {data.mergedSample > 0 && (
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Text sx={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'fg.subtle' }}>repo median TTM</Text>
              <Text sx={{ fontSize: 3, fontWeight: 700, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: 'fg.default' }}>
                {formatDurationHours(data.repoMedianTtmHours)}
              </Text>
              <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.subtle', fontFamily: 'mono' }}>
                {data.mergedSample} PRs · {data.minerCount} miners{fastCount > 0 ? ` · ${fastCount} faster` : ''}
              </Text>
            </Box>
          )}
        </Box>

        {data.mergedSample === 0 ? (
          <PanelEmpty title="No ranking yet" message="No merged miner PRs yet — no time-to-merge to rank." />
        ) : data.miners.length === 0 ? (
          <PanelEmpty title="No miner activity" message="No miner PR activity recorded." />
        ) : (
          <>
            {/* Axis hint: faster ◀ ┆ baseline */}
            <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '180px 1fr 84px'], gap: 2, alignItems: 'center', mb: 1, px: 1 }}>
              <Box />
              <Box sx={{ display: ['none', 'block'], position: 'relative', fontSize: '9px', color: 'fg.subtle', height: 12 }}>
                <Text sx={{ position: 'absolute', left: 0 }}>← faster</Text>
                {baselinePos != null && (
                  <Text sx={{ position: 'absolute', left: `${baselinePos * 100}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>repo median</Text>
                )}
              </Box>
              <Box />
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {rows.map((m) => (
                <MinerLane key={m.login} miner={m} maxScale={maxScale} baselinePos={baselinePos} />
              ))}
            </Box>

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

function MinerLane({ miner, maxScale, baselinePos }: { miner: MinerFairnessRow; maxScale: number; baselinePos: number | null }) {
  const fast = miner.fasterThanRepo;
  const barWidth = Math.max(0.015, Math.min(1, miner.medianTtmHours / maxScale)); // min sliver so it's always visible
  const reject = miner.rejectRate != null ? `${Math.round(miner.rejectRate * 100)}% rej` : null;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['1fr', '180px 1fr 84px'],
        gap: 2,
        alignItems: 'center',
        py: '7px',
        px: 1,
        borderRadius: 2,
        '&:hover': { bg: 'canvas.subtle' },
      }}
    >
      {/* identity */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://github.com/${miner.login}.png?size=40`}
          alt={miner.login}
          loading="lazy"
          style={{ width: 22, height: 22, borderRadius: '50%', border: `1px solid ${fast ? FAST : 'var(--border-muted)'}`, flexShrink: 0 }}
        />
        <Box sx={{ minWidth: 0 }}>
          <a href={`https://github.com/${miner.login}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <Text sx={{ display: 'block', fontWeight: 600, fontSize: 1, color: fast ? FAST : 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>
              {miner.login}
            </Text>
          </a>
          <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.subtle', fontFamily: 'mono', whiteSpace: 'nowrap' }}>
            {miner.mergedPrs} merged{reject ? ` · ${reject}` : ''}
          </Text>
        </Box>
      </Box>

      {/* speed bar with baseline marker */}
      <Box sx={{ position: 'relative', height: 10, borderRadius: 6, bg: 'canvas.inset', display: ['none', 'block'] }}>
        {baselinePos != null && (
          <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${baselinePos * 100}%`, borderRadius: 6, bg: 'rgba(34,197,94,0.10)' }} />
        )}
        <Box
          sx={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${barWidth * 100}%`,
            borderRadius: 6,
            bg: fast ? FAST : 'neutral.emphasis',
          }}
        />
        {baselinePos != null && (
          <Box sx={{ position: 'absolute', left: `${baselinePos * 100}%`, top: -2, bottom: -2, width: '2px', ml: '-1px', bg: 'fg.muted' }} title="Repo baseline" />
        )}
      </Box>

      {/* value + delta */}
      <Box sx={{ textAlign: 'right' }}>
        <Text sx={{ display: 'block', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 1, lineHeight: 1.2, color: fast ? FAST : 'fg.default' }}>
          {formatDurationHours(miner.medianTtmHours)}
        </Text>
        <Text sx={{ display: 'block', fontFamily: 'mono', fontSize: '10px', color: fast ? FAST : 'fg.subtle' }}>
          {formatDelta(miner.deltaVsRepoMedian)}
        </Text>
      </Box>
    </Box>
  );
}
