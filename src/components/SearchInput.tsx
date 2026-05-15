'use client';

import React from 'react';
import { TextInput } from '@primer/react';
import { SearchIcon, XCircleFillIcon } from '@primer/octicons-react';

interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  width?: number | string;
  ariaLabel?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder,
  width = 320,
  ariaLabel,
}: SearchInputProps) {
  const hasValue = value.length > 0;

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-block',
        width: typeof width === 'number' ? width : width,
        maxWidth: '100%',
      }}
    >
      <TextInput
        leadingVisual={SearchIcon}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        sx={{
          width: '100%',
          paddingRight: hasValue ? '32px' : undefined,
        }}
      />
      <button
        type="button"
        onClick={() => onChange('')}
        aria-label="Clear search"
        title="Clear (Esc)"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('');
        }}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: hasValue ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.6)',
          opacity: hasValue ? 1 : 0,
          pointerEvents: hasValue ? 'auto' : 'none',
          width: 20,
          height: 20,
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          borderRadius: '50%',
          transition: 'opacity 160ms cubic-bezier(0.16, 1, 0.3, 1), transform 160ms cubic-bezier(0.16, 1, 0.3, 1), color 80ms',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-default)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-muted)';
        }}
      >
        <XCircleFillIcon size={14} />
      </button>
    </div>
  );
}
