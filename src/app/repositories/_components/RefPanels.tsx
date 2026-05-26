'use client';

/* Reference panels at the bottom of the repositories page. Ported from
 * repositories.html so the React app matches the prototype's structure:
 *   1. ShareFormulaPanel — eligibility mini-cards + interactive formula
 *      bar (click any factor to see its rule) + maintainer-cut callout.
 *   2. LangPanel — filterable language-weights table.
 *   3. PrArchetypePanel — 7 PR archetypes with AST-style code blocks,
 *      per-PR score math, and a raw-token-weights footnote. */

import React, { useMemo, useState } from 'react';
import styles from '../page.module.css';
import { EXT_COLORS, EXT_ICONS, LANGS } from '../_lib/colors';
import LangIcon from './LangIcon';

export default function RefPanels() {
  return (
    <section style={{ padding: '24px 16px 40px' }}>
      <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ShareFormulaPanel />
        <LangPanel />
        <PrArchetypePanel />
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Panel 1: How is each share computed?
 * ─────────────────────────────────────────────────────────────────────── */

interface FormulaFactor {
  key: string;
  value: string;
  tag: string;
  rule: string;
  desc: React.ReactNode;
}

const FORMULA_FACTORS: FormulaFactor[] = [
  {
    key: 'base', value: '25 – 50',
    tag: 'starting value',
    rule: 'base = round(25 × density + bonus, 2)  where  density ≤ 1.15  and  bonus = min(1, token_score / 1500) × 25',
    desc: <>Every eligible merged PR starts here. Two halves: (1) a constant 25 scaled by code density (token_score / lines, capped at 1.15) — denser, more structural PRs land near 25–28; (2) a contribution bonus growing linearly with token_score until it caps at +25 when token_score reaches 1500. So base lands roughly in 25–35 for typical PRs, up to ~50 for very large structural PRs.</>,
  },
  {
    key: 'issue', value: '1.0 – 1.66',
    tag: 'linked-issue bonus',
    rule: '1.00 (no linked issue)  ·  1.33 (community-authored)  ·  1.66 (maintainer-authored)',
    desc: <>A bonus for PRs that close a valid linked issue. Solving an issue authored by a maintainer (OWNER/MEMBER/COLLABORATOR) earns 1.66×; community-authored 1.33×; none 1.00. Anti-gaming gates apply — self-issued issues, issues created after the PR, and incomplete closures don&apos;t count.</>,
  },
  {
    key: 'label', value: 'repo-set',
    tag: 'repo-defined',
    rule: 'label_multipliers[<your_label>]  ·  fallback to default_label_multiplier (usually 1.0)',
    desc: <>Each repo publishes a label-to-multiplier map. <span className="mono">entrius/gittensor</span> uses bug ×1.10, enhancement ×1.25, feature ×1.50, refactor ×0.25. PRs with no matching label fall back to the repo&apos;s default (1.0 globally; some repos set it to 0.0 so unlabeled PRs score zero). Some repos also gate which actors can apply scoring labels via <span className="mono">trusted_label_pipeline</span>.</>,
  },
  {
    key: 'spam', value: '0 or 1',
    tag: 'open-PR cap',
    rule: 'multiplier = 1.0 if open_PRs ≤ threshold,  else 0.0',
    desc: <>Binary on/off. The threshold is per-repo: starts at 2, increases by floor(token_score / 300), capped at 30. Once exceeded on a repo, every new PR there scores 0 until enough close. This is strictly per-repo (not global).</>,
  },
  {
    key: 'decay', value: '0.05 – 1.0',
    tag: 'time-to-merge',
    rule: 'sigmoid(days_since_merge)  ·  12h grace, midpoint 10d, floor 0.05',
    desc: <>Multiplier is 1.0 for the first 12 hours after merge, then decays along a sigmoid. By day 10 the multiplier is ~0.50; by day ~20 it approaches the 0.05 floor. Applies to merged PRs only — open PRs use 1.0. Submit and get merged fast.</>,
  },
  {
    key: 'cred', value: '0.80 – 1.0',
    tag: 'per-repo gate + multiplier',
    rule: 'credibility = merged / (merged + closed)  ·  gates at ≥ 0.80, multiplies as itself',
    desc: <>Computed per-repo from only that repo&apos;s PRs. Two roles: (1) a hard gate — below 0.80, earn nothing from that repo; (2) a continuous multiplier above 0.80 — the credibility value itself (e.g. 0.85, 0.92, 1.0) multiplies every earned_score on that repo. Closed PRs hurt twice: lower the ratio AND don&apos;t earn directly.</>,
  },
  {
    key: 'review', value: '0 – 1.0',
    tag: 'review-quality',
    rule: 'max(0, 1 − 0.15 × N)  where N = maintainer CHANGES_REQUESTED count',
    desc: <>Each &quot;Changes Requested&quot; review from a maintainer cuts 15% off this PR&apos;s multiplier. After 7 review cycles the multiplier floors to 0. Iterating cleanly with reviewers is rewarded; relitigating rejections is punished.</>,
  },
];

function ShareFormulaPanel() {
  const [active, setActive] = useState<string | null>(null);
  const activeFactor = FORMULA_FACTORS.find((f) => f.key === active) ?? null;

  return (
    <details className={styles.refPanel}>
      <summary>
        <Chev />
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>How is each share computed?</span>
        <span className={`mono ${styles.hideOnMobile}`} style={{ fontSize: 11.5, color: 'var(--fg-subtle)', marginLeft: 12 }}>
          subnet · 90% → repo slice · ÷ split · × multipliers → miner
        </span>
        <span className={styles.hideOnMobile} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-subtle)' }}>
          Protocol-wide · applies to every repo
        </span>
      </summary>

      <div style={{ borderTop: '1px solid var(--soft-border, rgba(255,255,255,0.06))', padding: 16 }}>
        {/* Step 1 · Eligibility gates */}
        <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12, fontWeight: 500 }}>
          Step 1 · Eligibility gates
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 8,
            marginBottom: 24,
          }}
        >
          <EligCard
            iconBg="var(--success-subtle)" iconColor="var(--color-stream-pr)"
            iconPath={<><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></>}
            value="≥ 3" label="merged PRs / 30d"
          />
          <EligCard
            iconBg="rgba(95,200,223,0.15)" iconColor="var(--color-stream-issue)"
            iconPath={<><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></>}
            value="≥ 3" label="issues solved"
          />
          <EligCard
            iconBg="var(--attention-subtle)" iconColor="var(--color-enh)"
            iconPath={<path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z"/>}
            value="≥ 80%" label="credibility"
          />
          <EligCard
            iconBg="var(--danger-subtle)" iconColor="var(--color-refact)"
            iconPath={<><circle cx="12" cy="12" r="10"/><path d="M12 9v4M12 17h.01"/></>}
            value="≤ 2" label="open PRs / repo"
          />
          <EligCard
            iconBg="var(--neutral-subtle)" iconColor="var(--fg-subtle)"
            iconPath={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>}
            valueRaw={<span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>overrides</span>}
            label="repo-specific"
          />
        </div>

        {/* Step 2 · Score formula */}
        <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12, fontWeight: 500 }}>
          Step 2 · Score formula
        </div>
        <div className={styles.formulaBar} style={{ marginBottom: 0 }}>
          <span className={`${styles.formulaToken} ${styles.formulaTokenEq}`}>earned =</span>
          {FORMULA_FACTORS.map((f, i) => (
            <React.Fragment key={f.key}>
              {i > 0 ? <span className={styles.formulaOp}>×</span> : null}
              <button
                type="button"
                className={`${styles.formulaToken} ${active === f.key ? styles.formulaTokenActive : ''}`}
                onClick={() => setActive(f.key)}
              >
                <span className={styles.formulaName}>{f.key}</span>
                <span className={`mono ${styles.formulaValue}`}>{f.value}</span>
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className={styles.formulaDetail}>
          {activeFactor == null ? (
            <div className={styles.formulaDetailEmpty}>Tap any factor above to see its rule</div>
          ) : (
            <>
              <div className={styles.formulaDetailTitle}>
                <span className={styles.formulaDetailName}>{activeFactor.key}</span>
                <span className={styles.formulaDetailTag}>{activeFactor.tag}</span>
              </div>
              <div className={`mono ${styles.formulaDetailRule}`}>{activeFactor.rule}</div>
              <div className={styles.formulaDetailDesc}>{activeFactor.desc}</div>
            </>
          )}
        </div>

        {/* Maintainer-cut callout */}
        <div
          style={{
            marginTop: 20,
            padding: 12,
            borderRadius: 6,
            background: 'rgba(158,184,114,0.06)',
            border: '1px dashed rgba(158,184,114,0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-moss-400)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            <div style={{ fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.55 }}>
              <span style={{ color: 'var(--fg-default)', fontWeight: 500 }}>Outside this formula</span>, at TAO emission time, repos with a <span className="mono">maintainer_cut</span> carve that fraction off the repo&apos;s emission slice and split it evenly among registered maintainer miners. The <span className="mono">earned_score</span> above competes for the remaining <span className="mono">(1 − maintainer_cut)</span> of the slice.
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

function EligCard({
  iconBg, iconColor, iconPath, value, valueRaw, label,
}: {
  iconBg: string; iconColor: string; iconPath: React.ReactNode;
  value?: string; valueRaw?: React.ReactNode; label: string;
}) {
  return (
    <div className={styles.checkCardMini}>
      <div className={styles.checkCardMiniIcon} style={{ background: iconBg, color: iconColor }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {iconPath}
        </svg>
      </div>
      <div style={{ minWidth: 0 }}>
        {valueRaw ?? (
          <div className="mono" style={{ color: 'var(--fg-default)', fontSize: 13 }}>{value}</div>
        )}
        <div style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{label}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Panel 2: Language weights
 * ─────────────────────────────────────────────────────────────────────── */

function LangPanel() {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    let list = LANGS;
    if (needle) list = list.filter(([ext, , lang]) => ext.includes(needle) || (lang ?? '').includes(needle));
    if (!showAll) list = list.slice(0, 30);
    return list;
  }, [q, showAll]);

  return (
    <details className={styles.refPanel}>
      <summary>
        <Chev />
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Language weights</span>
        <span className={`mono ${styles.hideOnMobile}`} style={{ fontSize: 11.5, color: 'var(--fg-subtle)', marginLeft: 12 }}>
          {LANGS.length} extensions · 0.08 – 2.0
        </span>
        <span className={styles.hideOnMobile} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-subtle)' }}>
          Higher = more reward per merged byte
        </span>
      </summary>
      <div style={{ borderTop: '1px solid var(--soft-border, rgba(255,255,255,0.06))', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Filter…"
            className={styles.input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className={styles.secBtn} onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show top 30' : `Show all (${LANGS.length})`}
          </button>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            border: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: 16, gridColumn: '1 / -1', fontSize: 12.5, color: 'var(--fg-subtle)', textAlign: 'center' }}>
              No matches.
            </div>
          ) : (
            filtered.map(([ext, w, lang]) => (
              <LangRow key={ext} ext={ext} weight={w} lang={lang} />
            ))
          )}
        </div>
      </div>
    </details>
  );
}

function LangRow({ ext, weight, lang }: { ext: string; weight: number; lang: string | null }) {
  const color = EXT_COLORS[ext.toLowerCase()] ?? 'var(--fg-subtle)';
  const weightColor =
    weight >= 1.5 ? 'var(--color-feat)' :
    weight >= 1.0 ? 'var(--fg-default)' :
    weight >= 0.5 ? 'var(--fg-muted)' :
    'var(--fg-subtle)';
  const iconSpec = EXT_ICONS[ext.toLowerCase()];
  const fallbackLetter = ext.slice(0, ext.length <= 2 ? 1 : 2).toUpperCase();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRight: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
        borderBottom: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
      }}
    >
      <LangIcon spec={iconSpec} color={color} fallbackLetter={fallbackLetter} size={18} title={lang ?? ext} />
      <span
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10.5,
          fontWeight: 500,
          padding: '1.5px 6px',
          borderRadius: 3,
          border: `1px solid ${color}55`,
          background: `${color}1a`,
          color,
          lineHeight: 1.4,
          minWidth: 52,
          textAlign: 'center',
          flexShrink: 0,
        }}
        title={lang ?? 'file extension'}
      >
        .{ext}
      </span>
      <span
        style={{
          fontSize: 12,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: lang ? undefined : 'var(--fg-subtle)',
        }}
      >
        {lang ?? '<file>'}
      </span>
      <span className="mono tnum" style={{ fontSize: 12, color: weightColor }}>
        {weight.toFixed(2)}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Panel 3: What kinds of PRs earn most? — PR archetype showcase
 * ─────────────────────────────────────────────────────────────────────── */

interface MathRow { label: React.ReactNode; value: React.ReactNode; tone?: 'mine' | 'fg' | 'mute' | 'refact'; }
interface Archetype {
  iconBg: string; iconColor: string; iconPath: React.ReactNode;
  title: React.ReactNode;
  score: string; loc: string; perLoc: string;
  scoreTone: 'mine' | 'fg' | 'refact';
  effPct: number; effColor: string; effLabel: string; effLabelTone: 'mine' | 'fg' | 'mute' | 'refact';
  code: React.ReactNode;
  math: MathRow[]; total: React.ReactNode; totalTone: 'mine' | 'fg' | 'refact';
  note: React.ReactNode; noteWarn?: boolean;
}

function PrArchetypePanel() {
  return (
    <details className={styles.refPanel}>
      <summary>
        <Chev />
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>What kinds of PRs earn most?</span>
        <span className={styles.hideOnMobile} style={{ fontSize: 11.5, color: 'var(--fg-subtle)', marginLeft: 12 }}>
          score per line of code, by contribution type
        </span>
        <span className={styles.hideOnMobile} style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>
          verified against <span className="mono">tree_sitter_scoring.py</span>
        </span>
      </summary>

      <div style={{ borderTop: '1px solid var(--soft-border, rgba(255,255,255,0.06))', padding: 16 }}>
        <p style={{ fontSize: 12, color: 'var(--fg-dim)', lineHeight: 1.6, marginBottom: 16, maxWidth: '48rem' }}>
          The tokenizer scores <span style={{ color: 'var(--fg-default)' }}>added + deleted</span> AST nodes between old and new versions of each file. <span style={{ color: 'var(--fg-default)' }}>Test files</span> are multiplied by <span className={`mono ${styles.textRefact}`}>0.05</span>. <span style={{ color: 'var(--fg-default)' }}>Non-code files</span> (.md, .yaml, .json, .toml, .ini, etc.) use line-count scoring with a per-language weight — they&apos;re not zero. For miners the actionable question is: <span style={{ color: 'var(--fg-default)' }}>which kind of contribution earns most per hour</span>.
        </p>

        {/* Counterintuitive findings banner */}
        <div
          style={{
            marginBottom: 20,
            padding: 12,
            borderRadius: 6,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            fontSize: 11.5,
            background: 'rgba(234,179,8,0.04)',
            border: '1px solid rgba(234,179,8,0.20)',
          }}
        >
          <Finding>
            <strong style={{ color: 'var(--fg-default)' }}>Tests pay 0.05×.</strong> A test file with the same AST as a source file earns <span className={styles.textRefact}>1/20th</span> the score.
          </Finding>
          <Finding>
            <strong style={{ color: 'var(--fg-default)' }}>YAML / docs aren&apos;t zero.</strong> 100 lines of <span className="mono">.md</span> = ~8 points (0.08/line). 40 lines of <span className="mono">.yaml</span> = ~40 points.
          </Finding>
          <Finding>
            <strong style={{ color: 'var(--fg-default)' }}>Deletions add to score.</strong> Removing a function is worth as much as adding one. Refactors are undervalued by intuition.
          </Finding>
        </div>

        {/* Archetype table */}
        <div className={styles.prArchetypes}>
          <div className={`${styles.prArchetypeRow} ${styles.prArchetypeHead}`}>
            <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500 }}>Contribution type</span>
            <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500, textAlign: 'right' }}>est. score</span>
            <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500, textAlign: 'right' }}>LOC</span>
            <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500, textAlign: 'right' }}>per LOC</span>
            <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500, paddingLeft: 12 }}>Efficiency</span>
          </div>

          {ARCHETYPES.map((a, i) => (
            <ArchetypeCard key={i} a={a} />
          ))}
        </div>

        {/* Strategic takeaway */}
        <div style={{ marginTop: 20, padding: 14, borderRadius: 6, background: 'rgba(127,185,146,0.05)', border: '1px solid rgba(127,185,146,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-stream-pr)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <div style={{ fontSize: 12, color: 'var(--fg-dim)', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--fg-default)' }}>Strategy:</strong> Aim for <span style={{ color: 'var(--fg-default)' }}>small focused PRs that add structure to source files</span> — a new class, an extracted function, a guard-clause bug fix. These hit the 5-score eligibility threshold reliably and have the best score-per-LOC ratio. <span style={{ color: 'var(--fg-dim)' }}>Avoid putting structural work into <span className="mono">test_*.py</span> files (0.05× penalty).</span> A YAML/TOML config edit can be surprisingly competitive per-LOC, but a docs-only PR has to be substantial to qualify.
            </div>
          </div>
        </div>

        {/* Tiny technical footnote */}
        <details style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--softer-border, rgba(255,255,255,0.04))' }}>
          <summary style={{ fontSize: 10.5, color: 'var(--fg-subtle)', cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Chev small />
            Show raw token weights (from <span className="mono">token_weights.json</span>)
          </summary>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--fg-muted)' }}>Structural:</strong>{' '}
            <span className="mono" style={{ color: 'var(--fg-default)' }}>class_definition</span> 2.5 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-default)' }}>function_definition</span> 2.0 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>interface/struct/impl</span> 1.75 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>enum/trait/async_fn</span> 1.5 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>arrow_function</span> 0.75 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>call_expression</span> 0.55 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>for_statement</span> 0.5 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>lambda</span> 0.5 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>switch/match</span> 0.3–0.4 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>if/return/while</span> 0.35–0.40 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>assignment</span> 0.20 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>try/catch/raise</span> 0.10–0.20.
            <br/><br/>
            <strong style={{ color: 'var(--fg-muted)' }}>Leaf:</strong>{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>super</span> 0.20 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>self/this/type_id</span> 0.15 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>boolean/null/operator</span> 0.10 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>identifier/field_id</span> 0.07 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>int/float/string</span> 0.03 ·{' '}
            <span className={`mono ${styles.textRefact}`}>comment</span> 0.00.
            <br/><br/>
            <strong style={{ color: 'var(--fg-muted)' }}>File-level multipliers:</strong>{' '}
            <span className={`mono ${styles.textRefact}`}>TEST_FILE_CONTRIBUTION_WEIGHT</span> = 0.05 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>MAX_LINES_SCORED_FOR_NON_CODE_EXT</span> = 300 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>total_score = added + deleted</span>.
            <br/><br/>
            <strong style={{ color: 'var(--fg-muted)' }}>Non-code language weights:</strong>{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>.yaml</span> 1.0 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-muted)' }}>.toml/.ini/.cfg</span> 0.5 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>.json</span> 0.1 ·{' '}
            <span className="mono" style={{ color: 'var(--fg-subtle)' }}>.md/.mdx</span> 0.08.
          </div>
        </details>
      </div>
    </details>
  );
}

