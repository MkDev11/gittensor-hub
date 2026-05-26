'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import styles from '../page.module.css';
import Avatar from './Avatar';
import { LABEL_COLORS, LANG_COLORS, LANG_NAME_ICONS, formatLangPct } from '../_lib/colors';
import LangIcon from './LangIcon';
import {
  formatTAO,
  repoDailyTAO,
  repoIssueTAO,
  repoMaintainerTAO,
  repoPerMaintainerTAO,
  repoPRTAO,
  type RepoRow,
} from '../_lib/incentives';
import { squarify } from '../_lib/squarify';
import type { RepoMiner, RepoMinersResponse } from '@/types/entities';

interface DrawerProps {
  open: boolean;
  row: RepoRow | null;
  subnetTAO: number;
  isInCompare: boolean;
  /** Whether /api/repos/metadata has resolved (regardless of whether this
   *  specific repo has a description / languages on GitHub). Lets the drawer
   *  distinguish "still loading" from "loaded but empty". */
  metadataLoaded: boolean;
  onClose: () => void;
  onToggleCompare: (full: string) => void;
}

export default function Drawer({
  open,
  row,
  subnetTAO,
  isInCompare,
  metadataLoaded,
  onClose,
  onToggleCompare,
}: DrawerProps) {
  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!row) {
    return (
      <>
        <div className={`${styles.backdrop} ${open ? styles.open : ''}`} onClick={onClose} />
        <aside className={`${styles.drawer} ${open ? styles.open : ''}`} aria-hidden />
      </>
    );
  }

  const r = row;
  const cred =
    r.activity.merged30d + r.activity.closed30d > 0
      ? r.activity.merged30d / (r.activity.merged30d + r.activity.closed30d)
      : 0;
  const credColor =
    cred >= 0.85 ? 'var(--color-moss-400)' :
    cred >= 0.7  ? 'var(--color-enh)' :
    'var(--color-refact)';

  const labelsContent = r.labels
    ? Object.entries(r.labels)
        .sort((a, b) => b[1] - a[1])
        .map(([l, v]) => {
          const c = LABEL_COLORS[l] ?? { fg: 'var(--fg-muted)', soft: '' };
          const isPenalty = v < 1.0;
          return (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, padding: '4px 0' }}>
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: 2, background: c.fg }} />
                <span style={{ color: v >= 1.3 ? c.fg : v >= 1.0 ? 'var(--fg-default)' : 'var(--fg-muted)' }}>{l}</span>
              </span>
              <span className="mono tnum" style={{ color: v >= 1.3 ? c.fg : isPenalty ? 'var(--color-refact)' : 'var(--fg-default)' }}>×{v.toFixed(2)}</span>
            </div>
          );
        })
    : null;

  const eligibilityContent = r.eligibility ? (
    <>
      {Object.entries(r.eligibility).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0' }}>
          <span className={`mono ${styles.textFgMute}`}>{k}</span>
          <span className={`mono tnum ${styles.textFg}`}>{v}</span>
        </div>
      ))}
    </>
  ) : (
    <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
      Uses global defaults: <span className={`mono ${styles.textFgDim}`}>3 valid PRs · cred ≥ 0.80 · token_score ≥ 5</span>
    </div>
  );

  return (
    <>
      <div className={`${styles.backdrop} ${open ? styles.open : ''}`} onClick={onClose} />
      <aside className={`${styles.drawer} ${open ? styles.open : ''}`}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Header */}
          <div
            style={{
              borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
              padding: '16px 20px',
              position: 'sticky',
              top: 0,
              background: 'var(--bg-subtle)',
              zIndex: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
                <Avatar fullName={r.fullName} size="xl" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    {r.isSelf ? <span className={`${styles.badge} ${styles.badgeSelf}`}>your repository</span> : null}
                    {r.trusted ? <span className={`${styles.badge} ${styles.badgeTrusted}`}>trusted pipeline</span> : null}
                    {r.share === 0 ? <span className={`${styles.badge} ${styles.badgeZero}`}>benchmark · no emissions</span> : null}
                    {r.eligibility ? <span className={`${styles.badge} ${styles.badgeOverrides}`}>eligibility override</span> : null}
                    {(r.maintCut || 0) > 0 ? (
                      <span className={`${styles.badge} ${styles.badgeMaint}`}>
                        {(r.maintCut * 100).toFixed(0)}% maintainer cut
                        {r.demoMaint ? <span style={{ opacity: 0.6, marginLeft: 2 }}>·demo</span> : null}
                      </span>
                    ) : null}
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 500 }}>
                    <span className={styles.textFgDim}>{r.owner}/</span>{r.name}
                  </h3>
                </div>
              </div>
              <button type="button" className={styles.ghostBtn} style={{ margin: -6, padding: 6 }} onClick={onClose}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Description is populated by /api/repos/metadata. Three cases:
              *  - has description → render normally
              *  - metadata still loading → italic placeholder
              *  - metadata loaded but repo has no GitHub description → omit */}
            {r.description ? (
              <p style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{r.description}</p>
            ) : !metadataLoaded ? (
              <p style={{ fontSize: 12.5, color: 'var(--fg-subtle)', lineHeight: 1.5, fontStyle: 'italic' }}>
                Loading description from GitHub…
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <a className={styles.priBtn} href={`https://github.com/${r.fullName}`} target="_blank" rel="noreferrer">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57 0-.28-.01-1.03-.02-2.03-3.34.73-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.77-1.34-1.77-1.1-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.48 1 .1-.78.42-1.3.76-1.6-2.66-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.4 1.24-3.24-.13-.3-.54-1.53.1-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.88.12 3.18.77.84 1.23 1.92 1.23 3.24 0 4.63-2.81 5.65-5.49 5.95.43.37.82 1.1.82 2.22 0 1.6-.02 2.9-.02 3.3 0 .31.22.7.83.57A12 12 0 0 0 12 .3" />
                </svg>
                View on GitHub
              </a>
              <a
                className={styles.secBtn}
                href={`https://github.com/${r.fullName}/issues?q=is:open+label:%22good+first+issue%22`}
                target="_blank"
                rel="noreferrer"
              >
                good-first-issues ↗
              </a>
              <button type="button" className={styles.secBtn} onClick={() => onToggleCompare(r.fullName)}>
                {isInCompare ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>{' '}
                    In compare
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M12 5v14M5 12h14" />
                    </svg>{' '}
                    Add to compare
                  </>
                )}
              </button>
            </div>
          </div>

          {/* TAO emission */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))' }}>
            <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
              Daily emission
            </div>
            <div className={`${styles.num2xl} tnum ${r.share === 0 ? styles.textFgFaint : styles.textTao}`} style={{ marginBottom: 4 }}>
              {formatTAO(repoDailyTAO(r, subnetTAO))}
              <span className={styles.textFgMute} style={{ fontSize: 16, marginLeft: 8 }}>TAO/day</span>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)', marginBottom: 12 }}>
              = {formatTAO(subnetTAO)} TAO (total miners emission) × {(r.share * 100).toFixed(3)}% share × 90% OSS pool
            </div>

            {r.share > 0 && (r.maintCut || 0) > 0 ? (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--softer-border, rgba(255,255,255,0.04))' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-moss-400)' }} />
                    <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      Maintainer cut
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      className={styles.badge}
                      style={{
                        background: 'rgba(158,184,114,0.10)',
                        color: 'var(--color-moss-400)',
                        borderColor: 'rgba(158,184,114,0.25)',
                        fontSize: 9.5,
                        padding: '0 5px',
                        lineHeight: 1.5,
                      }}
                    >
                      off the top
                    </span>
                    {r.demoMaint ? <span className={styles.demoTag} title="Placeholder value">demo</span> : null}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                  <span className={`mono ${styles.numM} tnum ${styles.textMoss}`}>{formatTAO(repoMaintainerTAO(r, subnetTAO))}</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>τ/d total · {(r.maintCut * 100).toFixed(0)}% of slice</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                  Split evenly among <span className={`mono ${styles.textFg}`}>{r.maintainerCount}</span> registered maintainer
                  {r.maintainerCount === 1 ? '' : 's'} ·{' '}
                  <span className={`mono ${styles.textMoss}`}>{formatTAO(repoPerMaintainerTAO(r, subnetTAO))} τ/d</span> each
                </div>
                {r.demoMaint ? (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 8,
                      borderRadius: 4,
                      fontSize: 10.5,
                      color: 'var(--fg-subtle)',
                      lineHeight: 1.5,
                      background: 'var(--softer-fill, rgba(255,255,255,0.025))',
                      border: '1px dashed var(--soft-border, rgba(255,255,255,0.08))',
                    }}
                  >
                    <span className={styles.textFgDim}>Note:</span> the <span className="mono">maintainer_cut</span> mechanic is new
                    (announced in the recent Discord update). No repos have validator-set values yet — this card shows a plausible
                    placeholder so the UI can be reviewed.
                  </div>
                ) : null}
              </div>
            ) : null}

            {r.share > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 12,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--softer-border, rgba(255,255,255,0.04))',
                }}
              >
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                    PR slice
                  </div>
                  <div className={`mono ${styles.numM} tnum ${styles.textPr}`}>{formatTAO(repoPRTAO(r, subnetTAO))} τ/d</div>
                  <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>
                    {(r.maintCut || 0) > 0
                      ? `${((1 - r.maintCut) * (1 - r.issue) * 100).toFixed(0)}% of slice (after the cut)`
                      : `${((1 - r.issue) * 100).toFixed(0)}% of slice`}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                    Issue discovery slice
                  </div>
                  <div className={`mono ${styles.numM} tnum ${styles.textIssue}`}>{formatTAO(repoIssueTAO(r, subnetTAO))} τ/d</div>
                  <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>
                    {(r.maintCut || 0) > 0
                      ? `${((1 - r.maintCut) * r.issue * 100).toFixed(0)}% of slice (after the cut)`
                      : `${(r.issue * 100).toFixed(0)}% of slice`}
                  </div>
                </div>
                <div title="Merge rate over the last 30 days = merged ÷ (merged + closed). A forecast of how welcoming the repo is right now.">
                  <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                    Merge rate · 30d
                  </div>
                  <div className={`mono ${styles.numM} tnum`} style={{ color: credColor }}>
                    {(cred * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>
                    merged ÷ resolved
                  </div>
                </div>
                <div title="PRs that received a final decision (merged or closed) in the last 30 days — the denominator behind the merge-rate %.">
                  <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                    Resolved
                  </div>
                  <div className={`mono ${styles.numM} tnum ${styles.textFgDim}`}>
                    {r.activity.merged30d + r.activity.closed30d}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>
                    PRs · last 30d
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Activity */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))' }}>
            <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
              Activity · 30d{' '}
              <span className={`mono ${styles.textFgFaint}`} style={{ textTransform: 'none', letterSpacing: 0 }}>PRs created in the last 30 days · open count live from GitHub</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <ActivityStat value={r.activity.merged30d} label="merged PRs" tone="strong" />
              <ActivityStat value={r.activity.openPRs} label="open PRs" tone="dim" />
              <ActivityStat value={r.activity.closed30d} label="closed PRs" tone="dim" />
              <ActivityStat value={r.activity.contribs} label="contributors" tone="strong" />
            </div>
          </div>

          {/* Miner contributors — per-repo ranked treemap from the validator.
            * Eligible miners are full-opacity; historical-but-ineligible
            * miners are dimmed in-place rather than split into a separate
            * section. */}
          <MinersSection
            owner={r.owner}
            name={r.name}
            repoPRTAOValue={repoPRTAO(r, subnetTAO)}
          />

          {/* Languages — always render the section so the drawer's shape
            * matches the HTML; show a loading-style placeholder while the
            * /api/repos/metadata endpoint is still fetching. */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))' }}>
            <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
              Primary languages
            </div>
            {r.langs.length > 0 ? (
              <div className={styles.drawerLangGrid}>
                {r.langs.map(([n, p]) => {
                  const color = LANG_COLORS[n] ?? 'var(--fg-subtle)';
                  const spec = LANG_NAME_ICONS[n.toLowerCase()];
                  return (
                    <div key={n} className={styles.drawerLangRow}>
                      <LangIcon
                        spec={spec}
                        color={color}
                        fallbackLetter={n.slice(0, n.length <= 2 ? 1 : 2).toUpperCase()}
                        size={16}
                        title={n}
                      />
                      <span className={styles.drawerLangName}>{n}</span>
                      <span className={`mono tnum ${styles.textFgDim} ${styles.drawerLangPct}`}>{formatLangPct(p)}</span>
                    </div>
                  );
                })}
              </div>
            ) : !metadataLoaded ? (
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>
                Loading language breakdown from GitHub…
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
                Not available for this repo.
              </div>
            )}
          </div>

          {/* Labels */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))' }}>
            <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
              Label multipliers
            </div>
            {labelsContent ?? <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>No per-label multipliers. PRs score at default ×1.00.</div>}
            {r.labels ? (
              <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--softer-border, rgba(255,255,255,0.04))' }}>
                default <span className={`mono ${styles.textFgDim}`}>×{r.defaultLabel.toFixed(2)}</span> for unmatched labels
              </div>
            ) : null}
          </div>

          {/* Eligibility */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))' }}>
            <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
              Eligibility gate
            </div>
            {eligibilityContent}
          </div>

          {/* Raw config */}
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Raw config · master_repositories.json
            </div>
            <pre
              className="mono"
              style={{
                fontSize: 11.5,
                color: 'var(--fg-muted)',
                lineHeight: 1.5,
                background: 'var(--bg-inset)',
                border: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
                borderRadius: 4,
                padding: 12,
                overflowX: 'auto',
                margin: 0,
              }}
            >
              {buildRawJson(r)}
            </pre>
          </div>
        </div>
      </aside>
    </>
  );
}

