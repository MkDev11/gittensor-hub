'use client';

import React from 'react';
import styles from '../page.module.css';
import Avatar from './Avatar';
import { formatTAO, repoDailyTAO, type RepoRow } from '../_lib/incentives';

interface CompareTrayProps {
  rows: RepoRow[];
  subnetTAO: number;
  onRemove: (fullName: string) => void;
  onClear: () => void;
  onOpen: () => void;
}

const MAX = 4;

export default function CompareTray({ rows, subnetTAO, onRemove, onClear, onOpen }: CompareTrayProps) {
  const n = rows.length;
  if (n === 0) return null;

  return (
    <div className={`${styles.compareTray} ${styles.open}`}>
      <div className={styles.tray}>
        <div
          className={styles.hideOnMobile}
          style={{
            fontSize: 11,
            color: 'var(--fg-subtle)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          Comparing
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
          {rows.map((r) => (
            <div
              key={r.fullName}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 4px 4px 4px',
                borderRadius: 6,
                border: '1px solid var(--soft-border, rgba(255,255,255,0.06))',
                fontSize: 12,
                background: 'var(--bg-subtle)',
              }}
            >
              <Avatar fullName={r.fullName} size="xs" />
              <span>
                <span className={styles.textFgDim}>{r.owner}/</span>
                <span style={{ fontWeight: 500 }}>{r.name}</span>
              </span>
              <span className={`mono tnum ${styles.textTao}`} style={{ fontSize: 10.5 }}>
                {formatTAO(repoDailyTAO(r, subnetTAO))} τ/d
              </span>
              <button
                type="button"
                onClick={() => onRemove(r.fullName)}
                title="Remove from compare"
                style={{
                  background: 'transparent',
                  border: 0,
                  cursor: 'pointer',
                  color: 'var(--fg-subtle)',
                  width: 16,
                  height: 16,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 4,
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {n < MAX ? (
            <span style={{ fontSize: 11, color: 'var(--fg-subtle)', marginLeft: 6 }}>
              {MAX - n} more slot{n === MAX - 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        <button type="button" className={styles.ghostBtn} onClick={onClear}>
          Clear
        </button>
        <button
          type="button"
          className={styles.priBtn}
          onClick={onOpen}
          disabled={n < 2}
          aria-label="Compare repositories side by side"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M3 6h4v15H3zM10 3h4v18h-4zM17 9h4v12h-4z" />
          </svg>
          <span className={styles.hideOnMobile}>Compare side by side</span>
        </button>
      </div>
    </div>
  );
}
