'use client';

import React from 'react';
import { StarFillIcon, StarIcon } from '@primer/octicons-react';
import styles from '../page.module.css';
import Avatar from './Avatar';
import { LABEL_COLORS, LABEL_KEYS, LANG_COLORS, LANG_NAME_ICONS, formatLangPct } from '../_lib/colors';
import LangIcon from './LangIcon';
import {
  OSS_POOL,
  effectiveLabelMult,
  formatTAO,
  repoDailyTAO,
  repoIssueTAO,
  repoMaintainerTAO,
  repoPerMaintainerTAO,
  repoPRTAO,
  rewardSignal,
  type RepoRow,
  type StrategyKey,
} from '../_lib/incentives';

interface RepoCardProps {
  row: RepoRow;
  subnetTAO: number;
  strategy: StrategyKey;
  isSelected: boolean;
  isBest: boolean;
  isWarn: boolean;
  isTracked: boolean;
  /** Whether /api/repos/metadata has resolved. When false the langs row
   *  renders a small skeleton so the card height stays stable and the
   *  user can tell "still loading" apart from "loaded; no data". */
  metadataLoaded?: boolean;
  onOpen: () => void;
  onToggleCompare: () => void;
  onToggleTrack: () => void;
}

export default function RepoCard({
  row,
  subnetTAO,
  strategy,
  isSelected,
  isBest,
  isWarn,
  isTracked,
  metadataLoaded = false,
  onOpen,
  onToggleCompare,
  onToggleTrack,
}: RepoCardProps) {
  const r = row;
  const maintCut = r.maintCut || 0;
  const afterCut = 1 - maintCut;
  const maintPct = maintCut * 100;
  const prPct = afterCut * (1 - r.issue) * 100;
  const issPct = afterCut * r.issue * 100;

  const dailyTAO = repoDailyTAO(r, subnetTAO);
  const prTAO = repoPRTAO(r, subnetTAO);
  const issTAO = repoIssueTAO(r, subnetTAO);
  const maintTAO = repoMaintainerTAO(r, subnetTAO);
  const perMaintTAO = repoPerMaintainerTAO(r, subnetTAO);

  /* Right-side strategy indicator (mirrors HTML's effIndicator block) */
  let effIndicator: React.ReactNode = null;
  if (strategy !== 'none' && strategy !== 'issue') {
    const m = effectiveLabelMult(r, strategy);
    const color =
      m >= 1.3 ? 'var(--color-feat)' :
      m >= 1.0 ? 'var(--color-enh)' :
      m >= 0.5 ? 'var(--fg-subtle)' :
      'var(--color-refact)';
    const sigTAO = (subnetTAO * rewardSignal(r, strategy)).toFixed(3);
    effIndicator = (
      <div style={{ textAlign: 'right' }}>
        <div className={`${styles.numL} tnum`} style={{ color }}>×{m.toFixed(2)}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 4 }}>
          ×{strategy}
        </div>
        <div className="tnum mono" style={{ fontSize: 10.5, marginTop: 4, color }}>{sigTAO} TAO</div>
      </div>
    );
  } else if (strategy === 'issue') {
    effIndicator = (
      <div style={{ textAlign: 'right' }}>
        <div className={`${styles.numL} tnum ${styles.textIssue}`}>{(r.issue * 100).toFixed(0)}%</div>
        <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 4 }}>
          of slice
        </div>
        <div className={`tnum mono ${styles.textIssue}`} style={{ fontSize: 10.5, marginTop: 4 }}>
          {issTAO.toFixed(3)} TAO
        </div>
      </div>
    );
  }

  /* Languages: only show if we have data. Each pill leads with a
   *  Devicon icon (with colored-letter fallback for langs Devicon
   *  doesn't ship). Same chrome as before, just dot → icon. */
  const langsHtml = r.langs.slice(0, 3).map(([n, p]) => {
    const color = LANG_COLORS[n] ?? 'var(--fg-subtle)';
    const spec = LANG_NAME_ICONS[n.toLowerCase()];
    return (
      <span key={n} className={styles.langPill}>
        <LangIcon
          spec={spec}
          color={color}
          fallbackLetter={n.slice(0, n.length <= 2 ? 1 : 2).toUpperCase()}
          size={12}
          title={n}
        />
        {n} <span className={styles.textFgMute}>{formatLangPct(p)}</span>
      </span>
    );
  });

  /* Activity sparkline (heights normalized to the max bar) */

  /* Credibility from activity */
  const cred =
    r.activity.merged30d + r.activity.closed30d > 0
      ? r.activity.merged30d / (r.activity.merged30d + r.activity.closed30d)
      : 0;
  const credColor =
    cred >= 0.85 ? 'var(--color-moss-400)' :
    cred >= 0.7  ? 'var(--color-enh)' :
    'var(--color-refact)';

  /* Label profile (mirrors HTML's labelChart) */
  let labelChart: React.ReactNode;
  if (r.labels) {
    const allLabels = Object.entries(r.labels);
    const labelCount = allLabels.length;
    labelChart = (
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--softer-border, rgba(255,255,255,0.04))' }}>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--fg-subtle)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Reward by label</span>
          <span style={{ color: 'var(--border-strong)' }}>·</span>
          <span className="mono" style={{ color: 'var(--fg-muted)', textTransform: 'none', letterSpacing: 0 }}>
            {labelCount} configured
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {allLabels.map(([l, v]) => {
            const color = LABEL_COLORS[l] ?? LABEL_COLORS.refactor;
            const isHighlighted = strategy === l;
            const isPenalty = v < 1.0;
            const barPct = Math.min(100, (v / 2.0) * 100);
            return (
              <LabelBarRow
                key={l}
                label={l}
                labelColor={isHighlighted ? color.fg : 'var(--fg-muted)'}
                labelWeight={isHighlighted ? 500 : 400}
                barPct={barPct}
                barBg={isHighlighted ? color.fg : color.soft}
                barOpacity={isPenalty ? 0.6 : undefined}
                barHatch={isPenalty}
                value={`×${v.toFixed(2)}`}
                valueColor={isHighlighted ? color.fg : isPenalty ? 'var(--color-refact)' : 'var(--fg-muted)'}
              />
            );
          })}
          <LabelBarRow
            label="default"
            labelColor="var(--fg-subtle)"
            labelWeight={400}
            labelFontSize={10.5}
            barPct={Math.min(100, (r.defaultLabel / 2) * 100)}
            barBg="var(--border-strong)"
            value={`×${r.defaultLabel.toFixed(2)}`}
            valueColor="var(--fg-subtle)"
            valueFontSize={10.5}
            rowOpacity={0.7}
          />
        </div>
      </div>
    );
  } else {
    /* No per-label multipliers configured — render the canonical bug/
     * enhancement/feature/refactor bars at the repo's defaultLabel value
     * (dimmed) so the card's visual rhythm matches configured-label repos.
     * Each fill uses var(--border-strong) instead of the label's color to
     * make it clear these aren't tuned values. */
    const defaultVal = r.defaultLabel;
    const barPct = Math.min(100, (defaultVal / 2.0) * 100);
    labelChart = (
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--softer-border, rgba(255,255,255,0.04))' }}>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--fg-subtle)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Reward by label</span>
          <span style={{ color: 'var(--border-strong)' }}>·</span>
          <span className="mono" style={{ color: 'var(--fg-muted)', textTransform: 'none', letterSpacing: 0 }}>
            all default
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {LABEL_KEYS.map((l) => {
            const color = LABEL_COLORS[l] ?? LABEL_COLORS.refactor;
            const isHighlighted = strategy === l;
            return (
              <LabelBarRow
                key={l}
                label={l}
                labelColor={isHighlighted ? color.fg : 'var(--fg-muted)'}
                labelWeight={isHighlighted ? 500 : 400}
                barPct={barPct}
                barBg="var(--border-strong)"
                barOpacity={0.7}
                value={`×${defaultVal.toFixed(2)}`}
                valueColor="var(--fg-muted)"
              />
            );
          })}
        </div>
      </div>
    );
  }

  /* Eligibility override row */
  const eligRow = r.eligibility ? (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--color-enh)' }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 9v4M12 17h.01" />
        <circle cx="12" cy="12" r="10" />
      </svg>
      Custom eligibility — gates relaxed (benchmark mode)
    </div>
  ) : null;

  const cls = [
    styles.repoCard,
    r.isSelf ? styles.isSelf : '',
    isSelected ? styles.isSelected : '',
    isBest && !isSelected ? styles.isBest : '',
    isWarn && !isSelected && !isBest ? styles.isWarn : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(`.${styles.compareBtn}`)) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if ((e.target as HTMLElement).closest(`.${styles.compareBtn}`)) return;
        e.preventDefault();
        onOpen();
      }}
    >
      <button
        type="button"
        className={`${styles.compareBtn} ${styles.trackBtn} ${isTracked ? styles.on : ''}`}
        aria-label={isTracked ? `Untrack ${r.fullName}` : `Track ${r.fullName}`}
        title={isTracked ? 'Remove from tracked repos' : 'Track this repo'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleTrack();
        }}
      >
        {isTracked ? <StarFillIcon size={12} /> : <StarIcon size={12} />}
      </button>

      <button
        type="button"
        className={`${styles.compareBtn} ${isSelected ? styles.on : ''}`}
        aria-label={isSelected ? `Remove ${r.fullName} from compare` : `Add ${r.fullName} to compare`}
        title={isSelected ? 'Remove from compare' : 'Add to compare'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleCompare();
        }}
      >
        {isSelected ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingRight: 28 }}>
        <Avatar fullName={r.fullName} size="lg" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className={styles.textFgDim}>{r.owner}/</span>
            <span style={{ fontWeight: 500 }}>{r.name}</span>
            {r.isSelf ? <span className={`${styles.badge} ${styles.badgeSelf}`}>your repo</span> : null}
            {r.trusted ? <span className={`${styles.badge} ${styles.badgeTrusted}`}>trusted</span> : null}
            {r.share === 0 ? <span className={`${styles.badge} ${styles.badgeZero}`}>benchmark</span> : null}
            {r.issue === 1 ? <span className={`${styles.badge} ${styles.badgeIssue}`}>issues only</span> : null}
            {r.issue > 0 && r.issue < 1 ? <span className={`${styles.badge} ${styles.badgeMixed}`}>mixed</span> : null}
            {r.eligibility ? <span className={`${styles.badge} ${styles.badgeOverrides}`}>elig override</span> : null}
            {maintCut > 0 ? (
              <span
                className={`${styles.badge} ${styles.badgeMaint}`}
                title={`${(maintCut * 100).toFixed(0)}% maintainer cut${r.demoMaint ? ' — demo value, not yet set by validators' : ''}`}
              >
                {(maintCut * 100).toFixed(0)}% maintainer cut
                {r.demoMaint ? <span style={{ opacity: 0.6, marginLeft: 2 }}>·demo</span> : null}
              </span>
            ) : null}
          </div>
          {r.description ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--fg-subtle)',
                marginTop: 4,
                lineHeight: 1.4,
                /* Single-line truncation with ellipsis so long READMEs don't
                 * blow out the card height. The full description is still
                 * accessible in the drawer. */
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={r.description}
            >
              {r.description}
            </div>
          ) : null}
          {eligRow}
        </div>
      </div>

      {/* TAO emission headline */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className={`${styles.num2xl} tnum ${r.share === 0 ? styles.textFgFaint : styles.textTao}`}>
            {formatTAO(dailyTAO)}
            <span className={styles.textFgMute} style={{ fontSize: 14, marginLeft: 4 }}>TAO/day</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{(r.share * 100).toFixed(3)}% of pool</span>
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            <span className="mono" style={{ color: 'var(--fg-muted)', textTransform: 'none', letterSpacing: 0 }}>
              {(r.share * OSS_POOL * 100).toFixed(3)}% of total emission
            </span>
          </div>
        </div>
        {effIndicator}
      </div>

      {/* Stream split */}
      {r.share > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              /* Bumped from 10.5px → 11px and --fg-subtle → --fg-muted so the
               * line stays readable against the dark card surface; HTML
               * relied on Tailwind's 'text-fg-mute' (#62666d) but here the
               * project's similar var is too low-contrast at this size. */
              fontSize: 11,
              color: 'var(--fg-muted)',
              marginBottom: 6,
            }}
          >
            <span
              title="How this repo's daily emission (repo_slice) splits — protocol terms are `maintainer_cut`, `PR`, and `issue_discovery`."
            >
              {/* Protocol vocabulary from emission_allocation.py: the
                * repo_slice is split into maintainer_cut + PR + issue
                * discovery. Using the protocol's own short terms instead
                * of invented phrases like "PR rewards" / "issue rewards". */}
              {(() => {
                const parts: string[] = [];
                if (maintPct > 0) parts.push(`${maintPct.toFixed(0)}% maintainer cut`);
                if (prPct > 0)    parts.push(`${prPct.toFixed(0)}% PR`);
                if (issPct > 0)   parts.push(`${issPct.toFixed(0)}% issue discovery`);
                return parts.join(' · ');
              })()}
            </span>
            <span className="mono" style={{ fontSize: 11 }}>
              {maintPct > 0 ? (
                <span className={styles.textMoss}>{formatTAO(maintTAO)} maint</span>
              ) : null}
              {maintPct > 0 && (prTAO > 0 || issTAO > 0) ? ' · ' : ''}
              {prTAO > 0 ? <span className={styles.textPr}>{formatTAO(prTAO)} PR</span> : null}
              {prTAO > 0 && issTAO > 0 ? ' · ' : ''}
              {issTAO > 0 ? <span className={styles.textIssue}>{formatTAO(issTAO)} issue</span> : null}
            </span>
          </div>
          <div className={styles.splitBar}>
            {maintPct > 0 ? <span className={styles.splitMaint} style={{ width: `${maintPct}%` }} /> : null}
            {prPct > 0 ? <span className={styles.splitPr} style={{ width: `${prPct}%` }} /> : null}
            {issPct > 0 ? <span className={styles.splitIss} style={{ width: `${issPct}%` }} /> : null}
          </div>
          {maintPct > 0 ? (
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--fg-subtle)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--color-moss-400)' }} />
              <span>
                {(maintCut * 100).toFixed(0)}% maintainer cut → {r.maintainerCount} maintainer{r.maintainerCount === 1 ? '' : 's'} ·{' '}
                <span className={`mono ${styles.textMoss}`}>{formatTAO(perMaintTAO)} τ/d each</span>
              </span>
              {r.demoMaint ? <span className={styles.demoTag} title="Placeholder value. Real maintainer_cut will be set by validators in master_repositories.json.">demo</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Activity row — three cells share the same 30-day window. Only the
        * leftmost (PR ACTIVITY) carries the "(30d)" qualifier; the other
        * two cells inherit the same window from layout context. */}
      <div className={styles.activityRow}>
        <div>
          <div
            style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}
            title="Merged PRs over the last 30 days, plus active contributor count."
          >
            PR activity (30d)
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className={`mono ${styles.numM} tnum`}>{r.activity.merged30d}</span>
            <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>merged</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>
            <span className="mono tnum">{r.activity.contribs}</span> contributors
          </div>
        </div>
        <div>
          <div
            style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}
            title="Merge rate over the last 30 days = merged ÷ (merged + closed). A forecast of how welcoming the repo is right now."
          >
            Merge rate
          </div>
          <div className={`mono ${styles.numM} tnum`} style={{ color: credColor }}>
            {(cred * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>
            <span className="mono tnum">{r.activity.merged30d + r.activity.closed30d}</span> resolved
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}
            title="Daily contributions over the last 30 days (one bar per day, oldest left). Each bar is split: top portion = PRs submitted, bottom portion = issues registered. Indicator below is this-week vs last-week change in total contributions."
          >
            Contributions
          </div>
          {(() => {
            /* Stacked-bar Contributions chart. Each day shows PRs on top
             * + issues on bottom; bar height is proportional to the day's
             * total (PRs+issues) normalized to the busiest day in the
             * 30-day window. */
            const sparkPr = r.activity.spark;
            const sparkIss = r.activity.sparkIssues;
            const totals = sparkPr.map((v, i) => v + (sparkIss[i] ?? 0));
            const maxTot = Math.max(...totals, 1);
            const hasAny = totals.some((v) => v > 0);
            const sumSlice = (arr: number[], start: number, end?: number) =>
              arr.slice(start, end).reduce((s, v) => s + v, 0);
            const thisWeek = sumSlice(sparkPr, -7) + sumSlice(sparkIss, -7);
            const lastWeek = sumSlice(sparkPr, -14, -7) + sumSlice(sparkIss, -14, -7);
            const wow = (() => {
              if (thisWeek === 0 && lastWeek === 0) {
                return <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>no activity</div>;
              }
              if (lastWeek === 0) {
                return <div style={{ fontSize: 10, color: 'var(--color-feat)', marginTop: 2 }}>↑ new activity</div>;
              }
              const pct = ((thisWeek - lastWeek) / lastWeek) * 100;
              const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
              const color = pct > 0 ? 'var(--color-feat)' : pct < 0 ? 'var(--color-refact)' : 'var(--border-strong)';
              return (
                <div
                  style={{ fontSize: 10, color, marginTop: 2 }}
                  title={`Contributions this week (${thisWeek}) vs last week (${lastWeek})`}
                >
                  {arrow} {pct >= 0 ? '+' : ''}{pct.toFixed(0)}% wow
                </div>
              );
            })();
            return (
              <>
                <div className={styles.spark}>
                  {totals.map((tot, i) => {
                    const pr = sparkPr[i];
                    const iss = sparkIss[i] ?? 0;
                    // Bar height proportional to that day's total vs the
                    // window max; min 2% so non-zero days stay visible.
                    const heightPct = tot > 0 ? Math.max(2, (tot / maxTot) * 100) : 2;
                    // Bottom (issue) fraction expressed as a CSS gradient
                    // stop. Single div + hard-stop linear-gradient
                    // renders as one solid bar split into two color
                    // regions — no nested flex layout, no chance of
                    // sub-pixel rendering splitting it visually into two.
                    const issFracPct = tot > 0 ? (iss / tot) * 100 : 0;
                    return (
                      <div
                        key={i}
                        style={{
                          width: 4,
                          height: `${heightPct}%`,
                          borderRadius: 1,
                          opacity: hasAny ? 1 : 0.3,
                          backgroundImage: `linear-gradient(to top, var(--color-stream-issue) 0%, var(--color-stream-issue) ${issFracPct}%, var(--color-stream-pr) ${issFracPct}%, var(--color-stream-pr) 100%)`,
                        }}
                        title={`${pr} PR${pr === 1 ? '' : 's'} · ${iss} issue${iss === 1 ? '' : 's'}`}
                      />
                    );
                  })}
                </div>
                {wow}
              </>
            );
          })()}
        </div>
      </div>

      {/* Languages — always rendered so card heights stay consistent. Shows
        * a skeleton row while /api/repos/metadata is in flight, a muted
        * "—" if the fetch returned no language data for this repo, and
        * the real pills otherwise. */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 18 }}>
        <span
          style={{
            fontSize: 10,
            color: 'var(--fg-subtle)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginRight: 2,
          }}
        >
          Langs
        </span>
        {langsHtml.length > 0 ? (
          langsHtml
        ) : !metadataLoaded ? (
          <span style={{ fontSize: 10.5, color: 'var(--border-strong)', fontStyle: 'italic' }}>loading…</span>
        ) : (
          <span style={{ fontSize: 10.5, color: 'var(--border-strong)' }}>—</span>
        )}
      </div>

      {labelChart}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * LabelBarRow — explicit inline-grid layout for [label] [bar] [×N.NN].
 *
 * Inlined here rather than relying on `.labelBarRow` from page.module.css
 * because the CSS-module version kept shipping the value column past the
 * card's right edge on narrow mobile widths. Inline styles guarantee the
 * 3-column grid and the 48-px value cell can't be clobbered by stale
 * cached CSS or a higher-specificity rule elsewhere. */