function minerKey(m: RepoMiner): string {
  return `${m.githubId || m.githubUsername}-${m.uid ?? m.githubUsername}`;
}

const TOP_ACTIVE_MINERS_LIMIT = 5;
const MAX_DOMINANT_MINER_TILE_SHARE = 0.58;
const MIN_INELIGIBLE_TILE_REGION = 0.18;
const MAX_INELIGIBLE_TILE_REGION = 0.44;

function repoWorkScore(m: RepoMiner): number {
  return Math.max(
    m.score ?? 0,
    m.baseScore ?? 0,
    m.collateralScore ?? 0,
    (m.totalPrCount ?? m.prCount ?? 0) * 0.25,
  );
}

function tileScale(value: number): number {
  return Math.pow(Math.max(value, 0), 0.35);
}

function eligibleTileUnit(m: RepoMiner, topEligibleScore: number): number {
  const finalScore = Math.max(m.score ?? 0, 0);
  const eligibleFloor = 3.2;
  const topEligibleUnit = Math.max(tileScale(topEligibleScore), eligibleFloor);
  return Math.max(tileScale(finalScore), topEligibleUnit * 0.72, eligibleFloor);
}

function ineligibleTileUnit(m: RepoMiner): number {
  const baseRepoScore = Math.max(
    m.baseScore ?? 0,
    m.score ?? 0,
    0.15,
  );
  return Math.max(tileScale(baseRepoScore), 0.75);
}

