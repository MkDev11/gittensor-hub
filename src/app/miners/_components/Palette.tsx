'use client';

/* eslint-disable @next/next/no-img-element */

/* ⌘K command palette — fuzzy-jump to any miner by login, UID, GitHub ID, or
 * a repo they work in. Enter opens that miner's drawer. Mirrors the
 * repositories palette. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlameIcon } from '@primer/octicons-react';
import { formatNumber, formatTao, formatUsd } from '@/lib/format';
import styles from '../page.module.css';
import { type MinerView } from '../_lib/miners';
import StreamTags from './StreamTags';

interface PaletteProps {
  open: boolean;
  views: MinerView[];
  onClose: () => void;
  onSelect: (key: string) => void;
}

export default function Palette({ open, views, onClose, onSelect }: PaletteProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
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
    const list = needle
      ? views.filter((v) => {
          const hay = `${v.login} ${v.githubId} ${v.uid ?? ''} ${v.rows.map((r) => r.repo).join(' ')} ${v.topRepos.map((r) => r.repo).join(' ')}`.toLowerCase();
          return hay.includes(needle);
        })
      : [...views].sort((a, b) => b.activity - a.activity);
    // Show every miner: searching filters, no query lists all of them sorted by
    // activity. No cap — the list scrolls — so zero-earning miners (active but
    // unpaid, low activity) stay browsable instead of being cut with the tail.
    return list;
  }, [q, views]);

  useEffect(() => {
    setActive((i) => (matched.length === 0 ? 0 : Math.min(i, matched.length - 1)));
  }, [matched]);

  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className={`${styles.paletteOuter} ${open ? styles.paletteOpen : ''}`} role="dialog" aria-label="Search miners">
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
            placeholder="Jump to miner — login, UID, GitHub ID, or repo…"
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
                const view = matched[active];
                if (view) {
                  onSelect(view.key);
                  onClose();
                }
              }
            }}
          />
          <span className={styles.kbd}>ESC</span>
        </div>
        <div className={styles.paletteResults}>
          {matched.length === 0 ? (
            <div className={styles.paletteEmpty}>No miners match.</div>
          ) : (
            matched.map((view, idx) => {
              return (
                <button
                  key={view.key}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  className={`${styles.paletteItem} ${idx === active ? styles.paletteItemActive : ''}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => {
                    onSelect(view.key);
                    onClose();
                  }}
                >
                  <img src={view.avatarUrl} alt={view.login} loading="lazy" />
                  <div className={styles.paletteItemText}>
                    <div className={styles.paletteItemName}>
                      <span className={styles.paletteItemLogin}>{view.login}</span>
                      <StreamTags view={view} />
                    </div>
                    <div className={styles.paletteItemSub}>
                      <span className={styles.badge}>uid {view.uid ?? '-'}</span>
                      {view.totalScore > 0 ? <span className={styles.badge}>score {formatNumber(view.totalScore)}</span> : null}
                      {view.topRepos[0] ? (
                        <span className={`${styles.badge} ${styles.badgeRepo}`} title={`Top repo · ${view.topRepos[0].repo}`}>
                          <span className={styles.badgeFire} aria-hidden>
                            <FlameIcon size={11} />
                          </span>
                          <span className={styles.badgeRepoName}>{view.topRepos[0].repo}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.paletteItemMetrics}>
                    <span className={styles.paletteItemUsd}>{formatUsd(view.usdPerDay)}/d</span>
                    {view.taoPerDay > 0 ? <span className={styles.paletteItemTao}>{formatTao(view.taoPerDay)}/d</span> : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
