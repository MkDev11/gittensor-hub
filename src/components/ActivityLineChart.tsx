'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from '@primer/react';

function fmtCount(value: number): string {
  return Math.round(value).toLocaleString();
}

// Decay-weighted scores are small fractional values — show 2 decimals (e.g. 3.02).
function fmtScore(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type ActivityKey = 'mergedPrs' | 'closedPrs' | 'resolvedIssues' | 'openedPrs' | 'openedIssues';

export interface DayPoint {
  label: string;
  mergedPrs: number;
  closedPrs: number;
  resolvedIssues: number;
  openedPrs: number;
  openedIssues: number;
}

// Chart palette — curated dashboard colors (Tailwind-500 family) that read
// distinctly against both light and dark canvases when used at 18-70% opacity
// in stacked bands. Order = legend display order (lifecycle-grouped: opens
// then completions then closes).
const ACTIVITY_GROUPS = ['PRs', 'Issues'] as const;
type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];
// `label` is the full name (used in the tooltip); `short` drops the redundant group
// prefix so the grouped legend reads "PRs · Opened / Merged / Closed".
const ACTIVITY_SERIES: Array<{ key: ActivityKey; label: string; short: string; group: ActivityGroup; color: string }> = [
  { key: 'openedPrs',      label: 'PRs Opened',      short: 'Opened',   group: 'PRs',    color: '#3b82f6' }, // blue-500
  { key: 'mergedPrs',      label: 'PRs Merged',      short: 'Merged',   group: 'PRs',    color: '#10b981' }, // emerald-500
  { key: 'closedPrs',      label: 'PRs Closed',      short: 'Closed',   group: 'PRs',    color: '#ef4444' }, // red-500
  { key: 'openedIssues',   label: 'Issues Opened',   short: 'Opened',   group: 'Issues', color: '#8b5cf6' }, // violet-500
  { key: 'resolvedIssues', label: 'Issues Resolved', short: 'Resolved', group: 'Issues', color: '#f59e0b' }, // amber-500
];

export function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return 'M ' + points[0].x + ' ' + points[0].y;
  return points
    .map((point, index) => {
      if (index === 0) return 'M ' + point.x + ' ' + point.y;
      const prev = points[index - 1];
      const cpX = prev.x + (point.x - prev.x) / 2;
      return 'C ' + cpX + ' ' + prev.y + ' ' + cpX + ' ' + point.y + ' ' + point.x + ' ' + point.y;
    })
    .join(' ');
}

function niceCeil(value: number): number {
  if (value <= 4) return 4;
  const exp = Math.floor(Math.log10(value));
  const mag = Math.pow(10, exp);
  const norm = value / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return Math.ceil(nice * mag);
}