function buildSoftMinerWeights(
  miners: RepoMiner[],
  unitFor: (m: RepoMiner) => number,
): Array<{ w: number; data: RepoMiner }> {
  if (miners.length === 0) return [];
  const rawUnits = miners.map((miner) => Math.max(unitFor(miner), 0.72));
  const maxUnit = Math.max(...rawUnits);
  const floor = Number.isFinite(maxUnit) && maxUnit > 0 ? maxUnit * 0.58 : 1;
  return miners.map((miner, i) => ({ w: Math.max(rawUnits[i], floor), data: miner }));
}

function sumWeights(items: Array<{ w: number }>): number {
  return items.reduce((sum, item) => sum + item.w, 0);
}

function ineligibleRegionShare(
  eligibleWeights: Array<{ w: number; data: RepoMiner }>,
  ineligibleWeights: Array<{ w: number; data: RepoMiner }>,
): number {
  if (eligibleWeights.length === 0) return 1;
  if (ineligibleWeights.length === 0) return 0;

  const eligibleTotal = sumWeights(eligibleWeights);
  const ineligibleTotal = sumWeights(ineligibleWeights);
  const smallestEligibleShare = eligibleTotal > 0
    ? Math.min(...eligibleWeights.map((item) => item.w)) / eligibleTotal
    : 1;
  const largestIneligibleShare = ineligibleTotal > 0
    ? Math.max(...ineligibleWeights.map((item) => item.w)) / ineligibleTotal
    : 1;
  const dominanceCap =
    (smallestEligibleShare * 0.88) / (largestIneligibleShare + smallestEligibleShare * 0.88);
  const readableTarget = Math.min(
    MAX_INELIGIBLE_TILE_REGION,
    Math.max(MIN_INELIGIBLE_TILE_REGION, ineligibleWeights.length * 0.13),
  );

  return Math.min(readableTarget, dominanceCap);
}

