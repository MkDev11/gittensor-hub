'use client';

import React from 'react';
import { Heading, Text, Box, Label } from '@primer/react';
import { SkeletonBar } from '@/components/Skeleton';
import { useQuery } from '@tanstack/react-query';
import { formatRelativeTime, formatDurationHours, formatDurationDays } from '@/lib/format';
import {
  headlineReviewSpeed,
  headlineIssueResponse,
  headlineDecisionSpeed,
  reviewSpeedVerdict,
  issueResponseVerdict,
  reviewSpeedGaugePos,
  REVIEW_SPEED_GAUGE_TICKS,
  type MaintainerStats,
} from '@/lib/api-types';
import { maintainerStatsQuery } from '@/app/repositories/_lib/maintainer-stats-query';

// ─── Maintainer scorecard ─────────────────────────────────────────────────────
// Dense one-card layout: header + verdict, a KPI tile grid (every figure at a
// glance), and a slim log-scale speed gauge. Shared by the repo-detail page and
// the explorer Repository tab. The generic Panel chrome lives here too (the page
// imports it back rather than duplicating).

const PR_GREEN = '#22c55e';
const ISSUE_INDIGO = '#6366f1';

function pct(value: number | null | undefined, fallback = '—'): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return `${Math.round(value * 100)}%`;
}

function ageTone(days: number | null, warn = 14, bad = 30): string {
  if (days == null) return 'fg.default';
  if (days <= warn) return 'success.fg';
  if (days <= bad) return 'attention.fg';
  return 'danger.fg';
}

