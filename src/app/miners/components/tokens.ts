import type { Tone } from './types';

export const MONO = {
  fontFamily: 'mono',
  fontVariantNumeric: 'tabular-nums',
} as const;

export const LABEL = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
  color: 'fg.muted',
} as const;

export const ELLIPSIS = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;

export const NOWRAP = {
  whiteSpace: 'nowrap',
} as const;

export const TONE_FG: Record<Tone, string> = {
  neutral: 'var(--fg-default)',
  success: 'var(--success-fg)',
  danger:  'var(--danger-fg)',
  done:    'var(--done-fg)',
  accent:  'var(--accent-fg)',
};