function layoutMinerRegion(
  items: Array<{ w: number; data: RepoMiner }>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  return squarify(capDominantMinerTile(items), x, y, w, h);
}

function layoutMinerTiles(miners: RepoMiner[], W: number, H: number, isNarrow: boolean) {
  const eligible = miners.filter((m) => m.isEligible);
  const ineligible = miners.filter((m) => !m.isEligible);
  const topEligibleScore = Math.max(0, ...eligible.map((m) => m.score ?? 0));
  const eligibleWeights = buildSoftMinerWeights(eligible, (m) => eligibleTileUnit(m, topEligibleScore));
  const ineligibleWeights = buildSoftMinerWeights(ineligible, ineligibleTileUnit);

  if (eligibleWeights.length === 0) {
    return layoutMinerRegion(ineligibleWeights, 0, 0, W, H);
  }
  if (ineligibleWeights.length === 0) {
    return layoutMinerRegion(eligibleWeights, 0, 0, W, H);
  }

  const ineligibleShare = ineligibleRegionShare(eligibleWeights, ineligibleWeights);
  const eligibleShare = 1 - ineligibleShare;

  if (isNarrow) {
    const eligibleH = H * eligibleShare;
    return [
      ...layoutMinerRegion(eligibleWeights, 0, 0, W, eligibleH),
      ...layoutMinerRegion(ineligibleWeights, 0, eligibleH, W, H - eligibleH),
    ];
  }

  const eligibleW = W * eligibleShare;
  return [
    ...layoutMinerRegion(eligibleWeights, 0, 0, eligibleW, H),
    ...layoutMinerRegion(ineligibleWeights, eligibleW, 0, W - eligibleW, H),
  ];
}

