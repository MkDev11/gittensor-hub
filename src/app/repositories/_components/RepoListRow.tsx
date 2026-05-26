'use client';

import React from 'react';
import { StarFillIcon, StarIcon } from '@primer/octicons-react';
import styles from '../page.module.css';
import Avatar from './Avatar';
import { LABEL_COLORS, LANG_COLORS, LANG_NAME_ICONS, formatLangPct } from '../_lib/colors';
import LangIcon from './LangIcon';
import { effectiveLabelMult, formatTAO, repoDailyTAO, type RepoRow, type StrategyKey } from '../_lib/incentives';

interface RepoListRowProps {
  row: RepoRow;
  subnetTAO: number;
  strategy: StrategyKey;
  isSelected: boolean;
  isBest: boolean;
  isWarn: boolean;
  isTracked: boolean;
  /** Lets the langs cell show "loading…" instead of an empty pill row
   *  while /api/repos/metadata is in flight. */
  metadataLoaded?: boolean;
  onOpen: () => void;
  onToggleCompare: () => void;
  onToggleTrack: () => void;
}

export default function RepoListRow({
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
}: RepoListRowProps) {
  const r = row;
  const dailyTAO = repoDailyTAO(r, subnetTAO);
  // Stream split — matches RepoCard exactly: maintainer cut comes off the
  // top, the remainder splits PR vs issue-discovery. Skip 0% entries so
  // pure-PR repos read "100% PR" instead of "100% PR · 0% issue discovery".
  const maintCut = r.maintCut || 0;
  const afterCut = 1 - maintCut;
  const maintPct = maintCut * 100;
  const prPct = afterCut * (1 - r.issue) * 100;
  const issPct = afterCut * r.issue * 100;
  const streamLabel = (() => {
    const parts: string[] = [];
    if (maintPct > 0) parts.push(`${maintPct.toFixed(0)}% maintainer cut`);
    if (prPct > 0)    parts.push(`${prPct.toFixed(0)}% PR`);
    if (issPct > 0)   parts.push(`${issPct.toFixed(0)}% issue discovery`);
    return parts.join(' · ');
  })();

  // Mult cell — varies by active strategy
  let multCell: React.ReactNode;
  if (strategy === 'issue') {
    multCell =
      r.issue > 0 ? (
        <div style={{ textAlign: 'right' }}>
          <span className={`mono ${styles.numM} tnum ${styles.textIssue}`}>{(r.issue * 100).toFixed(0)}%</span>
        </div>
      ) : (
        <div style={{ textAlign: 'right', color: 'var(--border-strong)' }} className="mono">—</div>
      );
  } else if (strategy !== 'none') {
    const m = effectiveLabelMult(r, strategy);
    const color =
      m >= 1.3 ? 'var(--color-feat)' :
      m >= 1.0 ? 'var(--color-enh)' :
      m >= 0.5 ? 'var(--fg-subtle)' :
      'var(--color-refact)';
    multCell = (
      <div style={{ textAlign: 'right' }}>
        <span className={`mono ${styles.numM} tnum`} style={{ color }}>×{m.toFixed(2)}</span>
      </div>
    );
  } else {
    // No strategy: show highest configured mult, or "—" if no labels
    if (r.labels && Object.keys(r.labels).length > 0) {
      const entries = Object.entries(r.labels);
      const [topLabel, topVal] = entries.reduce((a, b) => (a[1] >= b[1] ? a : b));
      const c = LABEL_COLORS[topLabel] ?? { fg: 'var(--fg-subtle)', soft: '' };
      multCell = (
        <div style={{ textAlign: 'right' }}>
          <div className="mono tnum" style={{ fontSize: 13, color: c.fg }}>×{topVal.toFixed(2)}</div>
          <div style={{ fontSize: 9.5, color: 'var(--border-strong)', marginTop: 2 }}>{topLabel.slice(0, 8)}</div>
        </div>
      );
    } else {
      multCell = (
        <div style={{ textAlign: 'right', color: 'var(--border-strong)', fontSize: 12 }} className="mono">—</div>
      );
    }
  }

  // Languages — top 2 in list mode, each as a full pill badge with
  // Devicon icon + name + percentage (matches the card view's chrome).
  const langsHtml = r.langs.slice(0, 2).map(([n, p]) => {
    const color = LANG_COLORS[n] ?? 'var(--fg-subtle)';
    const spec = LANG_NAME_ICONS[n.toLowerCase()];
    return (
      <span
        key={n}
        className={styles.langPill}
        style={{ fontSize: 10, padding: '1px 5px', flexShrink: 0 }}
      >
        <LangIcon
          spec={spec}
          color={color}
          fallbackLetter={n.slice(0, n.length <= 2 ? 1 : 2).toUpperCase()}
          size={11}
          title={n}
        />
        {n} <span className={styles.textFgMute}>{formatLangPct(p)}</span>
      </span>
    );
  });

  // Mini sparkline
  const maxSpark = Math.max(...r.activity.spark, 1);
  const sparkSlice = r.activity.spark.slice(-12);
  const hasSpark = sparkSlice.some((v) => v > 0);
  const sparkHtml = sparkSlice.map((v, i) => (
    <div
      key={i}
      className={styles.miniSparkBar}
      style={{ height: `${Math.max(2, (v / maxSpark) * 100)}%`, opacity: hasSpark ? 1 : 0.3 }}
    />
  ));

  const cls = [
    styles.repoListRow,
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
      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${styles.compareBtn} ${isTracked ? styles.on : ''}`}
          aria-label={isTracked ? `Untrack ${r.fullName}` : `Track ${r.fullName}`}
          title={isTracked ? 'Remove from tracked repos' : 'Track this repo'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleTrack();
          }}
          style={{ position: 'relative', top: 'auto', right: 'auto' }}
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
          style={{ position: 'relative', top: 'auto', right: 'auto' }}
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
      </div>

      <div className={styles.rowName} style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar fullName={r.fullName} size="sm" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {isBest ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--color-feat)' }}>
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ) : null}
            <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span className={styles.textFgDim}>{r.owner}/</span>
              <span style={{ fontWeight: 500 }}>{r.name}</span>
            </span>
            {r.isSelf ? <span className={`${styles.badge} ${styles.badgeSelf}`} style={{ fontSize: 9.5, padding: '0 4px' }}>you</span> : null}
            {r.trusted ? <span className={`${styles.badge} ${styles.badgeTrusted}`} style={{ fontSize: 9.5, padding: '0 4px' }}>trusted</span> : null}
            {r.share === 0 ? <span className={`${styles.badge} ${styles.badgeZero}`} style={{ fontSize: 9.5, padding: '0 4px' }}>benchmark</span> : null}
            {r.issue === 1 ? <span className={`${styles.badge} ${styles.badgeIssue}`} style={{ fontSize: 9.5, padding: '0 4px' }}>issues only</span> : null}
            {r.issue > 0 && r.issue < 1 ? <span className={`${styles.badge} ${styles.badgeMixed}`} style={{ fontSize: 9.5, padding: '0 4px' }}>mixed</span> : null}
            {r.eligibility ? <span className={`${styles.badge} ${styles.badgeOverrides}`} style={{ fontSize: 9.5, padding: '0 4px' }}>elig</span> : null}
            {(r.maintCut || 0) > 0 ? (
              <span
                className={`${styles.badge} ${styles.badgeMaint}`}
                style={{ fontSize: 9.5, padding: '0 4px' }}
                title={`${(r.maintCut * 100).toFixed(0)}% maintainer cut${r.demoMaint ? ' (demo value, not yet set by validators)' : ''}`}
              >
                {(r.maintCut * 100).toFixed(0)}% cut
                {r.demoMaint ? <span style={{ opacity: 0.6, marginLeft: 2 }}>·demo</span> : null}
              </span>
            ) : null}
          </div>
          {r.description ? (
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.description}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <div className={`${styles.numM} mono tnum ${r.share === 0 ? styles.textFgFaint : styles.textTao}`}>
          {formatTAO(dailyTAO)}
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--fg-subtle)', marginTop: 2 }}>{(r.share * 100).toFixed(2)}% pool</div>
      </div>

      <div className={styles.listColMult}>{multCell}</div>

      <div className={styles.listColStream}>
        {r.share > 0 ? (
          <>
            <div className={styles.miniStream} style={{ marginBottom: 4 }}>
              {prPct > 0 ? <span className={styles.splitPr} style={{ width: `${prPct}%` }} /> : null}
              {issPct > 0 ? <span className={styles.splitIss} style={{ width: `${issPct}%` }} /> : null}
            </div>
            <div
              style={{ fontSize: 10, color: 'var(--fg-subtle)' }}
              className="mono"
              title="Repo emission split (protocol terms: maintainer_cut + PR + issue_discovery)."
            >
              {streamLabel}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--border-strong)' }}>—</div>
        )}
      </div>

      <div
        className={styles.listColLangs}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexWrap: 'wrap',
          minWidth: 0,
        }}
      >
        {langsHtml.length > 0 ? (
          langsHtml
        ) : !metadataLoaded ? (
          <span style={{ fontSize: 10, color: 'var(--border-strong)', fontStyle: 'italic' }}>loading…</span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--border-strong)' }}>—</span>
        )}
      </div>

      <div className={styles.listColAct} style={{ textAlign: 'right' }}>
        <div className="mono tnum" style={{ fontSize: 13, color: 'var(--fg-default)' }}>{r.activity.merged30d}</div>
        <div
          style={{ fontSize: 9.5, color: 'var(--fg-subtle)', marginTop: 2 }}
          title={`${r.activity.contribs} contributors in the last 30 days`}
        >
          {r.activity.contribs} contribs
        </div>
      </div>

      <div className={styles.listColRate} style={{ textAlign: 'right' }}>
        {(() => {
          const resolved = r.activity.merged30d + r.activity.closed30d;
          if (resolved === 0) {
            return <div className="mono" style={{ fontSize: 13, color: 'var(--border-strong)' }}>—</div>;
          }
          const rate = r.activity.merged30d / resolved;
          const rateColor =
            rate >= 0.85 ? 'var(--color-moss-400)' :
            rate >= 0.7  ? 'var(--color-enh)' :
            rate > 0     ? 'var(--color-refact)' :
            'var(--fg-subtle)';
          return (
            <>
              <div className="mono tnum" style={{ fontSize: 13, color: rateColor }} title="Merged ÷ (merged + closed) over the last 30 days.">
                {(rate * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--fg-subtle)', marginTop: 2 }}>{resolved} resolved</div>
            </>
          );
        })()}
      </div>

      <div className={styles.listColSpark}>
        <div className={styles.miniSpark}>{sparkHtml}</div>
      </div>
    </div>
  );
}
