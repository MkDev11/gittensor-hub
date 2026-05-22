'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import {
  RepoIcon, ZapIcon, TrophyIcon, PulseIcon, ShieldCheckIcon, GitMergeIcon,
  IssueClosedIcon,
} from '@primer/octicons-react';
import { formatUsd } from '@/lib/format';
import { IntensityBar, MONO, LABEL, ELLIPSIS, NOWRAP, blendedCredibility, clampedPct } from '../../components';

export interface PositionSummaryProps {
  loading: boolean;
  usdPerDay: number;
  ossEarningPerDay: number;
  discEarningPerDay: number;
  ossEligible: boolean;
  issueEligible: boolean;
  ossEligibleCount: number;
  discEligibleCount: number;
  uniqueEligibleCount: number;
  totalScore: number;
  issueScore: number;
  baseScore: number;
  lifetimeUsd: number;
  lifetimeTao: number;
  lifetimeAlpha: number;
  cred: number;
  issueCred: number;
  totalMergedPrs?: number;
  totalPrs?: number;
  totalAdditions?: number;
  totalDeletions?: number;
  totalSolvedIssues?: number;
  totalClosedIssues?: number;
  totalOpenIssues?: number;
  heroWindowDays?: number;
}

export function PositionSummary({
  loading, usdPerDay, ossEarningPerDay, discEarningPerDay,
  ossEligibleCount, discEligibleCount, uniqueEligibleCount,
  totalScore, issueScore, baseScore,
  lifetimeUsd, lifetimeTao, lifetimeAlpha,
  cred, issueCred,
  totalMergedPrs, totalPrs, totalAdditions, totalDeletions,
  totalSolvedIssues, totalClosedIssues, totalOpenIssues,
  heroWindowDays,
}: PositionSummaryProps) {
  const winSuffix = heroWindowDays ? ` · ${heroWindowDays}D` : '';
  const monthly = usdPerDay * 30;
  const combinedScore = totalScore + issueScore;
  const blendedCred = blendedCredibility(totalScore, cred, issueScore, issueCred);
  const credPct = clampedPct(blendedCred);

  const lifetimeDisplay = lifetimeUsd > 0
    ? formatUsd(lifetimeUsd, { style: 'compact' })
    : lifetimeTao > 0
      ? `${lifetimeTao.toFixed(2)}τ`
      : '—';

  const totalChanges = (totalAdditions ?? 0) + (totalDeletions ?? 0);
  const totalIssues  = (totalSolvedIssues ?? 0) + (totalClosedIssues ?? 0) + (totalOpenIssues ?? 0);

  const ossPct = (ossEarningPerDay + discEarningPerDay) > 0
    ? (ossEarningPerDay / (ossEarningPerDay + discEarningPerDay)) * 100
    : 0;
  const discPct = 100 - ossPct;

  return (
    <Box
      sx={{
        borderTop: '1px solid',
        borderTopColor: 'border.muted',
        display: 'grid',
        gridTemplateColumns: [
          '1fr 1fr',
          null,
          'repeat(4, 1fr)',
          'repeat(6, 1fr)',
        ],
      }}
    >
      <Tile
        sx={{
          gridColumn: [
            '1 / -1',
            null,
            '1 / -1',
            'span 2',
          ],
        }}
      >
        <TileHeader icon={<ZapIcon size={11} />} label="Earnings / day" tone="success" />
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mt: '6px', flexWrap: 'wrap' }}>
          <Text
            sx={{
              ...MONO,
              fontSize: [3, null, 4],
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              color: usdPerDay > 0 ? 'success.fg' : 'fg.muted',
            }}
          >
            {loading ? '—' : formatUsd(usdPerDay, { style: 'compact' })}
          </Text>
          <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' }}>
            {loading ? '' : usdPerDay > 0 ? `~${formatUsd(monthly, { style: 'compact' })}/mo` : 'not earning'}
          </Text>
        </Box>
        {!loading && usdPerDay > 0 && (
          <Box sx={{ mt: '8px' }}>
            <Box
              aria-label="OSS vs Discovery earnings split"
              sx={{
                width: '100%',
                height: 4,
                borderRadius: 999,
                bg: 'border.muted',
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <Box style={{ width: `${ossPct}%`,  backgroundColor: 'var(--accent-fg)', opacity: 0.9 }} />
              <Box style={{ width: `${discPct}%`, backgroundColor: 'var(--done-fg)',   opacity: 0.9 }} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: '4px', flexWrap: 'wrap' }}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Box sx={{ width: 6, height: 6, borderRadius: 999, bg: 'accent.fg' }} />
                <Text sx={{ ...MONO, fontSize: '10px', fontWeight: 600, color: 'fg.default' }}>
                  OSS {formatUsd(ossEarningPerDay, { style: 'compact' })}
                </Text>
                <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }}>{ossPct.toFixed(0)}%</Text>
              </Box>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Box sx={{ width: 6, height: 6, borderRadius: 999, bg: 'done.fg' }} />
                <Text sx={{ ...MONO, fontSize: '10px', fontWeight: 600, color: 'fg.default' }}>
                  DISC {formatUsd(discEarningPerDay, { style: 'compact' })}
                </Text>
                <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }}>{discPct.toFixed(0)}%</Text>
              </Box>
            </Box>
          </Box>
        )}
        <Box
          sx={{
            mt: '8px',
            pt: '6px',
            borderTop: '1px solid',
            borderTopColor: 'border.muted',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '6px',
          }}
        >
          <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
            <Text sx={{ ...LABEL, color: 'fg.subtle', letterSpacing: 0 }}>Lifetime</Text>
            <Text sx={{ ...MONO, fontSize: 0, fontWeight: 700, color: 'accent.fg' }}>
              {loading ? '—' : lifetimeDisplay}
            </Text>
          </Box>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap' }}>
            {loading ? '' : `${lifetimeTao.toFixed(2)}τ · ${lifetimeAlpha.toFixed(2)}α`}
          </Text>
        </Box>
      </Tile>

      <Tile>
        <TileHeader icon={<TrophyIcon size={11} />} label="Score" />
        <BigNumber value={loading ? '—' : combinedScore > 0 ? combinedScore.toFixed(2) : '0'} />
        <Subs>
          <SubStat label="Base" value={loading ? '—' : baseScore.toFixed(2)} />
          <SubStat label="OSS"  value={loading ? '—' : totalScore.toFixed(2)} accent="oss" />
          <SubStat label="DISC" value={loading ? '—' : issueScore.toFixed(2)} accent="disc" />
        </Subs>
      </Tile>

      <Tile>
        <TileHeader icon={<ShieldCheckIcon size={11} />} label={`Credibility${winSuffix}`} />
        <BigNumber
          value={loading ? '—' : combinedScore > 0 || cred + issueCred > 0 ? `${credPct}%` : '—'}
          color={credPct >= 80 ? 'success.fg' : credPct >= 50 ? 'fg.default' : credPct > 0 ? 'danger.fg' : 'fg.muted'}
        />
        {!loading && (cred + issueCred) > 0 && (
          <Box sx={{ mt: '4px' }}>
            <IntensityBar
              value={Math.max(0, Math.min(1, blendedCred))}
              height={3}
              tone={credPct >= 80 ? 'success' : credPct >= 50 ? 'neutral' : 'danger'}
            />
          </Box>
        )}
        <Subs>
          <SubStat label="OSS"  value={loading ? '—' : `${Math.round(cred * 100)}%`} accent="oss" />
          <SubStat label="DISC" value={loading ? '—' : `${Math.round(issueCred * 100)}%`} accent="disc" />
        </Subs>
      </Tile>

      <Tile>
        <TileHeader icon={<PulseIcon size={11} />} label={`Activity${winSuffix}`} />
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '10px', mt: '6px', flexWrap: 'wrap' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}
               title="Merged pull requests (lifetime)">
            <Box sx={{ color: 'accent.fg', display: 'inline-flex' }}><GitMergeIcon size={12} /></Box>
            <Text sx={{ ...MONO, fontSize: [2, null, 3], fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              {loading ? '—' : (totalMergedPrs ?? 0).toLocaleString()}
            </Text>
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}
               title="Solved issues — verified by a linked merged PR">
            <Box sx={{ color: 'done.fg', display: 'inline-flex' }}><IssueClosedIcon size={11} /></Box>
            <Text sx={{ ...MONO, fontSize: [2, null, 3], fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              {loading ? '—' : (totalSolvedIssues ?? 0).toLocaleString()}
            </Text>
          </Box>
        </Box>
        <Subs>
          <SubStat label="PRs"    value={loading ? '—' : (totalPrs ?? 0).toLocaleString()} accent="oss" />
          <SubStat label="Issues" value={loading ? '—' : totalIssues.toLocaleString()} accent="disc" />
          {totalChanges > 0 ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}
                 title={`+${(totalAdditions ?? 0).toLocaleString()} additions · −${(totalDeletions ?? 0).toLocaleString()} deletions`}>
              <Text sx={{ ...LABEL, fontSize: '10px', color: 'fg.subtle', letterSpacing: 0 }}>Lines</Text>
              <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}>
                <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 600, color: 'success.fg' }}>
                  +{formatCompact(totalAdditions ?? 0)}
                </Text>
                <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 600, color: 'danger.fg' }}>
                  −{formatCompact(totalDeletions ?? 0)}
                </Text>
              </Box>
            </Box>
          ) : (
            <SubStat label="Lines" value="—" />
          )}
        </Subs>
      </Tile>

      <Tile last>
        <TileHeader icon={<RepoIcon size={11} />} label="Eligible repos" />
        <BigNumber value={loading ? '—' : `${uniqueEligibleCount}`} />
        <Subs>
          <SubStat label="OSS"  value={loading ? '—' : ossEligibleCount.toLocaleString()} accent="oss" />
          <SubStat label="DISC" value={loading ? '—' : discEligibleCount.toLocaleString()} accent="disc" />
        </Subs>
      </Tile>
    </Box>
  );
}

