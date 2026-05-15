'use client';

import React from 'react';
import { ZapIcon } from '@primer/octicons-react';

export default function ValidateButton({
  onClick,
  size = 'medium',
  label = 'Validate',
}: {
  onClick: () => void;
  size?: 'small' | 'medium';
  label?: string;
}) {
  const padY = size === 'small' ? 2 : 5;
  const padX = size === 'small' ? 8 : 14;
  const fontSize = size === 'small' ? 11 : 13;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: `${padY}px ${padX}px`,
        border: '1px solid var(--btn-primary-border)',
        borderRadius: 6,
        background: 'var(--btn-primary-bg)',
        color: 'var(--btn-primary-fg)',
        fontSize,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        boxShadow: 'var(--btn-primary-shadow)',
        transition: 'background 80ms, transform 50ms, box-shadow 80ms',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--btn-primary-hover-bg)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--btn-primary-bg)';
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--btn-primary-active-bg)';
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0.5px)';
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--btn-primary-hover-bg)';
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
      }}
    >
      <ZapIcon size={size === 'small' ? 12 : 14} />
      {label}
    </button>
  );
}
