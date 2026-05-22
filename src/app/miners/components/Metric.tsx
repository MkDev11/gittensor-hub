'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import type { Tone } from './types';
import { MONO, LABEL, ELLIPSIS, NOWRAP, TONE_FG } from './tokens';

export function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
  size = 'md',
  align = 'left',
}: {
  label?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right' | 'center';
}) {
  const valueSize = size === 'lg' ? [2, null, 3] : size === 'sm' ? 1 : 2;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        textAlign: align,
        alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        minWidth: 0,
      }}
    >
      {label && (
        <Text sx={{ ...LABEL }}>{label}</Text>
      )}
      <Text
        sx={{
          ...MONO,
          fontSize: valueSize,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          color: 'fg.default',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          ...NOWRAP,
          maxWidth: '100%',
        }}
        style={{ color: TONE_FG[tone] }}
      >
        {value}
      </Text>
      {sub && (
        <Text sx={{ fontSize: '10px', color: 'fg.subtle', ...ELLIPSIS, maxWidth: '100%' }}>
          {sub}
        </Text>
      )}
    </Box>
  );
}