function Tile({
  children,
  last = false,
  sx,
}: {
  children: React.ReactNode;
  last?: boolean;
  sx?: Record<string, unknown>;
}) {
  return (
    <Box
      sx={{
        p: ['10px', null, '12px'],
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: ['none', null, last ? 'none' : '1px solid', last ? 'none' : '1px solid'],
        borderRightColor: 'border.muted',
        borderTop: ['1px solid', null, '1px solid', 'none'],
        borderTopColor: 'border.muted',
        '&:nth-of-type(1)': {
          borderTop: 'none',
          borderRight: ['none', null, 'none', '1px solid'],
        },
        '&:nth-of-type(2n)': {
          borderRight: ['1px solid', null, last ? 'none' : '1px solid', last ? 'none' : '1px solid'],
        },
        ...(sx ?? {}),
      }}
    >
      {children}
    </Box>
  );
}

function TileHeader({ icon, label, tone = 'muted' }: { icon: React.ReactNode; label: string; tone?: 'muted' | 'success' }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
      <Box sx={{ color: tone === 'success' ? 'success.fg' : 'fg.muted', display: 'inline-flex' }}>{icon}</Box>
      <Text sx={{ ...LABEL, color: 'fg.muted', ...ELLIPSIS, }}>
        {label}
      </Text>
    </Box>
  );
}