function capDominantMinerTile<T>(items: Array<{ w: number; data: T }>): Array<{ w: number; data: T }> {
  if (items.length < 2) return items;
  const total = items.reduce((sum, item) => sum + item.w, 0);
  if (!Number.isFinite(total) || total <= 0) return items;

  let maxIndex = 0;
  for (let i = 1; i < items.length; i++) {
    if (items[i].w > items[maxIndex].w) maxIndex = i;
  }

  const rest = total - items[maxIndex].w;
  if (rest <= 0 || items[maxIndex].w / total <= MAX_DOMINANT_MINER_TILE_SHARE) return items;

  const cappedMax = (MAX_DOMINANT_MINER_TILE_SHARE / (1 - MAX_DOMINANT_MINER_TILE_SHARE)) * rest;
  return items.map((item, i) => (i === maxIndex ? { ...item, w: cappedMax } : item));
}

function useNarrowTreemap(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return isNarrow;
}

function credibilityPct(miner: RepoMiner): number | null {
  if (miner.credibility == null || !Number.isFinite(miner.credibility)) return null;
  const pct = miner.credibility <= 1 ? miner.credibility * 100 : miner.credibility;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Credibility tint — borrows Linear's status palette so the badge feels
 *  at home in this product family. Linear uses subtle, slightly
 *  desaturated tones graded by completion state: deep green for "done",
 *  yellow for "in progress", red for "canceled", gray for "backlog". */
function credibilityColor(pct: number | null): string {
  if (pct == null) return '#95a2b3';  // Linear: backlog / unknown
  if (pct >= 90) return '#26b574';    // Linear: done (deep green)
  if (pct >= 75) return '#4cb782';    // Linear: in review (soft green)
  if (pct >= 60) return '#f2c94c';    // Linear: in progress (yellow)
  if (pct >= 40) return '#f5a623';    // Linear: warning amber
  return '#eb5757';                    // Linear: blocked / canceled (red)
}

function MinerCredAvatar({ miner, size }: { miner: RepoMiner; size: 'xs' | 'sm' | 'md' | 'lg' }) {
  const pct = credibilityPct(miner);
  const color = credibilityColor(pct);
  return (
    <span
      className={styles.mtileAvatarWrap}
      style={{ '--cred-color': color } as React.CSSProperties}
      title={pct == null ? `@${miner.githubUsername}` : `@${miner.githubUsername} · ${pct}% repo PR credibility`}
    >
      <Avatar fullName={miner.githubUsername} size={size} />
      {pct != null ? <span className={`${styles.mtileCredBadge} mono`}>{pct}%</span> : null}
    </span>
  );
}

/** Per-repo miner contributors panel with a squarified treemap. */
function MinersSection({ owner, name, repoPRTAOValue }: { owner: string; name: string; repoPRTAOValue: number }) {
  const { data, isLoading, isError } = useQuery<RepoMinersResponse>({
    queryKey: ['gt-repo-miners', owner, name],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/gt/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/miners`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<RepoMinersResponse>;
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { allRows, totalEligibleScore, top1Pct, conc } = useMemo(() => {
    const list = (data?.ossContributions ?? [])
      .filter((m) => m.isEligible === true || repoWorkScore(m) > 0)
      .slice()
      .sort((a, b) => {
        if ((a.isEligible ? 1 : 0) !== (b.isEligible ? 1 : 0)) return a.isEligible ? -1 : 1;
        return (b.score ?? 0) - (a.score ?? 0) || repoWorkScore(b) - repoWorkScore(a);
      });
    const topRows = list.slice(0, TOP_ACTIVE_MINERS_LIMIT);
    const eligible = topRows.filter((m) => m.isEligible);
    const totalEligible = eligible.reduce((s, m) => s + m.score, 0);
    const top1 = totalEligible > 0 ? ((eligible[0]?.score ?? 0) / totalEligible) * 100 : 0;
    const concentration =
      top1 >= 50 ? { label: 'concentrated', color: '#c5503a' } :
      top1 >= 30 ? { label: 'top-heavy', color: '#eab308' } :
      top1 >= 20 ? { label: 'balanced', color: '#9eb872' } :
                   { label: 'distributed', color: '#7fb992' };
    return {
      allRows: topRows,
      totalEligibleScore: totalEligible,
      top1Pct: top1,
      conc: concentration,
    };
  }, [data]);

  const containerStyle = { padding: '16px 20px', borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))' } as const;

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
          Active miners
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>Loading miners…</div>
      </div>
    );
  }
  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
          Active miners
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-refact)' }}>Failed to load miner contributors.</div>
      </div>
    );
  }
  if (allRows.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
          Active miners
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)', fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>
          No miner data available for this repo yet.
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        <span>
          Active miners{' '}
          <span className={`mono ${styles.textFgFaint}`} style={{ textTransform: 'none', letterSpacing: 0 }}>
            top {TOP_ACTIVE_MINERS_LIMIT} by repo score
          </span>
        </span>
      </div>

      <div className={styles.minersHeader}>
        <div className={styles.minersHeaderMain}>
          <span className={`${styles.minersHeaderCount} mono`}>{allRows.length}</span>
          <span style={{ fontSize: 10.5, color: 'var(--fg-muted)' }}>
            active · top earner takes{' '}
            <span className="mono" style={{ color: conc.color }}>{top1Pct.toFixed(0)}%</span>
          </span>
          <span
            className={styles.minersHeaderTag}
            style={{ color: conc.color, background: `${conc.color}1a`, borderColor: `${conc.color}44` }}
          >
            {conc.label}
          </span>
        </div>
      </div>

      <MinerTreemap
        miners={allRows}
        totalEligibleScore={totalEligibleScore}
        repoPRTAOValue={repoPRTAOValue}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontSize: 10, color: 'var(--fg-faint)', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className={styles.mtileLegendDot} style={{ background: '#5e6ad2' }} /> eligible
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className={styles.mtileLegendDot} style={{ background: 'rgba(120,125,135,0.5)' }} /> ineligible
          </span>
        </span>
        <span style={{ fontStyle: 'italic' }}>
          Top five only · tile size follows repo score, capped for readability
        </span>
      </div>
    </div>
  );
}

/** Squarified treemap of repo contributors. Tile area is based on the
 *  miner's score for this repo, with ineligible/historical miners damped so
 *  eligible miners remain visually dominant while every status still has a
 *  place in the map. */
function MinerTreemap({
  miners,
  totalEligibleScore,
  repoPRTAOValue,
}: {
  miners: RepoMiner[];
  totalEligibleScore: number;
  repoPRTAOValue: number;
}) {
  const isNarrow = useNarrowTreemap();
  const W = isNarrow ? 600 : 1000;
  const H = isNarrow ? 990 : 540;
  const tiles = useMemo(() => {
    return layoutMinerTiles(miners, W, H, isNarrow);
  }, [H, W, isNarrow, miners]);
  // Rank among ELIGIBLE only — drives the leader crown and the lime tier
  // shading. Ineligible miners don't get a "leader" treatment regardless
  // of their historical score.
  const eligibleRankByUser = useMemo(() => {
    const ranks = new Map<string, number>();
    miners
      .filter((m) => m.isEligible)
      .forEach((m, i) => ranks.set(minerKey(m), i + 1));
    return ranks;
  }, [miners]);

  return (
    <div className={styles.mtileContainer}>
      {tiles.map((t) => {
        const m = t.data;
        const eligible = m.isEligible === true;
        const eligRank = eligibleRankByUser.get(minerKey(m)) ?? null;
        const share = eligible && totalEligibleScore > 0 ? m.score / totalEligibleScore : 0;
        const tao = eligible ? share * repoPRTAOValue : 0;
        const xPct = (t.x / W) * 100;
        const yPct = (t.y / H) * 100;
        const wPct = (t.w / W) * 100;
        const hPct = (t.h / H) * 100;
        // Thresholds tuned against the 1000x560 reference canvas so text
        // only appears when it has enough real room in the responsive tile.
        const sizeClass =
          t.w >= 300 && t.h >= 190 ? 'xl' :
          t.w >= 220 && t.h >= 160 ? 'lg' :
          t.w >= 160 && t.h >= 125 ? 'md' :
          t.w >= 112 && t.h >= 96  ? 'sm' :
                                     'xs';
        // Wide-short tiles can't fit the vertical 3-row layout (avatar
        // on top, name below, score+meta at the bottom) — the bottom
        // gets clipped. Switch to a horizontal layout where the avatar
        // and name share the top row, freeing vertical room for the
        // score/meta to render in full.
        const wideShort = (sizeClass === 'lg' || sizeClass === 'md') && t.w > t.h * 1.6;
        const showCompactStats =
          !wideShort && (
            (sizeClass === 'sm' && t.h >= 145) ||
            (sizeClass === 'xs' && t.w >= 72 && t.h >= 170)
          );
        // Tier styling lives in CSS so light/dark themes can swap palettes
        // without recomputing colors here. textTone is inherited from the
        // tile's CSS `color` per tier.
        const tierClass =
          !eligible ? styles.mtileTierIneligible :
          eligRank === 1 ? styles.mtileTierLeader :
          eligRank !== null && eligRank <= 3 ? styles.mtileTierTop :
                                               styles.mtileTierMid;
        const textTone = 'inherit';
        const sizeClassName =
          sizeClass === 'xl' ? styles.mtileXl :
          sizeClass === 'lg' ? styles.mtileLg :
          sizeClass === 'md' ? styles.mtileMd :
          sizeClass === 'sm' ? styles.mtileSm :
                               styles.mtileXs;
        const isLeader = eligRank === 1;
        const cls = [styles.mtile, sizeClassName, tierClass].filter(Boolean).join(' ');
        const credPct = credibilityPct(m);
        const credText = credPct == null ? 'unknown credibility' : `${credPct}% repo PR credibility`;
        const title = eligible
          ? `@${m.githubUsername} · ${credText} · repo score ${m.score.toFixed(2)} · ${formatTAO(tao)} T/Day · ${(share * 100).toFixed(1)}% · ${m.prCount} merged · eligible`
          : `@${m.githubUsername} · ${credText} · base score ${(m.baseScore ?? 0).toFixed(2)} · ${m.prCount} merged · ineligible`;
        return (
          <a
            key={minerKey(m)}
            href={`https://github.com/${encodeURIComponent(m.githubUsername)}`}
            target="_blank"
            rel="noreferrer"
            className={cls}
            style={{
              left: `${xPct}%`,
              top: `${yPct}%`,
              width: `${wPct}%`,
              height: `${hPct}%`,
            }}
            title={title}
          >
            <MinerTileContent
              sizeClass={sizeClass}
              wideShort={wideShort}
              miner={m}
              eligible={eligible}
              isLeader={isLeader}
              tao={tao}
              share={share}
              textTone={textTone}
              showCompactStats={showCompactStats}
            />
          </a>
        );
      })}
    </div>
  );
}

