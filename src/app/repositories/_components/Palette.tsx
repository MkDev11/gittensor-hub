'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../page.module.css';
import Avatar from './Avatar';
import { formatTAO, repoDailyTAO, type RepoRow } from '../_lib/incentives';

/** Short context line shown under each palette result. Prefers the real
 *  description when present (HTML prototype carried one per repo); otherwise
 *  falls back to a derived "stream · share · activity" string. */
function buildSubline(r: RepoRow): string {
  if (r.description) return r.description;
  const parts: string[] = [];
  if (r.share === 0) {
    parts.push('benchmark · no emission');
  } else {
    const stream = r.issue === 1 ? 'issue stream'
                 : r.issue === 0 ? 'PR stream'
                 : `mixed (${Math.round((1 - r.issue) * 100)}/${Math.round(r.issue * 100)})`;
    parts.push(stream);
    parts.push(`${(r.share * 100).toFixed(2)}% share`);
  }
  if (r.activity.merged30d > 0) parts.push(`${r.activity.merged30d} merged · 30d`);
  if (r.trusted) parts.push('trusted');
  return parts.join(' · ');
}

interface PaletteProps {
  open: boolean;
  rows: RepoRow[];
  subnetTAO: number;
  onClose: () => void;
  onSelect: (full: string) => void;
}

export default function Palette({ open, rows, subnetTAO, onClose, onSelect }: PaletteProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      // Defer focus until the input is mounted and visible
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const matched = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return rows
      .filter((r) => !needle || `${r.fullName} ${r.description}`.toLowerCase().includes(needle))
      .slice(0, 10);
  }, [q, rows]);

  // Reset active when results change (typing), and keep it clamped to bounds.
  useEffect(() => {
    setActive((i) => (matched.length === 0 ? 0 : Math.min(i, matched.length - 1)));
  }, [matched]);

  // Scroll the active item into view when nav keys move it off-screen.
  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className={`${styles.paletteOuter} ${open ? styles.open : ''}`} role="dialog" aria-label="Search repositories">
      <div className={styles.paletteBg} onClick={onClose} />
      <div className={styles.paletteBox}>
        <div className={styles.paletteHeader}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--fg-subtle)' }}>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-3.6-3.6" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search repositories…"
            className={styles.paletteInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (matched.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => (i + 1) % matched.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => (i - 1 + matched.length) % matched.length);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const r = matched[active];
                if (r) {
                  onSelect(r.fullName);
                  onClose();
                }
              }
            }}
          />
          <span className={styles.kbd}>ESC</span>
        </div>
        <div className={styles.paletteResults}>
          {matched.length === 0 ? (
            <div style={{ padding: '32px 12px', textAlign: 'center', fontSize: 12.5, color: 'var(--fg-subtle)' }}>
              No matches.
            </div>
          ) : (
            matched.map((r, idx) => {
              // When the API doesn't carry a description (current reality), we
              // derive a short "stream · share · activity" line so each result
              // matches the HTML's two-line visual rhythm.
              const subline = buildSubline(r);
              const isActive = idx === active;
              return (
                <button
                  key={r.fullName}
                  ref={(el) => { itemRefs.current[idx] = el; }}
                  type="button"
                  className={styles.paletteItem}
                  style={isActive ? { background: 'var(--bg-hover, rgba(255,255,255,0.06))' } : undefined}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => {
                    onSelect(r.fullName);
                    onClose();
                  }}
                >
                  <Avatar fullName={r.fullName} size="sm" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13 }}>
                      <span className={styles.textFgDim}>{r.owner}/</span>
                      <span style={{ fontWeight: 500 }}>{r.name}</span>
                      {r.isSelf ? <span className={`${styles.badge} ${styles.badgeSelf}`} style={{ marginLeft: 6 }}>your</span> : null}
                    </div>
                    {subline ? (
                      <div style={{ fontSize: 11.5, color: 'var(--fg-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                        {subline}
                      </div>
                    ) : null}
                  </div>
                  <span className={`mono tnum ${styles.textTao}`} style={{ fontSize: 12 }}>
                    {formatTAO(repoDailyTAO(r, subnetTAO))} τ/d
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