function Finding({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-enh)" strokeWidth="2.2" style={{ flexShrink: 0, marginTop: 2 }}>
        <path d="M12 9v4M12 17h.01"/>
        <circle cx="12" cy="12" r="10"/>
      </svg>
      <div style={{ color: 'var(--fg-dim)', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function ArchetypeCard({ a }: { a: Archetype }) {
  const toneColor = (t?: MathRow['tone']) =>
    t === 'mine' ? 'var(--color-mine)' :
    t === 'refact' ? 'var(--color-refact)' :
    t === 'mute' ? 'var(--fg-subtle)' :
    'var(--fg-default)';
  const scoreColor =
    a.scoreTone === 'mine' ? 'var(--color-mine)' :
    a.scoreTone === 'refact' ? 'var(--color-refact)' :
    'var(--fg-default)';
  const totalColor = toneColor(a.totalTone);
  const effLabelColor = toneColor(a.effLabelTone);

  return (
    <details className={styles.prArchetypeCard}>
      <summary className={styles.prArchetypeRow}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <svg className="chev" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" style={{ color: 'var(--border-strong)', flexShrink: 0 }}>
            <path d="m9 18 6-6-6-6"/>
          </svg>
          <span className={styles.prArchetypeIcon} style={{ background: a.iconBg, color: a.iconColor }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{a.iconPath}</svg>
          </span>
          <span style={{ fontSize: 13, color: 'var(--fg-default)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
        </span>
        <span className="mono tnum" style={{ color: scoreColor, textAlign: 'right', fontSize: 13 }}>{a.score}</span>
        <span className="mono tnum" style={{ color: 'var(--fg-dim)', textAlign: 'right', fontSize: 12.5 }}>{a.loc}</span>
        <span className="mono tnum" style={{ color: scoreColor, textAlign: 'right', fontSize: 13 }}>{a.perLoc}</span>
        <div style={{ paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div className={styles.prEffbar}>
            <div className={styles.prEffbarFill} style={{ width: `${a.effPct}%`, background: a.effColor }} />
          </div>
          <span className="mono" style={{ fontSize: 10.5, color: effLabelColor, flexShrink: 0 }}>{a.effLabel}</span>
        </div>
      </summary>
      <div className={styles.prArchetypeDetail}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16 }}>
          <pre className={styles.astCodeBlock}><code>{a.code}</code></pre>
          <div className={styles.prArchetypeMath}>
            {a.math.map((m, i) => (
              <div key={i} className={`${styles.prMathRow} mono`} style={{ color: toneColor(m.tone) }}>
                <span>{m.label}</span>
                <span className="tnum">{m.value}</span>
              </div>
            ))}
            <div className={styles.prMathDivider} />
            <div className={`${styles.prMathRow} ${styles.prMathTotal}`}>
              <span style={{ color: 'var(--fg-default)', fontSize: 12.5 }}>Total</span>
              <span className="mono tnum" style={{ color: totalColor, fontSize: 13 }}>{a.total}</span>
            </div>
          </div>
        </div>
        <div className={`${styles.prArchetypeNote} ${a.noteWarn ? styles.prArchetypeNoteWarn : ''}`}>
          {a.note}
        </div>
      </div>
    </details>
  );
}

/* ─── PR archetype data — same 7 cards as the HTML prototype ───────── */

const ARCHETYPES: Archetype[] = [
  // 1. NEW MODULE
  {
    iconBg: 'var(--success-subtle)', iconColor: 'var(--color-feat)',
    iconPath: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>,
    title: 'New module / class with methods',
    score: '~11', loc: '60', perLoc: '0.18', scoreTone: 'mine',
    effPct: 100, effColor: 'var(--color-feat)', effLabel: 'peak', effLabelTone: 'mine',
    code: (
      <><span className={styles.astTkClass}>class</span> <span className={styles.astTkId}>RateLimiter</span>:{'\n'}
    <span className={styles.astTkFn}>def</span> <span className={styles.astTkId}>__init__</span>(<span className={styles.astTkKeyword}>self</span>, <span className={styles.astTkId}>cap</span>: <span className={styles.astTkId}>int</span>):{'\n'}
        <span className={styles.astTkKeyword}>self</span>.<span className={styles.astTkId}>cap</span> = <span className={styles.astTkId}>cap</span>{'\n\n'}
    <span className={styles.astTkFn}>def</span> <span className={styles.astTkId}>allow</span>(<span className={styles.astTkKeyword}>self</span>) -&gt; <span className={styles.astTkKeyword}>bool</span>:{'\n'}
        <span className={styles.astTkReturn}>return</span> <span className={styles.astTkCall}>self.count</span>() &lt; <span className={styles.astTkKeyword}>self</span>.<span className={styles.astTkId}>cap</span>{'\n\n'}
    <span className={styles.astTkFn}>def</span> <span className={styles.astTkId}>count</span>(<span className={styles.astTkKeyword}>self</span>) -&gt; <span className={styles.astTkId}>int</span>:{'\n'}
        <span className={styles.astTkReturn}>return</span> <span className={styles.astTkCall}>len</span>(<span className={styles.astTkKeyword}>self</span>.<span className={styles.astTkId}>window</span>)</>
    ),
    math: [
      { label: 'class_definition',           value: '1 × 2.5 = 2.50', tone: 'mine' },
      { label: 'function_definition × 3',    value: '3 × 2.0 = 6.00', tone: 'mine' },
      { label: 'return_statement × 2',       value: '2 × 0.35 = 0.70', tone: 'mute' },
      { label: 'call_expression × 2',        value: '2 × 0.55 = 1.10', tone: 'mute' },
      { label: 'leaf tokens (self, ids)',    value: '+ ~0.70', tone: 'mute' },
    ],
    total: '~11.00', totalTone: 'mine',
    note: <><strong style={{ color: 'var(--fg-default)' }}>Why it wins:</strong> Three function definitions × 2.0 + one class × 2.5 = 8.5 from structural tokens alone. Even a small new module clears the 5-score eligibility threshold twice over.</>,
  },
  // 2. REFACTOR
  {
    iconBg: 'var(--success-subtle)', iconColor: 'var(--color-feat)',
    iconPath: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    title: 'Refactor · extract function (add + delete)',
    score: '~6.4', loc: '40', perLoc: '0.16', scoreTone: 'mine',
    effPct: 90, effColor: 'var(--color-feat)', effLabel: 'high', effLabelTone: 'mine',
    code: (
      <><span className={styles.astTkComment}># Extracted from handle_request() to reduce nesting</span>{'\n'}
<span className={styles.astTkFn}>def</span> <span className={styles.astTkId}>validate_payload</span>(<span className={styles.astTkId}>data</span>: <span className={styles.astTkId}>dict</span>) -&gt; <span className={styles.astTkKeyword}>bool</span>:{'\n'}
    <span className={styles.astTkIf}>if</span> <span className={styles.astTkCall}>not</span> <span className={styles.astTkId}>data</span>:{'\n'}
        <span className={styles.astTkReturn}>return</span> <span className={styles.astTkKeyword}>False</span>{'\n'}
    <span className={styles.astTkIf}>if</span> <span className={styles.astTkLeaf}>&quot;id&quot;</span> <span className={styles.astTkCall}>not in</span> <span className={styles.astTkId}>data</span>:{'\n'}
        <span className={styles.astTkReturn}>return</span> <span className={styles.astTkKeyword}>False</span>{'\n'}
    <span className={styles.astTkReturn}>return</span> <span className={styles.astTkKeyword}>True</span></>
    ),
    math: [
      { label: 'added: function_definition',  value: '1 × 2.0 = 2.00', tone: 'mine' },
      { label: 'added: if_statement × 2',     value: '2 × 0.35 = 0.70', tone: 'mute' },
      { label: 'added: return × 3',           value: '3 × 0.35 = 1.05', tone: 'mute' },
      { label: 'added: call × 2 + leaves',    value: '+ 1.30', tone: 'mute' },
      { label: 'deleted: nodes from original',value: '+ ~1.40', tone: 'mute' },
    ],
    total: '~6.45', totalTone: 'mine',
    note: <><strong style={{ color: 'var(--fg-default)' }}>Why it&apos;s higher than intuition says:</strong> Both <span style={{ color: 'var(--fg-default)' }}>added and deleted</span> AST nodes count toward the score (<span className="mono">total_score = added + deleted</span>). When you extract a function, you add structure in one place AND remove structure from another — both are scored. Refactors are systematically undervalued by gut feel.</>,
  },
  // 3. BUG FIX
  {
    iconBg: 'var(--danger-subtle)', iconColor: 'var(--color-bug)',
    iconPath: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>,
    title: 'Bug fix · small focused change',
    score: '~2.0', loc: '15', perLoc: '0.13', scoreTone: 'fg',
    effPct: 72, effColor: 'var(--color-stream-pr)', effLabel: 'solid', effLabelTone: 'fg',
    code: (
      <><span className={styles.astTkFn}>def</span> <span className={styles.astTkId}>divide</span>(<span className={styles.astTkId}>a</span>, <span className={styles.astTkId}>b</span>):{'\n'}
<span className={styles.astTkComment}>-    return a / b</span>{'\n'}
+    <span className={styles.astTkIf}>if</span> <span className={styles.astTkId}>b</span> == <span className={styles.astTkLeaf}>0</span>:{'\n'}
+        <span className={styles.astTkCall}>raise</span> <span className={styles.astTkCall}>ValueError</span>(<span className={styles.astTkLeaf}>&quot;div by zero&quot;</span>){'\n'}
+    <span className={styles.astTkReturn}>return</span> <span className={styles.astTkId}>a</span> / <span className={styles.astTkId}>b</span></>
    ),
    math: [
      { label: 'added: if_statement',         value: '1 × 0.35 = 0.35', tone: 'fg' },
      { label: 'added: return_statement',     value: '1 × 0.35 = 0.35', tone: 'mute' },
      { label: 'added: call_expression × 2',  value: '2 × 0.55 = 1.10', tone: 'fg' },
      { label: 'leaves (ids, literals)',      value: '+ 0.30', tone: 'mute' },
    ],
    total: '~2.10', totalTone: 'fg',
    note: <><strong style={{ color: 'var(--fg-default)' }}>Doesn&apos;t clear the 5-threshold alone</strong> — but at 0.13/LOC it&apos;s genuinely efficient. Bundle 2–3 small fixes in one PR and you&apos;re comfortably above the threshold with low effort.</>,
  },
  // 4. YAML CONFIG
  {
    iconBg: 'var(--attention-subtle)', iconColor: 'var(--color-enh)',
    iconPath: <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>,
    title: 'YAML / config edit (40 lines)',
    score: '~8.0', loc: '40', perLoc: '0.20', scoreTone: 'fg',
    effPct: 78, effColor: 'var(--color-stream-pr)', effLabel: 'surprising', effLabelTone: 'fg',
    code: (
      <><span className={styles.astTkComment}># .github/workflows/ci.yml</span>{'\n'}
<span className={styles.astTkId}>jobs</span>:{'\n'}
  <span className={styles.astTkId}>test</span>:{'\n'}
    <span className={styles.astTkId}>runs-on</span>: <span className={styles.astTkLeaf}>ubuntu-latest</span>{'\n'}
    <span className={styles.astTkId}>strategy</span>:{'\n'}
      <span className={styles.astTkId}>matrix</span>:{'\n'}
        <span className={styles.astTkId}>python</span>: [<span className={styles.astTkLeaf}>&quot;3.11&quot;</span>, <span className={styles.astTkLeaf}>&quot;3.12&quot;</span>]{'\n'}
    <span className={styles.astTkId}>steps</span>:{'\n'}
      - <span className={styles.astTkId}>uses</span>: <span className={styles.astTkLeaf}>actions/checkout@v4</span>{'\n'}
      ...</>
    ),
    math: [
      { label: '.yaml language weight',       value: '1.0', tone: 'fg' },
      { label: 'lines changed',               value: '40', tone: 'mute' },
      { label: 'file_weight (not a test)',    value: '1.0', tone: 'mute' },
    ],
    total: '1.0 × 40 × 1.0 = 8.00', totalTone: 'fg',
    note: <><strong style={{ color: 'var(--fg-default)' }}>Counterintuitive:</strong> non-code files use <span className="mono">lang_weight × lines × file_weight</span> with a 300-line cap. <span className="mono">.yaml</span> has weight 1.0 (high), <span className="mono">.md</span> 0.08, <span className="mono">.json</span> 0.1, <span className="mono">.toml</span> 0.5. A meaningful CI workflow edit can outscore a small Python class.</>,
  },
  // 5. PYTHON CONSTANTS
  {
    iconBg: 'var(--neutral-subtle)', iconColor: 'var(--fg-subtle)',
    iconPath: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    title: 'Python constants / module-level config',
    score: '~1.8', loc: '40', perLoc: '0.05', scoreTone: 'fg',
    effPct: 25, effColor: 'var(--color-moss-400)', effLabel: 'modest', effLabelTone: 'mute',
    code: (
      <><span className={styles.astTkComment}># Tune rate limiter for production</span>{'\n'}
<span className={styles.astTkId}>MAX_REQUESTS_PER_SEC</span> = <span className={styles.astTkLeaf}>120</span>{'\n'}
<span className={styles.astTkId}>WINDOW_MS</span> = <span className={styles.astTkLeaf}>60000</span>{'\n'}
<span className={styles.astTkId}>RETRY_AFTER_SEC</span> = <span className={styles.astTkLeaf}>5</span>{'\n'}
<span className={styles.astTkId}>BURST_ALLOWANCE</span> = <span className={styles.astTkLeaf}>1.5</span>{'\n'}
<span className={styles.astTkId}>FAILURE_THRESHOLD</span> = <span className={styles.astTkLeaf}>10</span>{'\n'}
<span className={styles.astTkId}>CIRCUIT_BREAK_AFTER</span> = <span className={styles.astTkLeaf}>3</span></>
    ),
    math: [
      { label: 'assignment × 6',           value: '6 × 0.20 = 1.20', tone: 'mute' },
      { label: 'identifier × 6',           value: '6 × 0.07 = 0.42', tone: 'mute' },
      { label: 'integer × 6',              value: '6 × 0.03 = 0.18', tone: 'mute' },
      { label: 'comment',                  value: '0 × 0.00',         tone: 'refact' },
    ],
    total: '~1.80', totalTone: 'fg',
    note: <><strong style={{ color: 'var(--fg-default)' }}>Better than nothing, worse than YAML:</strong> Python&apos;s tokenizer scores constants via the AST path — <span className="mono">assignment</span> node at 0.20 + leaves. Six constants → ~1.8. The same data as a YAML file would score ~6 (lang_weight 1.0 × 6 lines). <span style={{ color: 'var(--fg-dim)' }}>If you have constants to add, prefer YAML/TOML over Python.</span></>,
  },
  // 6. TESTS
  {
    iconBg: 'rgba(95,200,223,0.12)', iconColor: 'var(--color-stream-issue)',
    iconPath: <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
    title: <>Tests · written in <span className={`mono ${styles.textRefact}`}>test_*.py</span></>,
    score: '~0.5', loc: '80', perLoc: '0.006', scoreTone: 'refact',
    effPct: 4, effColor: 'var(--color-refact)', effLabel: 'penalty', effLabelTone: 'refact',
    code: (
      <><span className={styles.astTkFn}>def</span> <span className={styles.astTkId}>test_rate_limiter_blocks_at_cap</span>():{'\n'}
    <span className={styles.astTkId}>rl</span> = <span className={styles.astTkCall}>RateLimiter</span>(<span className={styles.astTkLeaf}>5</span>){'\n'}
    <span className={styles.astTkIf}>for</span> <span className={styles.astTkId}>_</span> <span className={styles.astTkKeyword}>in</span> <span className={styles.astTkCall}>range</span>(<span className={styles.astTkLeaf}>5</span>):{'\n'}
        <span className={styles.astTkCall}>rl.tick</span>(){'\n'}
    <span className={styles.astTkCall}>assert</span> <span className={styles.astTkCall}>rl.allow</span>() == <span className={styles.astTkKeyword}>False</span></>
    ),
    math: [
      { label: 'AST score (if not a test)',          value: '~10.3', tone: 'mute' },
      { label: '× TEST_FILE_CONTRIBUTION_WEIGHT',    value: '× 0.05', tone: 'refact' },
    ],
    total: '~0.52', totalTone: 'refact',
    noteWarn: true,
    note: (
      <>
        <strong className={styles.textRefact}>Counterintuitive penalty.</strong> The protocol explicitly devalues test files at <span className="mono">TEST_FILE_CONTRIBUTION_WEIGHT = 0.05</span>. This prevents miners from gaming the system by writing trivial assertions. Tests are detected by filename pattern (<span className="mono">test_*.py</span>, <span className="mono">*_test.go</span>, etc.) plus inline-test patterns for Rust/Zig/D.
        <br/><br/>
        <strong style={{ color: 'var(--fg-default)' }}>Strategic implication:</strong> still write tests — they help <span style={{ color: 'var(--fg-default)' }}>merge credibility</span> (gates eligibility ≥ 0.80) and help reviewers approve faster. But don&apos;t expect them to carry token_score.
      </>
    ),
  },
  // 7. DOCS / MARKDOWN
  {
    iconBg: 'var(--neutral-subtle)', iconColor: 'var(--fg-subtle)',
    iconPath: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    title: 'Markdown docs (.md)',
    score: '~8.0', loc: '100', perLoc: '0.08', scoreTone: 'fg',
    effPct: 44, effColor: 'var(--color-moss-400)', effLabel: 'modest', effLabelTone: 'mute',
    code: (
      <><span className={styles.astTkId}>## API Reference</span>{'\n\n'}
The <span className={styles.astTkCall}>`RateLimiter`</span> class provides a simple sliding-window{'\n'}
rate limiter for HTTP request handlers...{'\n\n'}
<span className={styles.astTkId}>### Usage</span>{'\n\n'}
Create an instance with a per-window cap:{'\n\n'}
```python{'\n'}
limiter = RateLimiter(cap=100){'\n'}
```{'\n\n'}
<span className={styles.astTkId}>### Behavior</span>{'\n\n'}
Each <span className={styles.astTkCall}>`.tick()`</span> records a request timestamp...</>
    ),
    math: [
      { label: '.md language weight',    value: '0.08', tone: 'mute' },
      { label: 'lines (capped at 300)',  value: '100', tone: 'mute' },
      { label: 'file_weight',            value: '1.0', tone: 'mute' },
    ],
    total: '0.08 × 100 × 1 = 8.00', totalTone: 'fg',
    note: <><strong style={{ color: 'var(--fg-default)' }}>Not zero — but per-LOC the worst.</strong> Docs use line-count scoring (no AST). The <span className="mono">.md</span> language weight is 0.08, so 100 lines clears the 5-threshold. But you have to write 5× the volume to match a small code PR, and the per-LOC efficiency is roughly half a bug fix.</>,
  },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Shared chevron
 * ─────────────────────────────────────────────────────────────────────── */

function Chev({ small = false }: { small?: boolean }) {
  const size = small ? 9 : 11;
  return (
    <svg
      className={`chev ${styles.chev}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      style={{ color: 'var(--fg-subtle)', flexShrink: 0 }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
