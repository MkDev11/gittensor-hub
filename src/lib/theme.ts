'use client';

import { useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';
const STORAGE_KEY = 'gittensor.theme';
const DEFAULT_THEME: ThemeMode = 'dark';

export function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : DEFAULT_THEME;
}

export function applyThemeAttr(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export function useTheme(): { theme: ThemeMode; setTheme: (t: ThemeMode) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<ThemeMode>(DEFAULT_THEME);

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyThemeAttr(stored);
    const onStorage = () => {
      const next = readStoredTheme();
      setThemeState(next);
      applyThemeAttr(next);
    };
    window.addEventListener('theme-changed', onStorage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('theme-changed', onStorage);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setTheme = (next: ThemeMode) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
    applyThemeAttr(next);
    window.dispatchEvent(new Event('theme-changed'));
  };

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, setTheme, toggle };
}