function MinerTileContent({
  sizeClass,
  wideShort,
  miner,
  eligible,
  isLeader,
  tao,
  share,
  textTone,
  showCompactStats,
}: {
  sizeClass: 'xl' | 'lg' | 'md' | 'sm' | 'xs';
  wideShort: boolean;
  miner: RepoMiner;
  eligible: boolean;
  isLeader: boolean;
  tao: number;
  share: number;
  textTone: string;
  showCompactStats: boolean;
}) {
  const visibleScore = eligible ? miner.score : (miner.baseScore ?? 0);
  const scoreNode = (
    <>
      {visibleScore.toFixed(1)}
      <span className={styles.mtileTaoUnit}> {eligible ? 'score' : 'base score'}</span>
    </>
  );
  const shareText = eligible ? `${(share * 100).toFixed(1)}%` : null;
  const taoText = eligible ? `${formatTAO(tao)} T/Day` : '0 T/Day';
  const metaNode = (
    <>
      {shareText ? (
        <>
          <span>{shareText}</span>
          <span className={styles.mtileSep}>·</span>
        </>
      ) : null}
      <span>{taoText}</span>
    </>
  );
  // Let the score text inherit from the tile's tier color so it adapts
  // to dark/light mode automatically (was hardcoded `#edf0f2` and
  // disappeared on light backgrounds).
  const scoreColor: string | undefined = undefined;

  // Top-right meta: uid + optional crown. Sits on the top row next to
  // the avatar without stealing horizontal space from the name (which
  // gets its own full-width row in mtileMid below).
  const topMeta = miner.uid != null || isLeader ? (
    <div className={styles.mtileTopMeta}>
      {miner.uid != null ? (
        <div className={`${styles.mtileUid} mono`}>uid {miner.uid}</div>
      ) : null}
      {isLeader ? <div className={styles.mtileCrown} title="top eligible earner">★</div> : null}
    </div>
  ) : null;

  if (wideShort && (sizeClass === 'lg' || sizeClass === 'md')) {
    // Horizontal layout: avatar+name share the top row, score+meta fill
    // the bottom row. Saves the vertical space that the standard
    // 3-section layout was eating up.
    return (
      <>
        <div className={styles.mtileTopHorizontal}>
          <MinerCredAvatar miner={miner} size={sizeClass === 'lg' ? 'md' : 'sm'} />
          <div className={styles.mtileHorizontalName} style={{ color: textTone }}>
            {miner.githubUsername}
          </div>
          {topMeta}
        </div>
        <div className={styles.mtileBottom}>
          <div className={`${styles.mtileTao} mono`} style={{ fontSize: sizeClass === 'lg' ? undefined : 12, color: scoreColor }}>
            {scoreNode}
          </div>
          <div className={`${styles.mtileMeta} mono`} style={{ fontSize: sizeClass === 'lg' ? undefined : 9.5 }}>
            {metaNode}
          </div>
        </div>
      </>
    );
  }
  if (sizeClass === 'xl' || sizeClass === 'lg') {
    return (
      <>
        <div className={styles.mtileTop}>
          <MinerCredAvatar miner={miner} size={sizeClass === 'xl' ? 'lg' : 'md'} />
          {topMeta}
        </div>
        <div className={styles.mtileNameRow}>
          <div className={styles.mtileName} style={{ color: textTone }}>{miner.githubUsername}</div>
        </div>
        <div className={styles.mtileBottom}>
          <div className={`${styles.mtileTao} mono`} style={{ color: scoreColor }}>
            {scoreNode}
          </div>
          <div className={`${styles.mtileMeta} mono`}>
            {metaNode}
          </div>
        </div>
      </>
    );
  }
  if (sizeClass === 'md') {
    return (
      <>
        <div className={styles.mtileTop}>
          <MinerCredAvatar miner={miner} size="sm" />
          {topMeta}
        </div>
        <div className={styles.mtileNameRow}>
          <div className={styles.mtileName} style={{ color: textTone }}>{miner.githubUsername}</div>
        </div>
        <div className={styles.mtileBottom}>
          <div className={`${styles.mtileTao} mono`} style={{ fontSize: 12, color: scoreColor }}>
            {scoreNode}
          </div>
          <div className={`${styles.mtileMeta} mono`} style={{ fontSize: 9.5 }}>
            {metaNode}
          </div>
        </div>
      </>
    );
  }
  if (sizeClass === 'sm') {
    return (
      <div className={`${styles.mtileCompact} ${showCompactStats ? styles.mtileCompactWithStats : ''}`}>
        <div className={styles.mtileCompactIdentity}>
          <MinerCredAvatar miner={miner} size="sm" />
          <div className={`${styles.mtileName} ${styles.mtileNameSmall} ${styles.mtileCompactName}`} style={{ color: textTone }}>
            {miner.githubUsername}
          </div>
        </div>
        {showCompactStats ? (
          <div className={styles.mtileCompactStats}>
            <div className={`${styles.mtileCompactScore} mono`}>
              {visibleScore.toFixed(1)}
              <span>{eligible ? ' score' : ' base'}</span>
            </div>
            <div className={`${styles.mtileCompactMeta} mono`}>
              {eligible ? `${formatTAO(tao)} T/Day` : '0 T/Day'}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
  // xs — identity-only. Hide UID/star from the visible layout because those
  // controls steal the horizontal space the username needs in tiny tiles.
  return (
    <div className={`${styles.mtileTiny} ${showCompactStats ? styles.mtileTinyWithStats : ''}`}>
      <div className={styles.mtileTinyIdentity}>
        <MinerCredAvatar miner={miner} size="xs" />
        <div className={`${styles.mtileName} ${styles.mtileNameTiny}`} style={{ color: textTone }}>
          {miner.githubUsername}
        </div>
      </div>
      {showCompactStats ? (
        <div className={styles.mtileTinyStats}>
          <span className="mono">{visibleScore.toFixed(1)}</span>
          <span>{eligible ? 'score' : '0 T/Day'}</span>
        </div>
      ) : null}
    </div>
  );
}

function ActivityStat({ value, label, tone }: { value: number; label: string; tone: 'strong' | 'dim' }) {
  return (
    <div>
      <div className={`mono ${styles.numM} tnum`} style={{ color: tone === 'strong' ? 'var(--fg-default)' : 'var(--fg-muted)' }}>
        {value}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function buildRawJson(r: RepoRow): string {
  const obj: Record<string, unknown> = {
    emission_share: r.share,
    issue_discovery_share: r.issue,
  };
  if (r.labels) obj.label_multipliers = r.labels;
  if (r.defaultLabel !== 1.0) obj.default_label_multiplier = r.defaultLabel;
  if (r.fixedBase !== null) obj.fixed_base_score = r.fixedBase;
  if (r.maintCut > 0) obj.maintainer_cut = r.maintCut;
  if (r.trusted) obj.trusted_label_pipeline = true;
  if (r.eligibility) obj.eligibility = r.eligibility;
  return JSON.stringify(obj, null, 2);
}