function BigNumber({ value, color = 'fg.default' }: { value: string; color?: string }) {
  return (
    <Text
      sx={{
        ...MONO,
        fontSize: [2, null, 3],
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1.1,
        color,
        mt: '6px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...NOWRAP,
      }}
    >
      {value}
    </Text>
  );
}

function Subs({ children }: { children: React.ReactNode }) {
  return <Box sx={{ mt: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>{children}</Box>;
}

function SubStat({ label, value, accent }: { label: string; value: string; accent?: 'oss' | 'disc' }) {
  const dotColor = accent === 'oss' ? 'accent.fg' : accent === 'disc' ? 'done.fg' : null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px', minWidth: 0 }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
        {dotColor && <Box sx={{ width: 5, height: 5, borderRadius: 999, bg: dotColor, flexShrink: 0 }} />}
        <Text sx={{ ...LABEL, fontSize: '10px', color: 'fg.subtle', letterSpacing: 0 }}>{label}</Text>
      </Box>
      <Text
        sx={{
          ...MONO,
          fontSize: '11px',
          fontWeight: 600,
          color: value === '—' ? 'fg.subtle' : 'fg.default',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          ...NOWRAP,
        }}
      >
        {value}
      </Text>
    </Box>
  );
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `${Math.round(n / 1000)}K`;
  if (n >= 1_000)     return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}
