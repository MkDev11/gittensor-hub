'use client';

import React from 'react';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type SpinnerTone = 'accent' | 'success' | 'muted' | 'inherit';

const SIZES: Record<SpinnerSize, number> = {
  xs: 12,
  sm: 16,
  md: 22,
  lg: 32,
  xl: 48,
};

const TONES: Record<SpinnerTone, string> = {
  accent: 'var(--accent-emphasis)',
  success: 'var(--success-emphasis)',
  muted: 'var(--fg-muted)',
  inherit: 'currentColor',
};

export default function Spinner({
  size = 'md',
  tone = 'accent',
  label,
  inline = false,
}: {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  label?: string;
  inline?: boolean;
}) {
  const px = SIZES[size];
  const stroke = TONES[tone];
  const trackStroke = 'var(--border-default)';
  const sw = Math.max(2, Math.round(px / 10));

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
      style={{
        display: inline ? 'inline-flex' : 'flex',
        alignItems: 'center',
        justifyContent: inline ? 'flex-start' : 'center',
        gap: 8,
        color: 'var(--fg-muted)',
        fontSize: 13,
      }}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 50 50"
        style={{ animation: 'gtSpin 0.9s linear infinite', flexShrink: 0 }}
        aria-hidden="true"
      >
        <circle cx="25" cy="25" r="20" stroke={trackStroke} strokeWidth={sw + 0.5} fill="none" opacity={0.25} />
        <circle
          cx="25"
          cy="25"
          r="20"
          stroke={stroke}
          strokeWidth={sw + 0.5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="90 60"
          style={{ animation: 'gtSpinDash 1.4s ease-in-out infinite' }}
        />
      </svg>
      {label && <span>{label}</span>}
    </span>
  );
}

export function FullPageLoader({ label = 'Loading dashboard…' }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: 16,
        color: 'var(--fg-muted)',
      }}
    >
      <Spinner size="xl" tone="accent" />
      <div style={{ fontSize: 14 }}>{label}</div>
    </div>
  );
}
