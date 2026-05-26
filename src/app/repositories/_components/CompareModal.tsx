'use client';

import React, { useEffect } from 'react';
import styles from '../page.module.css';
import Avatar from './Avatar';
import { LABEL_COLORS, LABEL_KEYS, LANG_COLORS, formatLangPct } from '../_lib/colors';
import {
  competitionLevel,
  decisionScore,
  effectiveLabelMult,
  eligibilityRisk,
  expectedTAOPerPR,
  formatTAO,
  mergeSpeedLevel,
  openSlotPressure,
  repoDailyTAO,
  repoIssueTAO,
  repoMaintainerTAO,
  repoPerMaintainerTAO,
  repoPRTAO,
  rewardSignal,
  type RepoRow,
  type StrategyKey,
} from '../_lib/incentives';

interface CompareModalProps {
  open: boolean;
  repos: RepoRow[];
  subnetTAO: number;
  strategy: StrategyKey;
  onClose: () => void;
  onRemove: (full: string) => void;
}

export default function CompareModal({ open, repos, subnetTAO, strategy, onClose, onRemove }: CompareModalProps) {
  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC closes — matches HTML's global keydown handler that closed drawer +
  // palette + compare panel together.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const cols = Math.max(1, repos.length);
  // Side-by-side columns: left label rail + N panel columns
  const colStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `minmax(120px, 160px) repeat(${cols}, minmax(170px, 1fr))`,
    gap: 12,
    marginBottom: 12,
  };

  const allLabels = new Set<string>();
  repos.forEach((r) => r.labels && Object.keys(r.labels).forEach((l) => allLabels.add(l)));
  // Show canonical labels first (in protocol-declared order), then any extras.
  const canonicalKeys: string[] = (LABEL_KEYS as readonly string[]).filter((l) => allLabels.has(l));
  const extraKeys: string[] = Array.from(allLabels).filter((l) => !(LABEL_KEYS as readonly string[]).includes(l));
  const labelList: string[] = [...canonicalKeys, ...extraKeys];

  return (
    <>
      <div className={`${styles.backdrop} ${open ? styles.open : ''}`} onClick={onClose} />
      <div className={`${styles.comparePanel} ${open ? styles.open : ''}`} role="dialog" aria-label="Repository comparison">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 24px',
            borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500 }}>
              Side-by-side comparison
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 500, marginTop: 4 }}>Where should I send my next PR?</h3>
          </div>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            <span>Close</span>
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {/* Mobile stacked layout — sticky per-repo tabs + vertical sections */}
          <div className={styles.cmpMobile}>
            <CompareMobile
              repos={repos}
              labelList={labelList}
              strategy={strategy}
              subnetTAO={subnetTAO}
              onRemove={onRemove}
            />
          </div>

          {/* Desktop side-by-side grid (≥768px) */}
          <div className={styles.cmpDesktop}>
          {/* Header row: repo cards */}
          <div style={colStyle}>
            <div />
            {repos.map((r) => (
              <div key={r.fullName} className={styles.panel} style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                    <Avatar fullName={r.fullName} size="md" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>
                        <span className={styles.textFgDim}>{r.owner}/</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.1, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.name}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    style={{ margin: -4, padding: 4 }}
                    onClick={() => onRemove(r.fullName)}
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                  {r.isSelf ? <span className={`${styles.badge} ${styles.badgeSelf}`}>your repo</span> : null}
                  {r.trusted ? <span className={`${styles.badge} ${styles.badgeTrusted}`}>trusted</span> : null}
                  {r.share === 0 ? <span className={`${styles.badge} ${styles.badgeZero}`}>benchmark</span> : null}
                </div>
              </div>
            ))}
          </div>

          <CompareRow label="Daily TAO emission" repos={repos} colStyle={colStyle} render={(r) => (
            <>
              <div className={`${styles.numL} tnum ${r.share === 0 ? styles.textFgFaint : styles.textTao}`}>
                {formatTAO(repoDailyTAO(r, subnetTAO))}
                <span className={styles.textFgMute} style={{ fontSize: 12 }}> τ/day</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 2 }}>{(r.share * 100).toFixed(3)}% × 90% OSS</div>
            </>
          )} />

          <CompareRow label="Maintainer cut" repos={repos} colStyle={colStyle} render={(r) => (
            (r.maintCut || 0) === 0 ? (
              <div style={{ color: 'var(--border-strong)', fontSize: 12 }}>none</div>
            ) : (
              <>
                <div className={`mono tnum ${styles.textMoss}`} style={{ fontSize: 13 }}>{formatTAO(repoMaintainerTAO(r, subnetTAO))}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 2 }}>
                  {(r.maintCut * 100).toFixed(0)}% off the top · {r.maintainerCount} maint ·{' '}
                  <span className={styles.textMoss}>{formatTAO(repoPerMaintainerTAO(r, subnetTAO))} ea</span>
                </div>
                {r.demoMaint ? <span className={styles.demoTag} style={{ marginTop: 6, display: 'inline-flex' }}>demo</span> : null}
              </>
            )
          )} />

          <CompareRow label="PR slice" repos={repos} colStyle={colStyle} render={(r) => (
            r.share === 0 ? (
              <div style={{ color: 'var(--border-strong)', fontSize: 12 }}>—</div>
            ) : (
              <>
                <div className={`mono tnum ${styles.textPr}`} style={{ fontSize: 13 }}>{formatTAO(repoPRTAO(r, subnetTAO))}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 2 }}>
                  {(r.maintCut || 0) > 0
                    ? `${((1 - r.maintCut) * (1 - r.issue) * 100).toFixed(0)}% (after the cut)`
                    : `${((1 - r.issue) * 100).toFixed(0)}% of slice`}
                  {' · TAO/day'}
                </div>
              </>
            )
          )} />

          <CompareRow label="Issue discovery slice" repos={repos} colStyle={colStyle} render={(r) => (
            r.share === 0 || r.issue === 0 ? (
              <div style={{ color: 'var(--border-strong)', fontSize: 12 }}>—</div>
            ) : (
              <>
                <div className={`mono tnum ${styles.textIssue}`} style={{ fontSize: 13 }}>{formatTAO(repoIssueTAO(r, subnetTAO))}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 2 }}>
                  {(r.maintCut || 0) > 0
                    ? `${((1 - r.maintCut) * r.issue * 100).toFixed(0)}% (after the cut)`
                    : `${(r.issue * 100).toFixed(0)}% of slice`}
                  {' · TAO/day'}
                </div>
              </>
            )
          )} />

          <CompareRow label="PR activity · 30d" repos={repos} colStyle={colStyle} render={(r) => (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className={`mono ${styles.numM} tnum`}>{r.activity.merged30d}</span>
                <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>merged</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 4 }}>
                {r.activity.openPRs} open · {r.activity.contribs} contribs
              </div>
            </>
          )} />

          <CompareRow label="Merge rate · 30d" repos={repos} colStyle={colStyle} render={(r) => {
            const cred = r.activity.merged30d + r.activity.closed30d > 0
              ? r.activity.merged30d / (r.activity.merged30d + r.activity.closed30d)
              : 0;
            const color =
              cred >= 0.85 ? 'var(--color-moss-400)' :
              cred >= 0.7  ? 'var(--color-enh)' :
              'var(--color-refact)';
            return (
              <div className={`mono ${styles.numM} tnum`} style={{ color }}>{(cred * 100).toFixed(0)}%</div>
            );
          }} />

          {/* Practical decision factors heading */}
          <div style={{ ...colStyle, marginTop: 24, marginBottom: 8 }}>
            <div style={{ paddingTop: 4, fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500 }}>
              Practical factors
            </div>
            {repos.map((r) => <div key={`spacer-${r.fullName}`} />)}
          </div>

          <CompareRow label="Expected per merged PR" repos={repos} colStyle={colStyle} render={(r) => {
            if (r.share === 0) return <div style={{ color: 'var(--border-strong)', fontSize: 12 }}>—</div>;
            const v = expectedTAOPerPR(r, strategy, subnetTAO);
            return (
              <>
                <div className={`mono ${styles.numM} tnum ${styles.textTao}`}>
                  {formatTAO(v)}<span className={styles.textFgMute} style={{ fontSize: 11 }}> τ</span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 4 }}>
                  ~ pool ÷ merge rate ·{' '}
                  {strategy !== 'none' && strategy !== 'issue'
                    ? `×${effectiveLabelMult(r, strategy).toFixed(2)} ${strategy}`
                    : 'no strategy applied'}
                </div>
              </>
            );
          }} />

          <CompareRow label="Competition density" repos={repos} colStyle={colStyle} render={(r) => {
            const c = competitionLevel(r);
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: c.color }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: c.color }}>{c.label}</span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 4 }}>{c.desc}</div>
              </>
            );
          }} />

          <CompareRow label="Time to merge" repos={repos} colStyle={colStyle} render={(r) => {
            const s = mergeSpeedLevel(r);
            return (
              <>
                <div style={{ fontSize: 13, fontWeight: 500, color: s.color }}>{s.label}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 4 }}>
                  {s.desc} <span className={styles.demoTag} style={{ marginLeft: 4, fontSize: 8.5 }}>demo</span>
                </div>
              </>
            );
          }} />

          <CompareRow label="Eligibility risk" repos={repos} colStyle={colStyle} render={(r) => {
            const e = eligibilityRisk(r);
            return (
              <>
                <div style={{ fontSize: 12, fontWeight: 500, color: e.color }}>{e.level}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 4, lineHeight: 1.3 }}>{e.text}</div>
              </>
            );
          }} />

          <CompareRow label="Your open-PR pressure" repos={repos} colStyle={colStyle} render={(r) => {
            const p = openSlotPressure(r);
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: p.color }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: p.color }}>{p.label}</span>
                  <span className={styles.demoTag} style={{ marginLeft: 4, fontSize: 8.5 }}>demo</span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 4, lineHeight: 1.3 }}>{p.text}</div>
              </>
            );
          }} />

          <CompareRow label="Primary languages" repos={repos} colStyle={colStyle} render={(r) => (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {r.langs.slice(0, 3).map(([n, p]) => (
                <span key={n} className={styles.langPill}>
                  <span className={styles.langDot} style={{ background: LANG_COLORS[n] ?? 'var(--fg-subtle)' }} />
                  {n}<span className={styles.textFgMute}> {formatLangPct(p)}</span>
                </span>
              ))}
              {r.langs.length === 0 ? <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>—</span> : null}
            </div>
          )} />

          {/* Label multipliers section */}
          <div style={{ ...colStyle, marginTop: 24, marginBottom: 8 }}>
            <div style={{ paddingTop: 4, fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500 }}>
              Label multipliers
            </div>
            {repos.map((r) => <div key={`label-spacer-${r.fullName}`} />)}
          </div>

          {labelList.length === 0 ? (
            <div style={colStyle}>
              <div />
              {repos.map((r) => (
                <div key={`nolabel-${r.fullName}`} className={styles.panel} style={{ padding: 12, fontSize: 12, color: 'var(--fg-subtle)' }}>
                  No multipliers configured.
                </div>
              ))}
            </div>
          ) : labelList.map((label) => {
            const color = LABEL_COLORS[label] ?? { fg: 'var(--fg-muted)', soft: 'rgba(146,152,163,0.10)' };
            const highlight = strategy === label;
            return (
              <div key={label} style={{ ...colStyle, marginBottom: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    paddingLeft: 4,
                    fontWeight: highlight ? 500 : 400,
                    color: highlight ? color.fg : 'var(--fg-muted)',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: color.fg }} />
                  <span className="mono" style={{ fontSize: 12 }}>{label}</span>
                </div>
                {repos.map((r) => {
                  const m = r.labels?.[label] ?? r.defaultLabel;
                  const configured = r.labels?.[label] !== undefined;
                  const isPenalty = m < 1;
                  const isHigh = m >= 1.3;
                  const barPct = Math.min(100, (m / 2.0) * 100);
                  return (
                    <div
                      key={`${label}-${r.fullName}`}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
                        background: 'var(--bg-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span
                          className="mono tnum"
                          style={{
                            fontSize: 12,
                            color: isHigh ? color.fg : isPenalty ? 'var(--color-refact)' : configured ? 'var(--fg-default)' : 'var(--fg-subtle)',
                          }}
                        >
                          ×{m.toFixed(2)}
                        </span>
                        {configured ? null : (
                          <span style={{ fontSize: 9.5, color: 'var(--border-strong)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                            default
                          </span>
                        )}
                      </div>
                      <div className={styles.labelBarTrack}>
                        <span
                          className={styles.labelBarFill}
                          style={{
                            left: 0,
                            width: `${barPct}%`,
                            background: configured ? color.fg : 'var(--border-strong)',
                            opacity: isPenalty ? 0.7 : undefined,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          <CompareRow label="Eligibility" repos={repos} colStyle={colStyle} render={(r) => {
            if (r.eligibility) {
              return (
                <>
                  {Object.entries(r.eligibility).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                      <span className={`mono ${styles.textFgMute}`}>{k}</span>
                      <span className={`mono tnum ${styles.textFg}`}>{v}</span>
                    </div>
                  ))}
                </>
              );
            }
            return (
              <div style={{ fontSize: 11.5, color: 'var(--fg-subtle)', lineHeight: 1.5 }}>
                Defaults: <span className={`mono ${styles.textFgDim}`}>3 valid PRs · cred ≥ 0.80</span>
              </div>
            );
          }} />

          <CompareRow label="Trusted pipeline" repos={repos} colStyle={colStyle} render={(r) => (
            r.trusted ? (
              <div className={styles.textIssue} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Yes
              </div>
            ) : (
              <div className={styles.textFgMute} style={{ fontSize: 12 }}>No</div>
            )
          )} />

          {/* Verdict row */}
          <div style={{ ...colStyle, marginTop: 24 }}>
            <div style={{ paddingTop: 8, fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500 }}>
              {strategy === 'none' ? 'For miners' : 'For your strategy'}
            </div>
            {repos.map((r) => (
              <div key={`verdict-${r.fullName}`} className={styles.panel} style={{ padding: 12, fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                <Verdict r={r} strategy={strategy} subnetTAO={subnetTAO} />
              </div>
            ))}
          </div>
          </div>{/* /cmpDesktop */}

          {/* Decision summary sits below both layouts */}
          <DecisionSummary repos={repos} strategy={strategy} subnetTAO={subnetTAO} />
        </div>
      </div>
    </>
  );
}

function CompareRow({
  label,
  repos,
  colStyle,
  render,
}: {
  label: string;
  repos: RepoRow[];
  colStyle: React.CSSProperties;
  render: (r: RepoRow) => React.ReactNode;
}) {
  return (
    <div style={colStyle}>
      <div style={{ paddingTop: 12, fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500, lineHeight: 1.2 }}>
        {label}
      </div>
      {repos.map((r) => (
        <div key={`${label}-${r.fullName}`} className={styles.panel} style={{ padding: 12 }}>
          {render(r)}
        </div>
      ))}
    </div>
  );
}

function Verdict({ r, strategy, subnetTAO }: { r: RepoRow; strategy: StrategyKey; subnetTAO: number }) {
  if (r.share === 0) {
    return <>Benchmark repo — PRs don&apos;t pay TAO. Calibration target only.</>;
  }
  if (strategy === 'issue') {
    if (r.issue === 0) return <>No issue-discovery stream. Skip for issue strategy.</>;
    return (
      <>
        <span className={`mono ${styles.textIssue}`}>{(r.issue * 100).toFixed(0)}%</span> of slice for issues:{' '}
        <span className={`mono ${styles.textTao}`}>{formatTAO(repoIssueTAO(r, subnetTAO))} TAO/day</span> in the issue pool.
      </>
    );
  }
  if (strategy !== 'none') {
    const m = effectiveLabelMult(r, strategy);
    const sig = subnetTAO * rewardSignal(r, strategy);
    if (m >= 1.3) {
      return (
        <>
          <span className={`mono ${styles.textMine}`}>×{m.toFixed(2)}</span> for <span className="mono">{strategy}</span> — premium.
          Max signal: <span className={`mono ${styles.textTao}`}>{formatTAO(sig)} TAO/day</span> if you dominate the repo&apos;s PR scoring.
        </>
      );
    }
    if (m >= 1.0) {
      return (
        <>
          <span className={`mono ${styles.textFg}`}>×{m.toFixed(2)}</span> for <span className="mono">{strategy}</span> — neutral.
          Max signal: <span className={`mono ${styles.textTao}`}>{formatTAO(sig)} TAO/day</span>.
        </>
      );
    }
    if (m >= 0.5) {
      return (
        <>
          <span className={`mono ${styles.textFgDim}`}>×{m.toFixed(2)}</span> for <span className="mono">{strategy}</span> — partial.
          Cap: <span className="mono">{formatTAO(sig)} TAO/day</span>.
        </>
      );
    }
    return (
      <>
        <span className={`mono ${styles.textRefact}`}>×{m.toFixed(2)}</span> for <span className="mono">{strategy}</span> — heavily penalized.
        Cap: <span className="mono">{formatTAO(sig)} TAO/day</span>. Avoid for {strategy} work.
      </>
    );
  }
  if (r.share >= 0.05) {
    return (
      <>
        Top share. <span className={`mono ${styles.textTao}`}>{formatTAO(repoDailyTAO(r, subnetTAO))} TAO/day</span> in the slice, but expect competition.
      </>
    );
  }
  if (r.share >= 0.02) {
    return (
      <>
        Mid-tier. <span className={`mono ${styles.textTao}`}>{formatTAO(repoDailyTAO(r, subnetTAO))} TAO/day</span> — quieter than the top.
      </>
    );
  }
  return (
    <>
      Tail share — <span className={`mono ${styles.textTao}`}>{formatTAO(repoDailyTAO(r, subnetTAO))} TAO/day</span>. Good for credibility-building (3 valid PRs at cred ≥ 0.80).
    </>
  );
}

function DecisionSummary({ repos, strategy, subnetTAO }: { repos: RepoRow[]; strategy: StrategyKey; subnetTAO: number }) {
  const eligible = repos.filter((r) => r.share > 0);
  if (eligible.length < 2) return null;
  const scored = eligible
    .map((r) => ({ repo: r, score: decisionScore(r, strategy, subnetTAO) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const others = scored.slice(1);
  const r = top.repo;

  const reasons: React.ReactNode[] = [];
  const exp = expectedTAOPerPR(r, strategy, subnetTAO);
  if (exp > 0) {
    reasons.push(
      <span key="exp">
        yields ~<span className={`mono ${styles.textTao}`}>{formatTAO(exp)} τ</span> per merged PR
      </span>,
    );
  }
  if (r.activity.medianMergeHours != null && r.activity.medianMergeHours <= 24) {
    reasons.push(
      <span key="merge">
        merges in <span className={`mono ${styles.textFg}`}>~{r.activity.medianMergeHours}h</span>
      </span>,
    );
  }
  const cred = (r.activity.merged30d || 0) / Math.max(1, (r.activity.merged30d || 0) + (r.activity.closed30d || 0));
  if (cred >= 0.85) {
    reasons.push(
      <span key="cred">
        <span className={`mono ${styles.textFg}`}>{(cred * 100).toFixed(0)}%</span> repo merge rate
      </span>,
    );
  }
  if ((r.activity.userOpenPRs || 0) === 0) reasons.push(<span key="slot">no open-PR pressure for you</span>);
  if (strategy !== 'none' && strategy !== 'issue' && effectiveLabelMult(r, strategy) >= 1.25) {
    reasons.push(
      <span key="mult">
        <span className={`mono ${styles.textMine}`}>×{effectiveLabelMult(r, strategy).toFixed(2)}</span> {strategy} multiplier
      </span>,
    );
  }

  return (
    <div
      className={styles.panel}
      style={{
        marginTop: 28,
        padding: 20,
        /* Panel chrome matches the indigo checkmark so the whole
         * "suggested pick" card reads as one brand-accent block. */
        background: 'var(--accent-subtle)',
        borderColor: 'var(--accent-glow)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'var(--accent-subtle)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-tao)" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500 }}>
            Suggested pick
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <Avatar fullName={top.repo.fullName} size="sm" />
            <span style={{ fontSize: 15 }}>
              <span className={styles.textFgDim}>{top.repo.owner}/</span>
              <span style={{ fontWeight: 500 }}>{top.repo.name}</span>
            </span>
          </div>
          {reasons.length > 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 8, lineHeight: 1.5 }}>
              {reasons.map((r2, i) => (
                <React.Fragment key={i}>{i > 0 ? ' · ' : ''}{r2}</React.Fragment>
              ))}
            </div>
          ) : null}
          {others.length > 0 ? (
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
                fontSize: 11.5,
                color: 'var(--fg-subtle)',
              }}
            >
              Runners-up:
              {others.slice(0, 3).map((o, i) => (
                <span key={o.repo.fullName} style={{ marginLeft: 8 }}>
                  <span className={styles.textFgDim}>{o.repo.owner}/</span>
                  {o.repo.name} <span className={`mono ${styles.textFgFaint}`}>({o.score.toFixed(3)})</span>
                  {i < Math.min(others.length, 3) - 1 ? ' ·' : ''}
                </span>
              ))}
            </div>
          ) : null}
          <div style={{ marginTop: 12, fontSize: 10.5, color: 'var(--border-strong)', fontStyle: 'italic' }}>
            Composite score: expected per-PR × merge speed × credibility × open-slot pressure. A heuristic, not a guarantee.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Mobile stacked variant (< 768px)
 *
 * Instead of fighting horizontal scroll, give each repo its own vertical
 * panel with every metric inside. A sticky tab strip at the top jumps
 * between repos via anchor scroll. Ported from `renderCompareMobile` in
 * the HTML prototype.
 * ────────────────────────────────────────────────────────────────────── */
function CompareMobile({
  repos,
  labelList,
  strategy,
  subnetTAO,
  onRemove,
}: {
  repos: RepoRow[];
  labelList: string[];
  strategy: StrategyKey;
  subnetTAO: number;
  onRemove: (full: string) => void;
}) {
  return (
    <>
      <div className={styles.cmpMobileTabs}>
        {repos.map((r, i) => (
          <a key={r.fullName} href={`#cmp-r${i}`} className={styles.cmpMobileTab}>
            <Avatar fullName={r.fullName} size="xs" />
            <span>{r.name}</span>
          </a>
        ))}
      </div>

      <div className={styles.cmpMobileSections}>
        {repos.map((r, i) => {
          const cred =
            r.activity.merged30d + r.activity.closed30d > 0
              ? r.activity.merged30d / (r.activity.merged30d + r.activity.closed30d)
              : 0;
          const credColor =
            cred >= 0.85 ? 'var(--color-moss-400)' :
            cred >= 0.7  ? 'var(--color-enh)' :
            'var(--color-refact)';
          const comp = competitionLevel(r);
          const merge = mergeSpeedLevel(r);
          const pressure = openSlotPressure(r);
          const risk = eligibilityRisk(r);
          return (
            <section key={r.fullName} id={`cmp-r${i}`} className={styles.cmpMobileSection}>
              {/* Repo header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
                  <Avatar fullName={r.fullName} size="lg" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--fg-mute)' }}>{r.owner}/</div>
                    <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.1, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                      {r.isSelf ? <span className={`${styles.badge} ${styles.badgeSelf}`}>your repo</span> : null}
                      {r.trusted ? <span className={`${styles.badge} ${styles.badgeTrusted}`}>trusted</span> : null}
                      {r.share === 0 ? <span className={`${styles.badge} ${styles.badgeZero}`}>benchmark</span> : null}
                      {r.issue === 1 ? <span className={`${styles.badge} ${styles.badgeIssue}`}>issues only</span> : null}
                      {r.issue > 0 && r.issue < 1 ? <span className={`${styles.badge} ${styles.badgeMixed}`}>mixed</span> : null}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  style={{ margin: -4, padding: 8 }}
                  onClick={() => onRemove(r.fullName)}
                  aria-label="Remove from compare"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Headline TAO */}
              <div className={styles.cmpStatCard} style={{ marginBottom: 8 }}>
                <div className={styles.cmpStatLabel}>Daily TAO emission</div>
                <div className={`${styles.numXl} tnum ${r.share === 0 ? styles.textFgFaint : styles.textTao}`} style={{ marginTop: 4 }}>
                  {formatTAO(repoDailyTAO(r, subnetTAO))}
                  <span className={styles.textFgMute} style={{ fontSize: 13 }}> τ/day</span>
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)', marginTop: 4 }}>
                  {(r.share * 100).toFixed(3)}% × 90% OSS
                </div>
              </div>

              {/* Pool grid: maint / activity / PR / issue / credibility */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                {(r.maintCut || 0) > 0 ? (
                  <div className={styles.cmpStatCard}>
                    <div className={styles.cmpStatLabel}>Maintainer cut</div>
                    <div className={`mono ${styles.numM} tnum ${styles.textMoss}`} style={{ marginTop: 4 }}>
                      {formatTAO(repoMaintainerTAO(r, subnetTAO))}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>
                      {(r.maintCut * 100).toFixed(0)}% · {r.maintainerCount} maint
                    </div>
                    <div className={`mono ${styles.textMoss}`} style={{ fontSize: 10, marginTop: 2 }}>
                      {formatTAO(repoPerMaintainerTAO(r, subnetTAO))} ea
                      {r.demoMaint ? <span className={styles.demoTag} style={{ marginLeft: 4 }}>demo</span> : null}
                    </div>
                  </div>
                ) : (
                  <div className={styles.cmpStatCard}>
                    <div className={styles.cmpStatLabel}>Maintainer cut</div>
                    <div style={{ fontSize: 14, color: 'var(--border-strong)', marginTop: 4 }}>none</div>
                  </div>
                )}
                <div className={styles.cmpStatCard}>
                  <div className={styles.cmpStatLabel}>PR activity · 30d</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                    <span className={`mono ${styles.numM} tnum`}>{r.activity.merged30d}</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>merged</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>
                    {r.activity.openPRs} open · {r.activity.contribs} contrib
                  </div>
                </div>
                {r.share > 0 ? (
                  <div className={styles.cmpStatCard}>
                    <div className={styles.cmpStatLabel}>PR slice</div>
                    <div className={`mono ${styles.numM} tnum ${styles.textPr}`} style={{ marginTop: 4 }}>
                      {formatTAO(repoPRTAO(r, subnetTAO))}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>
                      {(r.maintCut || 0) > 0
                        ? `${((1 - r.maintCut) * (1 - r.issue) * 100).toFixed(0)}% (after cut)`
                        : `${((1 - r.issue) * 100).toFixed(0)}% of slice`}
                    </div>
                  </div>
                ) : null}
                {r.share > 0 && r.issue > 0 ? (
                  <div className={styles.cmpStatCard}>
                    <div className={styles.cmpStatLabel}>Issue discovery slice</div>
                    <div className={`mono ${styles.numM} tnum ${styles.textIssue}`} style={{ marginTop: 4 }}>
                      {formatTAO(repoIssueTAO(r, subnetTAO))}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>
                      {(r.maintCut || 0) > 0
                        ? `${((1 - r.maintCut) * r.issue * 100).toFixed(0)}% (after cut)`
                        : `${(r.issue * 100).toFixed(0)}% of slice`}
                    </div>
                  </div>
                ) : null}
                <div className={styles.cmpStatCard}>
                  <div className={styles.cmpStatLabel}>Merge rate · 30d</div>
                  <div className={`mono ${styles.numM} tnum`} style={{ marginTop: 4, color: credColor }}>
                    {(cred * 100).toFixed(0)}%
                  </div>
                </div>
              </div>

              {/* Practical factors */}
              {r.share > 0 ? (
                <>
                  <div className={styles.cmpStatLabel} style={{ marginBottom: 8, marginTop: 12 }}>
                    Practical factors
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div className={styles.cmpStatCard}>
                      <div className={styles.cmpStatLabel}>Per merged PR</div>
                      <div className={`mono ${styles.numM} tnum ${styles.textTao}`} style={{ marginTop: 4 }}>
                        {formatTAO(expectedTAOPerPR(r, strategy, subnetTAO))}
                        <span className={styles.textFgMute} style={{ fontSize: 10 }}> τ</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>expected yield</div>
                    </div>
                    <div className={styles.cmpStatCard}>
                      <div className={styles.cmpStatLabel}>Competition</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: comp.color }} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: comp.color }}>{comp.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>{comp.desc}</div>
                    </div>
                    <div className={styles.cmpStatCard}>
                      <div className={styles.cmpStatLabel}>Time to merge</div>
                      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4, color: merge.color }}>{merge.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2 }}>{merge.desc}</div>
                    </div>
                    <div className={styles.cmpStatCard}>
                      <div className={styles.cmpStatLabel}>Open-PR pressure</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: pressure.color }} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: pressure.color }}>{pressure.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 2, lineHeight: 1.3 }}>
                        {r.activity.userOpenPRs || 0} of your PRs open
                      </div>
                    </div>
                  </div>
                  <div className={styles.cmpStatCard} style={{ marginBottom: 8 }}>
                    <div className={styles.cmpStatLabel}>Eligibility risk</div>
                    <div style={{ fontSize: 12, fontWeight: 500, marginTop: 4, color: risk.color }}>{risk.level}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4, lineHeight: 1.4 }}>{risk.text}</div>
                  </div>
                </>
              ) : null}

              {/* Languages */}
              {r.langs.length > 0 ? (
                <div className={styles.cmpStatCard} style={{ marginBottom: 8 }}>
                  <div className={styles.cmpStatLabel}>Primary languages</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {r.langs.slice(0, 4).map(([n, p]) => (
                      <span key={n} className={styles.langPill}>
                        <span className={styles.langDot} style={{ background: LANG_COLORS[n] ?? 'var(--fg-subtle)' }} />
                        {n}<span className={styles.textFgMute}> {formatLangPct(p)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Label multipliers */}
              {labelList.length > 0 ? (
                <div className={styles.cmpStatCard} style={{ marginBottom: 8 }}>
                  <div className={styles.cmpStatLabel} style={{ marginBottom: 8 }}>Label multipliers</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {labelList.map((label) => {
                      const color = LABEL_COLORS[label] ?? { fg: 'var(--fg-subtle)', soft: '' };
                      const m = r.labels?.[label] ?? r.defaultLabel;
                      const configured = r.labels?.[label] !== undefined;
                      const isPenalty = m < 1;
                      const isHigh = m >= 1.3;
                      const barPct = Math.min(100, (m / 2.0) * 100);
                      const highlight = strategy === label;
                      return (
                        <div
                          key={label}
                          className={styles.labelBarRow}
                          style={{ gridTemplateColumns: '90px 1fr 44px' }}
                        >
                          <span className="mono" style={{ color: highlight ? color.fg : 'var(--fg-muted)' }}>
                            {label}
                          </span>
                          <div className={styles.labelBarTrack}>
                            <span
                              className={styles.labelBarFill}
                              style={{
                                left: 0,
                                width: `${barPct}%`,
                                background: configured ? color.fg : 'var(--border-strong)',
                                opacity: isPenalty ? 0.7 : undefined,
                              }}
                            />
                          </div>
                          <span
                            className="mono tnum"
                            style={{
                              textAlign: 'right',
                              color: isHigh ? color.fg : isPenalty ? 'var(--color-refact)' : configured ? 'var(--fg-default)' : 'var(--fg-subtle)',
                            }}
                          >
                            ×{m.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className={styles.cmpStatCard} style={{ marginBottom: 8, fontSize: 12, color: 'var(--fg-subtle)' }}>
                  No label multipliers configured.
                </div>
              )}

              {/* Verdict */}
              <div className={styles.cmpStatCard}>
                <div className={styles.cmpStatLabel} style={{ marginBottom: 6 }}>
                  {strategy === 'none' ? 'For miners' : 'For your strategy'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                  <Verdict r={r} strategy={strategy} subnetTAO={subnetTAO} />
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
