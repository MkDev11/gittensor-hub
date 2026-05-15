'use client';

import React from 'react';
import { SunIcon, MoonIcon } from '@primer/octicons-react';
import { useTheme } from '@/lib/theme';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        padding: 0,
        background: 'transparent',
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        color: 'var(--fg-muted)',
        cursor: 'pointer',
        transition: 'border-color 80ms, color 80ms, background 80ms',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-default)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-muted)';
      }}
    >
      {isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
}
