'use client';

// Shared cell helpers for the issue / pull-request tables (IssuesTable &
// PullsTable). Extracted from the two near-identical copies that used to live in
// each file. One source so the column headers and relative-time cells stay in
// lockstep across both tables.
import React from 'react';
import { Box, Text } from '@primer/react';
import { TriangleUpIcon, TriangleDownIcon } from '@primer/octicons-react';
import { formatRelativeTime, isRecent } from '@/lib/format';

export type SortDir = 'asc' | 'desc';

export const headerCellSx = {
  p: 2,
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: 0,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
};

/** Uppercase column header; sortable when `onClick` is given (shows a triangle).
 *  `width` is optional — the pulls table uses a fixed layout, the issues one doesn't. */
export function HeaderCell({
  label,
  onClick,
  active,
  dir,
  align = 'left',
  width,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  dir?: SortDir;
  align?: 'left' | 'right';
  width?: number;
}) {
  return (
    <Box
      as="th"
      onClick={onClick}
      sx={{
        ...headerCellSx,
        textAlign: align,
        width,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        '&:hover': onClick ? { color: 'var(--fg-default)' } : undefined,
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label}
        {active && (dir === 'asc' ? <TriangleUpIcon size={12} /> : <TriangleDownIcon size={12} />)}
      </Box>
    </Box>
  );
}

/** Relative timestamp; "recent" times get a pulsing green dot. "—" when null. */
export const RecentTime = React.memo(function RecentTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <Text sx={{ color: 'var(--fg-muted)' }}>—</Text>;
  if (isRecent(iso)) {
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bg: 'var(--success-emphasis)',
            display: 'inline-block',
            animation: 'gtPulse 1.6s ease-in-out infinite',
          }}
        />
        <Text sx={{ color: 'var(--success-fg)', fontWeight: 700, letterSpacing: '0.2px' }}>
          {formatRelativeTime(iso)}
        </Text>
      </Box>
    );
  }
  return <Text sx={{ color: 'var(--fg-muted)' }}>{formatRelativeTime(iso)}</Text>;
});