export function ActivityLineChart({ points }: { points: DayPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // Track the real rendered width so the viewBox matches the box 1:1 — a fixed
  // viewBox with `width="100%"` letterboxes (shrinks + centers) on narrow
  // screens, leaving big empty bands above/below the plot.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(900);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setMeasuredWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(280, measuredWidth);
  const height = 300;
  const pad = { left: 40, right: 16, top: 14, bottom: 32 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(4, ...points.flatMap((point) => ACTIVITY_SERIES.map((series) => point[series.key])));
  // Round yMax up to a "nice" step (10/25/50/100/250…) so y-axis labels are
  // readable round numbers.
  const yMax = niceCeil(maxValue);
  const active = hoveredIndex === null ? null : { index: hoveredIndex, point: points[hoveredIndex] };
  // Keep the last hovered index so the indicator can smoothly stay in place
  // while it fades out after the cursor leaves the chart.
  const lastHoveredRef = useRef<number>(0);
  useEffect(() => {
    if (hoveredIndex !== null) lastHoveredRef.current = hoveredIndex;
  }, [hoveredIndex]);
  // Clamp to current data length — when the user switches duration the data
  // shrinks but the ref still holds an index from the previous (longer) range.
  const rawDisplayIndex = hoveredIndex ?? lastHoveredRef.current;
  const displayIndex = points.length > 0
    ? Math.min(Math.max(0, rawDisplayIndex), points.length - 1)
    : 0;
  const displayPoint = points[displayIndex] ?? points[0];
  const x = (idx: number) => pad.left + (idx * plotWidth) / Math.max(1, points.length - 1);
  const y = (value: number) => pad.top + (1 - value / yMax) * plotHeight;
  const tickStep = Math.max(1, Math.ceil(points.length / 7));
  const totals = ACTIVITY_SERIES.map((series) => ({ ...series, total: points.reduce((sum, point) => sum + point[series.key], 0) }));
  const tooltipWidth = 196;
  // Height grows with series count — 5 rows × ~18px + header + total row +
  // padding. Recomputed so new series don't get clipped.
  const tooltipHeight = 56 + ACTIVITY_SERIES.length * 19 + 36;
  // Always compute a tooltip position (using displayIndex) so the tooltip can
  // slide smoothly even between hover transitions.
  const tooltipX = Math.min(width - tooltipWidth - 10, Math.max(10, x(displayIndex) - tooltipWidth / 2));
  const tooltipY = pad.top + 8;

  return (
    <Box sx={{ minWidth: 0 }}>
      <style>{`
        @keyframes activity-line-draw {
          from { stroke-dashoffset: 1; opacity: 0.28; }
          to   { stroke-dashoffset: 0; opacity: 1; }
        }
        @keyframes activity-dot-rise {
          from { transform: scale(.45); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .activity-line, .activity-dot { animation: none !important; opacity: 1 !important; stroke-dashoffset: 0 !important; }
        }
      `}</style>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '24px', rowGap: '8px', mb: 2 }}>
        {ACTIVITY_GROUPS.map((group) => (
          <Box key={group} sx={{ display: 'inline-flex', alignItems: 'center', gap: '14px' }}>
            <Text sx={{ color: 'fg.default', fontWeight: 700, fontSize: 0, mr: '-2px' }}>{group}</Text>
            {totals
              .filter((series) => series.group === group)
              .map((series) => (
                <ActivityLegend key={series.key} color={series.color} label={series.short} total={series.total} />
              ))}
          </Box>
        ))}
      </Box>
      <Box ref={containerRef} sx={{ width: '100%', overflow: 'hidden', border: '1px solid', borderColor: 'border.muted', borderRadius: 2 }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="Network activity over time" onMouseLeave={() => setHoveredIndex(null)}>
          {/* Stacked bands intentionally use a flat fill (no gradient) — the
              previous top→bottom gradient faded each band's lower edge to ~18%
              opacity, which over a dark canvas became near-black and made the
              colors look muddy. The 1.5px top-edge stroke alone gives enough
              separation between layers. */}
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const value = Math.round(yMax * (1 - tick));
            const lineY = pad.top + tick * plotHeight;
            return (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke="var(--border-default)" strokeDasharray="3 6" />
                <text x={pad.left - 10} y={lineY + 4} textAnchor="end" fontSize="10" fill="var(--fg-muted)">{value}</text>
              </g>
            );
          })}
          {/* Lines — one per series, drawn with a stroke-dashoffset animation
              so each one "draws itself in" left-to-right on first render. */}
          {ACTIVITY_SERIES.map((series, seriesIndex) => {
            const seriesPoints = points.map((point, idx) => ({ x: x(idx), y: y(point[series.key]) }));
            return (
              <path
                key={series.key}
                className="activity-line"
                d={smoothPath(seriesPoints)}
                fill="none"
                stroke={series.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                style={{
                  strokeDasharray: 1,
                  strokeDashoffset: 1,
                  animation: `activity-line-draw 760ms cubic-bezier(0.22, 1, 0.36, 1) ${seriesIndex * 110}ms forwards`,
                }}
              />
            );
          })}
          {points.map((point, idx) => {
            const showLabel = idx === 0 || idx === points.length - 1 || idx % tickStep === 0;
            return (
              <g key={point.label + idx}>
                {showLabel && <text x={x(idx)} y={height - 12} textAnchor="middle" fontSize="10" fill="var(--fg-muted)">{point.label}</text>}
                <rect
                  x={x(idx) - Math.max(6, plotWidth / Math.max(1, points.length) / 2)}
                  y={pad.top}
                  width={Math.max(12, plotWidth / Math.max(1, points.length))}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onFocus={() => setHoveredIndex(idx)}
                  onBlur={() => setHoveredIndex(null)}
                />
              </g>
            );
          })}
          {/* Hover indicator — always mounted (so CSS transitions can interpolate
              between hover positions instead of snapping). Group opacity controls
              show/hide, child elements transition their positional attributes.
              Guarded by points.length so it doesn't try to read stackedRows[0]
              when there's no data yet. */}
          {points.length > 0 && (
          <g
            style={{
              opacity: active ? 1 : 0,
              transition: 'opacity 180ms ease',
              pointerEvents: 'none',
            }}
          >
            <line
              x1={x(displayIndex)}
              x2={x(displayIndex)}
              y1={pad.top}
              y2={height - pad.bottom}
              stroke="var(--fg-muted)"
              strokeOpacity="0.42"
              strokeDasharray="4 6"
              style={{ transition: 'x1 140ms cubic-bezier(0.4, 0, 0.2, 1), x2 140ms cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
            {/* Dots at each line's value for the hovered x. CSS transitions on
                cx/cy give a glide effect when moving between days. */}
            {ACTIVITY_SERIES.map((series) => (
              <circle
                key={series.key}
                cx={x(displayIndex)}
                cy={y(displayPoint[series.key])}
                r="4"
                fill={series.color}
                stroke="var(--bg-canvas)"
                strokeWidth="2"
                style={{ transition: 'cx 140ms cubic-bezier(0.4, 0, 0.2, 1), cy 140ms cubic-bezier(0.4, 0, 0.2, 1)' }}
              />
            ))}
            {/* Tooltip — HTML inside foreignObject for themed CSS vars. The `x`
                attribute on foreignObject is transitionable in modern browsers. */}
            <foreignObject
              x={tooltipX}
              y={tooltipY}
              width={tooltipWidth}
              height={tooltipHeight}
              style={{ transition: 'x 160ms cubic-bezier(0.4, 0, 0.2, 1)' }}
            >
              <Box
                sx={{
                  bg: 'canvas.overlay',
                  backgroundColor: 'color-mix(in srgb, var(--canvas-overlay, var(--bgColor-overlay)) 92%, transparent)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 2,
                  px: 2,
                  py: 2,
                  fontSize: 0,
                }}
              >
                <Text sx={{ display: 'block', fontWeight: 700, color: 'fg.default', fontSize: 1, mb: 1 }}>
                  {displayPoint.label}
                </Text>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {ACTIVITY_SERIES.map((series) => (
                    <Box key={series.key} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: 99, bg: series.color, flexShrink: 0 }} />
                      <Text sx={{ color: 'fg.muted', flex: 1 }}>{series.label}</Text>
                      <Text sx={{ color: 'fg.default', fontWeight: 700, fontFamily: 'mono' }}>
                        {fmtCount(displayPoint[series.key])}
                      </Text>
                    </Box>
                  ))}
                </Box>
                <Box sx={{ borderTop: '1px solid', borderColor: 'border.muted', mt: 2, pt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text sx={{ color: 'fg.muted', fontWeight: 700, fontSize: 0 }}>TOTAL</Text>
                  <Text sx={{ color: 'fg.default', fontWeight: 700, fontFamily: 'mono', fontSize: 0 }}>
                    {fmtCount(ACTIVITY_SERIES.reduce((sum, series) => sum + displayPoint[series.key], 0))}
                  </Text>
                </Box>
              </Box>
            </foreignObject>
          </g>
          )}
        </svg>
      </Box>
    </Box>
  );
}

function ActivityLegend({ color, label, total }: { color: string; label: string; total: number }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 0, whiteSpace: 'nowrap' }}>
      <Box sx={{ width: 7, height: 7, borderRadius: 99, bg: color, flexShrink: 0 }} />
      <Text sx={{ color: 'fg.muted' }}>{label}</Text>
      <Text sx={{ color: 'fg.default', fontFamily: 'mono', fontWeight: 600 }}>{fmtCount(total)}</Text>
    </Box>
  );
}