export function MaintainerScorecard({ owner, name }: { owner: string; name: string }) {
  const { data, isLoading, isError } = useQuery<MaintainerStats>({
    ...maintainerStatsQuery(owner, name),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <PanelLoading />;
  if (isError || !data) return <PanelError message="Failed to load maintainer stats." />;
  if (!data.hasData) {
    return (
      <PanelEmpty
        title="No miner activity cached yet"
        message="No registered gittensor miner has an open or merged PR (or a discovered issue) cached for this repository yet."
      />
    );
  }

  const tp = data.throughput, bl = data.backlog, rp = data.responsiveness;
  const decHead = headlineDecisionSpeed(data);
  const hasPr = data.issueDiscoveryShare < 1;
  const hasIssue = data.issueDiscoveryShare > 0;

  // Primary speed metric drives the headline verdict + the slim gauge.
  const prHead = headlineReviewSpeed(data);
  const issueHead = headlineIssueResponse(data);
  const primary = hasPr
    ? { head: prHead, verdict: reviewSpeedVerdict(prHead.hours), color: PR_GREEN, label: 'Review speed', noun: 'miner PRs', verb: 'merged' }
    : { head: issueHead, verdict: issueResponseVerdict(issueHead.hours), color: ISSUE_INDIGO, label: 'Issue response', noun: 'miner issues', verb: 'solved' };

  const kpis: React.ReactNode[] = [];
  kpis.push(<Kpi key="primary" value={formatDurationHours(primary.head.hours)} label={primary.label} sub={primary.verdict.label} color={primary.verdict.color} />);
  if (hasPr) {
    kpis.push(<Kpi key="dec" value={formatDurationHours(decHead.hours)} label="Decision time" sub="merge or close" />);
    kpis.push(<Kpi key="mr" value={pct(tp.mergeRate)} label="Merge rate" sub="of resolved" color={PR_GREEN} />);
    if (tp.minerMergeShare != null) kpis.push(<Kpi key="ms" value={pct(tp.minerMergeShare)} label="Miner share" sub="of merges" color={PR_GREEN} />);
    kpis.push(<Kpi key="op" value={bl.openPrs.toLocaleString()} label="Open PRs" sub={<Text sx={{ color: bl.stalePrs > 0 ? 'danger.fg' : 'fg.subtle' }}>{bl.stalePrs} stale</Text>} />);
    kpis.push(<Kpi key="age" value={<Text sx={{ color: ageTone(bl.medianOpenPrAgeDays) }}>{formatDurationDays(bl.medianOpenPrAgeDays)}</Text>} label="Median age" sub={`oldest ${formatDurationDays(bl.oldestOpenPrDays)}`} />);
  }
  if (hasIssue) {
    if (hasPr) kpis.push(<Kpi key="ir" value={formatDurationHours(issueHead.hours)} label="Issue response" sub={issueResponseVerdict(issueHead.hours).label} color={ISSUE_INDIGO} />);
    kpis.push(<Kpi key="comp" value={pct(rp.completionRate)} label="Completion" sub="solved of all" color={ISSUE_INDIGO} />);
    kpis.push(<Kpi key="done" value={rp.completedIssues.toLocaleString()} label="Completed" sub={`${rp.closedIssues} closed`} />);
    kpis.push(<Kpi key="oi" value={bl.openIssues.toLocaleString()} label="Open issues" />);
  }

  const scopeLabel = primary.head.scope === 'window' ? `last ${primary.head.windowDays} days` : 'all-time';

  return (
    <Panel>
      <Box sx={{ p: 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 3 }}>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
              <Text sx={{ fontSize: 2, fontWeight: 600 }}>Maintainer Performance</Text>
              {data.issueDiscoveryEnabled && <Label variant="accent" sx={{ fontSize: '10px' }}>issue discovery · {Math.round(data.issueDiscoveryShare * 100)}%</Label>}
              {!data.minerFiltered && <Label variant="attention" sx={{ fontSize: '10px' }}>all contributors</Label>}
            </Box>
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
              How responsive maintainers are to registered gittensor miners&apos; work.
            </Text>
          </Box>
          <Box
            as="span"
            sx={{
              px: 2, py: '3px', borderRadius: 6, fontSize: 0, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.04em', border: '1px solid', whiteSpace: 'nowrap', flexShrink: 0,
              color: primary.verdict.color, bg: `${primary.verdict.color}1a`, borderColor: `${primary.verdict.color}44`,
            }}
          >
            {primary.verdict.label}
          </Box>
        </Box>

        {/* KPI tiles */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 2 }}>
          {kpis}
        </Box>

        {/* Slim log-scale speed gauge */}
        <SlimGauge head={primary.head} barColor={primary.color} />

        <Text sx={{ display: 'block', fontFamily: 'mono', fontSize: 0, color: 'fg.muted', mt: 2 }}>
          {primary.head.sampleSize.toLocaleString()} {primary.noun} · {scopeLabel}
          {primary.head.p90Hours != null ? ` · most ${primary.verb} in ${formatDurationHours(primary.head.p90Hours)} or less` : ''}
          {hasPr ? ` · ${tp.mergedPrsTotal.toLocaleString()} merged all-time` : ''}
          {' · updated '}{formatRelativeTime(data.generatedAt)}
        </Text>
      </Box>
    </Panel>
  );
}

function Kpi({ value, label, sub, color }: { value: React.ReactNode; label: string; sub?: React.ReactNode; color?: string }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.muted', borderRadius: 2, px: '10px', py: '8px', minWidth: 0, bg: 'canvas.subtle' }}>
      <Text sx={{ display: 'block', fontSize: 3, fontWeight: 700, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: color ?? 'fg.default', whiteSpace: 'nowrap' }}>
        {value}
      </Text>
      <Text sx={{ display: 'block', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'fg.muted', mt: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </Text>
      {sub != null && (
        <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</Text>
      )}
    </Box>
  );
}

interface GaugeHead {
  hours: number | null;
  p90Hours: number | null;
  sampleSize: number;
  scope: 'window' | 'all-time';
  windowDays: number;
}

/** Slim log-scale gauge (30m → 30d) with median dot, p90 tail, and tick labels.
 *  Same scale/colours as the /repositories drawer via the shared api-types helpers. */
function SlimGauge({ head, barColor }: { head: GaugeHead; barColor: string }) {
  const posMed = reviewSpeedGaugePos(head.hours);
  const posP90 = reviewSpeedGaugePos(head.p90Hours);
  if (posMed == null) return null;
  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ position: 'relative', height: '6px', borderRadius: 6, bg: 'border.default' }}>
        <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${posMed * 100}%`, borderRadius: 6, bg: barColor }} />
        {posP90 != null && posP90 > posMed && (
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${posMed * 100}%`, width: `${(posP90 - posMed) * 100}%`, borderRadius: 6, bg: `${barColor}22` }} />
        )}
        <Box sx={{ position: 'absolute', left: `${posMed * 100}%`, top: '-3px', width: '12px', height: '12px', ml: '-6px', borderRadius: '50%', bg: barColor, border: '2px solid', borderColor: 'canvas.default' }} />
        {posP90 != null && posP90 > posMed && (
          <Box sx={{ position: 'absolute', left: `${posP90 * 100}%`, top: '-1px', width: '2px', height: '8px', ml: '-1px', bg: `${barColor}aa` }} />
        )}
      </Box>
      <Box sx={{ position: 'relative', height: '12px', mt: '2px' }}>
        {REVIEW_SPEED_GAUGE_TICKS.map((t) => (
          <Text key={t.label} sx={{ position: 'absolute', left: `${(reviewSpeedGaugePos(t.hours) ?? 0) * 100}%`, transform: 'translateX(-50%)', fontSize: '9px', color: 'fg.subtle', fontFamily: 'mono' }}>
            {t.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// ─── Generic panel chrome (shared with the repo-detail page) ──────────────────

export function CountBox({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 2 }}>
      <Text sx={{ display: 'block', fontSize: 4, fontWeight: 700, color: 'fg.default', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums' }}>
        {value.toLocaleString()}
      </Text>
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>{label}</Text>
      {hint && <Text sx={{ display: 'block', fontSize: 0, color: 'fg.subtle' }}>{hint}</Text>}
    </Box>
  );
}

export function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', overflowX: 'auto', overflowY: 'hidden' }}>
      {children}
    </Box>
  );
}

export function PanelLoading() {
  return (
    <Panel>
      <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 3, opacity: Math.max(0.25, 1 - i * 0.09) }}>
            <SkeletonBar width={i % 3 === 0 ? 14 : 12} height={i % 3 === 0 ? 14 : 12} rounded={i % 3 === 0 ? 999 : 6} />
            <SkeletonBar flex={1} height={10} />
            {i % 2 === 0 && <SkeletonBar width={60} height={10} />}
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

export function PanelError({ message }: { message: string }) {
  return (
    <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2 }}>
      <Text sx={{ color: 'danger.fg' }}>{message}</Text>
    </Box>
  );
}

export function PanelEmpty({ title, message }: { title: string; message: string }) {
  return (
    <Panel>
      <Box sx={{ p: 5, textAlign: 'center' }}>
        <Heading sx={{ fontSize: 3, mb: 1 }}>{title}</Heading>
        <Text sx={{ color: 'fg.muted' }}>{message}</Text>
      </Box>
    </Panel>
  );
}
