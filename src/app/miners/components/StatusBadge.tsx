'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import type { Miner } from './types';
import { validMergedCount } from './helpers';
import { NOWRAP } from './tokens';

export type MinerStatusKind = 'hot' | 'climbing' | 'dormant' | 'specialist' | 'dual' | 'none';

export interface MinerStatus {
  kind: MinerStatusKind;
  icon: string;
  label: string;
  hint: string;
}

export const STATUS_REGISTRY: Record<Exclude<MinerStatusKind, 'none'>, Omit<MinerStatus, 'kind'>> = {
  hot:        { icon: '🔥', label: 'Hot',        hint: '≥3 PRs in the last 3 days' },
  climbing:   { icon: '📈', label: 'Climbing',   hint: 'Up ≥3 ranks vs yesterday' },
  dormant:    { icon: '💤', label: 'Dormant',    hint: 'No PR activity in the last 14 days' },
  specialist: { icon: '🎯', label: 'Specialist', hint: '≤2 unique repos with ≥5 merged PRs' },
  dual:       { icon: '⚖️', label: 'Dual',       hint: 'Eligible in both OSS and Discovery' },
};

export const STATUS_NONE: MinerStatus = { kind: 'none', icon: '', label: '', hint: '' };

export function makeStatus(kind: Exclude<MinerStatusKind, 'none'>): MinerStatus {
  return { kind, ...STATUS_REGISTRY[kind] };
}

export function deriveMinerStatus(miner: Miner, currentRank: number): MinerStatus {
  const daily = miner.dailyLookback ?? [];
  const recent3 = daily.slice(-3).reduce((a, b) => a + b, 0);
  const recent14 = daily.slice(-14).reduce((a, b) => a + b, 0);
  const merged = validMergedCount(miner);
  const uniqueRepos = miner.uniqueReposCount ?? 0;
  const prevRank = miner.previousRank ?? null;
  const climbedBy = prevRank != null ? prevRank - currentRank : 0;

  if (recent3 >= 3) return makeStatus('hot');
  if (climbedBy >= 3) return makeStatus('climbing');
  if (recent14 === 0) return makeStatus('dormant');
  if (uniqueRepos > 0 && uniqueRepos <= 2 && merged >= 5) {
    return makeStatus('specialist');
  }
  if (miner.isEligible && miner.isIssueEligible) {
    return makeStatus('dual');
  }
  return STATUS_NONE;
}

export const STATUS_TONE: Record<MinerStatusKind, { fg: string; bg: string }> = {
  hot:        { fg: 'var(--danger-fg)',    bg: 'var(--danger-subtle)' },
  climbing:   { fg: 'var(--accent-fg)',    bg: 'var(--accent-subtle)' },
  dormant:    { fg: 'var(--fg-muted)',     bg: 'var(--canvas-inset)' },
  specialist: { fg: 'var(--attention-fg)', bg: 'var(--attention-subtle)' },
  dual:       { fg: 'var(--done-fg)',      bg: 'var(--done-subtle)' },
  none:       { fg: 'var(--fg-muted)',     bg: 'transparent' },
};

export function StatusBadge({ status }: { status: MinerStatus }) {
  if (status.kind === 'none') return null;
  const tone = STATUS_TONE[status.kind];
  return (
    <Box
      title={status.hint}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '6px',
        py: '1px',
        borderRadius: 999,
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.2px',
        lineHeight: 1,
        ...NOWRAP,
        flexShrink: 0,
      }}
      style={{ color: tone.fg, backgroundColor: tone.bg }}
    >
      <Text as="span" aria-hidden sx={{ fontSize: '10px', lineHeight: 1 }}>{status.icon}</Text>
      <Text as="span">{status.label}</Text>
    </Box>
  );
}
