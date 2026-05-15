'use client';

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'gittensor.trackedRepos';

function readStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeStorage(set: Set<string>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  window.dispatchEvent(new Event('tracked-repos-changed'));
}

export function useTrackedRepos() {
  const [tracked, setTracked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setTracked(readStorage());
    const handler = () => setTracked(readStorage());
    window.addEventListener('tracked-repos-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('tracked-repos-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const toggle = useCallback((fullName: string) => {
    const next = new Set(readStorage());
    if (next.has(fullName)) next.delete(fullName);
    else next.add(fullName);
    writeStorage(next);
  }, []);

  const clear = useCallback(() => writeStorage(new Set()), []);

  const setMany = useCallback((names: string[]) => writeStorage(new Set(names)), []);

  return { tracked, toggle, clear, setMany };
}

export function isTracked(set: Set<string>, fullName: string): boolean {
  return set.has(fullName);
}
