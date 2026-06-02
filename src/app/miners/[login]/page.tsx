'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageLayout, Heading, Text, Box, Label } from '@primer/react';
import {
  ArrowLeftIcon,
  LinkExternalIcon,
  StarIcon,
  StarFillIcon,
} from '@primer/octicons-react';
import Spinner from '@/components/Spinner';
import { formatUsd, formatUsdMonthly, formatTao, formatNumber } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';
import { useTrackedMiners } from '@/lib/tracked-miners';
import type { Miner, MinersResponse } from '@/types/entities';

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export default function MinerDetailPage() {
  const params = useParams<{ login: string }>();
  const login = params?.login ?? '';
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();

  const { data, isLoading, isError } = useQuery<MinersResponse>({
    queryKey: ['miners'],
    queryFn: async () => {
      const r = await fetch('/api/miners');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const miner = useMemo<Miner | undefined>(() => {
    if (!data?.miners) return undefined;
    const key = login.toLowerCase();
    return data.miners.find((m) => m.githubUsername.toLowerCase() === key);
  }, [data, login]);

  return (
    <PageLayout containerWidth="medium" padding="normal">
      <PageLayout.Header>
        <Link href="/miners" style={{ textDecoration: 'none' }}>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              color: 'fg.muted',
              fontSize: 1,
              '&:hover': { color: 'accent.fg' },
            }}
          >
            <ArrowLeftIcon size={14} />
            <Text>All miners</Text>
          </Box>
        </Link>
      </PageLayout.Header>
      <PageLayout.Content>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <Spinner />
          </Box>
        )}
        {!isLoading && (isError || !miner) && (
          <Box sx={{ textAlign: 'center', py: 6, color: 'fg.muted' }}>
            <Heading sx={{ fontSize: 3, mb: 2, color: 'fg.default' }}>Miner not found</Heading>
            <Text sx={{ fontSize: 1 }}>
              No SN74 miner matches{' '}
              <Text sx={{ fontFamily: 'mono', color: 'fg.default' }}>{login}</Text>.
            </Text>
          </Box>
        )}
        {!isLoading && miner && (
          <MinerProfile
            miner={miner}
            isMe={me.length > 0 && miner.githubUsername.toLowerCase() === me.toLowerCase()}
            isTracked={tracked.has(miner.id)}
            onToggle={() => toggle(miner.id)}
          />
        )}
      </PageLayout.Content>
    </PageLayout>
  );
}

