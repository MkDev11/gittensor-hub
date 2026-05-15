'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';

interface Prices {
  tao_usd: number;
  alpha_tao: number;
  alpha_usd: number;
  fetched_at: number;
  source?: string;
}

function fmtUsd(n: number): string {
  if (!n) return '—';
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtTao(n: number): string {
  if (!n) return '—';
  if (n >= 1) return `${n.toFixed(3)}τ`;
  return `${n.toFixed(6)}τ`;
}

export default function PriceTicker() {
  const { data } = useQuery<Prices>({
    queryKey: ['prices'],
    queryFn: async () => {
      const r = await fetch('/api/prices');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!data) return null;
  const ageSec = Math.max(0, Math.floor((Date.now() - data.fetched_at) / 1000));
  const tooltip = `TAO ${fmtUsd(data.tao_usd)} · α(SN74) ${fmtUsd(data.alpha_usd)} (${fmtTao(data.alpha_tao)} TAO) · updated ${ageSec}s ago`;

  return (
    <div
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 10px',
        height: 32,
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        background: 'var(--bg-canvas)',
        color: 'var(--fg-default)',
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ color: 'var(--fg-muted)', fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>TAO</span>
        <span style={{ color: 'var(--fg-default)', fontWeight: 700 }}>{fmtUsd(data.tao_usd)}</span>
      </span>
      <span style={{ color: 'var(--border-default)' }}>·</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ color: 'var(--fg-muted)', fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>α74</span>
        <span style={{ color: 'var(--fg-default)', fontWeight: 700 }}>{fmtUsd(data.alpha_usd)}</span>
      </span>
    </div>
  );
}