function LabelBarRow({
  label,
  labelColor,
  labelWeight = 400,
  labelFontSize,
  barPct,
  barBg,
  barOpacity,
  barHatch = false,
  value,
  valueColor,
  valueFontSize,
  rowOpacity,
}: {
  label: string;
  labelColor: string;
  labelWeight?: number;
  labelFontSize?: number;
  barPct: number;
  barBg: string;
  barOpacity?: number;
  barHatch?: boolean;
  value: string;
  valueColor: string;
  valueFontSize?: number;
  rowOpacity?: number;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(60px, max-content) minmax(0, 1fr) 48px',
        alignItems: 'center',
        gap: 10,
        fontSize: 11.5,
        width: '100%',
        opacity: rowOpacity,
      }}
    >
      <span
        className="mono"
        style={{
          color: labelColor,
          fontWeight: labelWeight,
          fontSize: labelFontSize,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <div
        style={{
          position: 'relative',
          width: '100%',
          minWidth: 0,
          height: 6,
          borderRadius: 2,
          /* `--border-default` stays darker than both the resting card
           * (--bg-subtle) AND the light-mode hover background (--app-elev,
           * which is identical to --bg-emphasis at #ebebed) so the track
           * never disappears on hover. Was --bg-emphasis which collided
           * with the light-mode hover bg. */
          background: 'var(--border-default)',
          /* No `overflow: hidden` here — the 50% reference tick below
           * extends 2px above and below the 6px track, and clipping would
           * cut that off. The bar fill stays within 0..100% so it doesn't
           * overflow either way. */
        }}
      >
        {/* 50% reference tick (×1.0 marker). HTML's prototype used
          * `.label-bar-track::before` for this — inline styles can't
          * create pseudo-elements, so it's an explicit span. */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: -2,
            bottom: -2,
            width: 1,
            background: 'var(--border-default)',
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${barPct}%`,
            /* Use the non-shorthand backgroundColor so it doesn't conflict
             * with backgroundImage (the hatch pattern). React warns when
             * `background` shorthand and `backgroundImage` coexist on the
             * same element because the shorthand resets every bg-* prop. */
            backgroundColor: barBg,
            opacity: barOpacity,
            borderRadius: 2,
            backgroundImage: barHatch
              ? 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,0,0,0.1) 3px 6px)'
              : undefined,
          }}
        />
      </div>
      <span
        className="mono tnum"
        style={{
          color: valueColor,
          fontSize: valueFontSize,
          textAlign: 'right',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}