function MinerProfile({
  miner,
  isMe,
  isTracked,
  onToggle,
}: {
  miner: Miner;
  isMe: boolean;
  isTracked: boolean;
  onToggle: () => void;
}) {
  const usd = num(miner.usdPerDay);
  const eligible = miner.isIssueEligible ?? miner.isEligible;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 3,
          border: '1px solid',
          borderColor: isMe ? 'accent.emphasis' : 'border.default',
          borderRadius: 2,
          bg: 'canvas.subtle',
          p: 3,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://github.com/${miner.githubUsername}.png?size=128`}
          alt={miner.githubUsername}
          loading="lazy"
          style={{ width: 64, height: 64, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Heading sx={{ fontSize: 4, fontWeight: 700, color: 'fg.default' }}>
              {miner.githubUsername}
            </Heading>
            {isMe && <Label variant="accent">you</Label>}
            <Box
              as="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                px: 2,
                height: 20,
                borderRadius: 10,
                fontSize: '10px',
                fontWeight: 600,
                bg: eligible ? 'success.subtle' : 'neutral.subtle',
                color: eligible ? 'success.fg' : 'fg.muted',
              }}
            >
              {eligible ? 'ELIGIBLE' : 'INELIGIBLE'}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mt: 1, color: 'fg.muted', fontSize: 1, flexWrap: 'wrap' }}>
            <Text>UID {miner.uid}</Text>
            <a
              href={`https://github.com/${miner.githubUsername}`}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-fg)', textDecoration: 'none' }}
            >
              GitHub <LinkExternalIcon size={12} />
            </a>
          </Box>
          {miner.hotkey && (
            <Text
              sx={{ display: 'block', mt: 1, fontFamily: 'mono', fontSize: 0, color: 'fg.subtle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={miner.hotkey}
            >
              {miner.hotkey}
            </Text>
          )}
          {!eligible && miner.failedReason && (
            <Text sx={{ display: 'block', mt: 1, fontSize: 0, color: 'attention.fg' }}>
              {miner.failedReason}
            </Text>
          )}
        </Box>
        <Box
          as="button"
          onClick={onToggle}
          aria-label={isTracked ? 'Untrack miner' : 'Track miner'}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            bg: 'transparent',
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            color: isTracked ? 'attention.fg' : 'fg.muted',
            cursor: 'pointer',
            '&:hover': { bg: 'canvas.inset', color: 'attention.fg' },
          }}
        >
          {isTracked ? <StarFillIcon size={16} /> : <StarIcon size={16} />}
        </Box>
      </Box>

      {/* Earnings */}
      <Section title="Earnings">
        <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'repeat(3, 1fr)'], gap: 3 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
              <Text sx={{ fontSize: 6, fontWeight: 700, color: 'success.fg', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums' }}>
                {formatUsd(usd)}
              </Text>
              <Text sx={{ color: 'fg.muted', fontSize: 1 }}>/day</Text>
            </Box>
            <Text sx={{ fontSize: 0, color: 'fg.muted', fontFamily: 'mono' }}>{formatUsdMonthly(usd)}</Text>
          </Box>
          <Stat label="TAO / DAY" value={formatTao(num(miner.taoPerDay))} />
          <Stat label="ALPHA / DAY" value={num(miner.alphaPerDay).toFixed(4)} />
        </Box>
      </Section>

      {/* Scores */}
      <Section title="Scores">
        <StatGrid>
          <Stat label="TOTAL SCORE" value={num(miner.totalScore).toFixed(2)} />
          <Stat label="BASE SCORE" value={num(miner.baseTotalScore).toFixed(2)} />
          <Stat label="ISSUE DISCOVERY" value={num(miner.issueDiscoveryScore).toFixed(2)} />
          <Stat label="ISSUE TOKEN" value={num(miner.issueTokenScore).toFixed(2)} />
          <Stat label="CREDIBILITY" value={num(miner.credibility).toFixed(2)} />
          <Stat label="ISSUE CREDIBILITY" value={num(miner.issueCredibility).toFixed(2)} />
        </StatGrid>
      </Section>

      {/* Pull requests */}
      <Section title="Pull requests">
        <StatGrid>
          <Stat label="MERGED" value={miner.totalMergedPrs ?? 0} color="var(--success-fg)" />
          <Stat label="OPEN" value={miner.totalOpenPrs ?? 0} />
          <Stat label="CLOSED" value={miner.totalClosedPrs ?? 0} color="var(--danger-fg)" />
          <Stat label="TOTAL" value={miner.totalPrs ?? 0} />
        </StatGrid>
      </Section>

      {/* Issues */}
      <Section title="Issue discovery">
        <StatGrid>
          <Stat label="SOLVED" value={miner.totalSolvedIssues ?? 0} color="var(--success-fg)" />
          <Stat label="VALID SOLVED" value={miner.totalValidSolvedIssues ?? 0} />
          <Stat label="OPEN" value={miner.totalOpenIssues ?? 0} />
          <Stat label="CLOSED" value={miner.totalClosedIssues ?? 0} color="var(--danger-fg)" />
        </StatGrid>
      </Section>

      {/* Code & repos */}
      <Section title="Code & repositories">
        <StatGrid>
          <Stat label="UNIQUE REPOS" value={miner.uniqueReposCount ?? 0} />
          <Stat label="ADDITIONS" value={formatNumber(miner.totalAdditions ?? 0)} color="var(--success-fg)" />
          <Stat label="DELETIONS" value={formatNumber(miner.totalDeletions ?? 0)} color="var(--danger-fg)" />
        </StatGrid>
      </Section>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Heading
        sx={{ fontSize: 1, fontWeight: 600, color: 'fg.muted', letterSpacing: '0.5px', textTransform: 'uppercase', mb: 2 }}
      >
        {title}
      </Heading>
      {children}
    </Box>
  );
}

function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['repeat(2, 1fr)', null, 'repeat(4, 1fr)'],
        gap: 2,
      }}
    >
      {children}
    </Box>
  );
}

function Stat({
  label,
  value,
  color = 'var(--fg-default)',
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.muted', borderRadius: 2, bg: 'canvas.subtle', p: 2 }}>
      <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.muted', letterSpacing: '0.5px', fontWeight: 600 }}>
        {label}
      </Text>
      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color, fontSize: 3 }}>
        {value}
      </Text>
    </Box>
  );
}