export interface ForecastRepo {
  repo: string;
  /** This repo's decay-weighted earning-power contribution on the bucket day. */
  score: number;
}
export interface ForecastPoint {
  label: string;
  earned: number;
  projected: boolean;
  /** Per-repo breakdown (top contributors) for the day, for the hover tooltip. */
  repos: ForecastRepo[];
}

function forecastRepoAvatar(repo: string): string {
  const owner = repo.split('/')[0] ?? '';
  return `https://github.com/${encodeURIComponent(owner)}.png?size=40`;
}
export interface ForecastSeries {
  points: ForecastPoint[];
  /** Last historical bucket index (today) — boundary with the dashed projection. */
  nowIdx: number;
  /** Projected % erosion of earning power over the forward horizon (no new merges). */
  dropPct: number | null;
  projDays: number;
  liveNow: number;
}

const FORECAST_COLOR = '#6366f1'; // indigo-500 — distinct from the activity palette

/** Earning-power decay forecast in the SAME visual language as ActivityLineChart: a
 * smooth line of the miner's decay-weighted earning power — solid over history, dashed
 * past a "now" divider for the forward projection (current portfolio aging with no new
 * merges). The legend headlines the projected erosion. */
export function EarningForecastChart({ series }: { series: ForecastSeries }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(900);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setMeasuredWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lastHoveredRef = useRef(0);
  useEffect(() => {
    if (hoveredIndex !== null) lastHoveredRef.current = hoveredIndex;
  }, [hoveredIndex]);

  const width = Math.max(280, measuredWidth);
  const height = 300;
  const pad = { left: 40, right: 16, top: 14, bottom: 32 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const baseline = pad.top + plotHeight;
  const pts = series.points;
  const n = pts.length;
  const yMax = niceCeil(Math.max(4, ...pts.map((p) => p.earned)));
  const x = (idx: number) => pad.left + (idx * plotWidth) / Math.max(1, n - 1);
  const y = (value: number) => pad.top + (1 - value / yMax) * plotHeight;
  const tickStep = Math.max(1, Math.ceil(n / 7));
  const nowIdx = series.nowIdx;
  const hasProj = series.projDays > 0 && n > nowIdx + 1;
  const nowX = x(nowIdx);
  const histPts = pts.slice(0, nowIdx + 1).map((p, i) => ({ x: x(i), y: y(p.earned) }));
  const histLine = smoothPath(histPts);
  const areaPath = histPts.length ? `${histLine} L ${nowX} ${baseline} L ${x(0)} ${baseline} Z` : '';
  const projLine = hasProj ? smoothPath(pts.slice(nowIdx).map((p, k) => ({ x: x(nowIdx + k), y: y(p.earned) }))) : '';

  const active = hoveredIndex !== null;
  const displayIndex = n > 0 ? Math.min(Math.max(0, hoveredIndex ?? lastHoveredRef.current), n - 1) : 0;
  const displayPoint = pts[displayIndex] ?? pts[0];
  const repoRows = displayPoint?.repos?.length ?? 0;
  const tooltipWidth = repoRows > 0 ? 220 : 190;
  const tooltipHeight = 70 + repoRows * 21;
  const tooltipX = Math.min(width - tooltipWidth - 10, Math.max(10, x(displayIndex) - tooltipWidth / 2));
  const tooltipY = pad.top + 8;

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '18px', rowGap: '8px', mb: 2 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', whiteSpace: 'nowrap' }}>
          <Box sx={{ width: 14, height: 0, borderTop: '2.5px solid', borderColor: FORECAST_COLOR, flexShrink: 0 }} />
          <Text sx={{ color: 'fg.muted' }}>Total Score</Text>
          <Text sx={{ color: 'fg.default', fontFamily: 'mono', fontWeight: 600 }}>{fmtScore(series.liveNow)}</Text>
        </Box>
        {hasProj ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', whiteSpace: 'nowrap' }}>
            <Box sx={{ width: 14, height: 0, borderTop: '2px dashed', borderColor: FORECAST_COLOR, opacity: 0.6, flexShrink: 0 }} />
            <Text sx={{ color: 'fg.muted' }}>Forecast</Text>
          </Box>
        ) : null}
        {series.dropPct != null && series.dropPct > 0 ? (
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              px: '8px',
              py: '1px',
              borderRadius: '999px',
              bg: 'attention.subtle',
              color: 'attention.fg',
              fontSize: '11px',
              fontWeight: 600,
            }}
            title={`If no new PRs merge, your decay-weighted score erodes ~${series.dropPct}% over the next ${series.projDays} days.`}
          >
            ▼ {series.dropPct}% in {series.projDays}d
          </Box>
        ) : null}
      </Box>
      <Box ref={containerRef} sx={{ width: '100%', overflow: 'hidden', border: '1px solid', borderColor: 'border.muted', borderRadius: 2 }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          role="img"
          aria-label="Decay-weighted score forecast"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id="mmForecastArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={FORECAST_COLOR} stopOpacity="0.22" />
              <stop offset="100%" stopColor={FORECAST_COLOR} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const value = Math.round(yMax * (1 - tick));
            const lineY = pad.top + tick * plotHeight;
            return (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke="var(--border-default)" strokeDasharray="3 6" />
                <text x={pad.left - 10} y={lineY + 4} textAnchor="end" fontSize="10" fill="var(--fg-muted)">{value}</text>
              </g>
            );
          })}
          {hasProj ? (
            <>
              <rect x={nowX} y={pad.top} width={Math.max(0, width - pad.right - nowX)} height={plotHeight} fill="var(--fg-muted)" opacity={0.05} />
              <line x1={nowX} x2={nowX} y1={pad.top} y2={baseline} stroke="var(--fg-muted)" strokeOpacity="0.5" strokeDasharray="2 3" />
              <text x={nowX + 4} y={pad.top + 10} fontSize="9.5" fill="var(--fg-muted)">now</text>
            </>
          ) : null}
          <path d={areaPath} fill="url(#mmForecastArea)" />
          <path d={histLine} fill="none" stroke={FORECAST_COLOR} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {hasProj ? (
            <path d={projLine} fill="none" stroke={FORECAST_COLOR} strokeWidth="2.5" strokeDasharray="5 5" opacity="0.6" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
          {pts.map((point, idx) => (
            <g key={idx}>
              {(idx === 0 || idx === n - 1 || idx % tickStep === 0) && (
                <text x={x(idx)} y={height - 12} textAnchor="middle" fontSize="10" fill="var(--fg-muted)">{point.label}</text>
              )}
              <rect
                x={x(idx) - Math.max(6, plotWidth / Math.max(1, n) / 2)}
                y={pad.top}
                width={Math.max(12, plotWidth / Math.max(1, n))}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHoveredIndex(idx)}
              />
            </g>
          ))}
          {n > 0 && (
            <g style={{ opacity: active ? 1 : 0, transition: 'opacity 180ms ease', pointerEvents: 'none' }}>
              <line x1={x(displayIndex)} x2={x(displayIndex)} y1={pad.top} y2={baseline} stroke="var(--fg-muted)" strokeOpacity="0.42" strokeDasharray="4 6" />
              <circle cx={x(displayIndex)} cy={y(displayPoint.earned)} r="4" fill={FORECAST_COLOR} stroke="var(--bg-canvas)" strokeWidth="2" />
              <foreignObject x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight}>
                <Box
                  sx={{
                    bg: 'canvas.overlay',
                    backgroundColor: 'color-mix(in srgb, var(--canvas-overlay, var(--bgColor-overlay)) 92%, transparent)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid',
                    borderColor: 'border.default',
                    borderRadius: 2,
                    px: 2,
                    py: 2,
                    fontSize: 0,
                  }}
                >
                  <Text sx={{ display: 'block', fontWeight: 700, color: 'fg.default', fontSize: 1, mb: 1 }}>
                    {displayPoint.label}
                    {displayPoint.projected ? (
                      <Text as="span" sx={{ color: 'fg.muted', fontWeight: 400, fontStyle: 'italic', fontSize: 0 }}> · forecast</Text>
                    ) : null}
                  </Text>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: 99, bg: FORECAST_COLOR, flexShrink: 0 }} />
                    <Text sx={{ color: 'fg.muted', flex: 1 }}>Total score</Text>
                    <Text sx={{ color: 'fg.default', fontWeight: 700, fontFamily: 'mono' }}>{fmtScore(displayPoint.earned)}</Text>
                  </Box>
                  {repoRows > 0 ? (
                    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'border.muted', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {displayPoint.repos.map((r) => (
                        <Box key={r.repo} sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Box
                            as="img"
                            src={forecastRepoAvatar(r.repo)}
                            alt=""
                            loading="lazy"
                            sx={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0, bg: 'canvas.subtle' }}
                          />
                          <Text sx={{ color: 'fg.muted', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.repo}
                          </Text>
                          <Text sx={{ color: 'fg.default', fontFamily: 'mono', fontWeight: 600, flexShrink: 0 }}>{fmtScore(r.score)}</Text>
                        </Box>
                      ))}
                    </Box>
                  ) : null}
                </Box>
              </foreignObject>
            </g>
          )}
        </svg>
      </Box>
    </Box>
  );
}

