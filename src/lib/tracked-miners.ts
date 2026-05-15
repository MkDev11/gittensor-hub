'use client';

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'gittensor.trackedMiners';

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
  window.dispatchEvent(new Event('tracked-miners-changed'));
}

export function useTrackedMiners() {
  const [tracked, setTracked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setTracked(readStorage());
    const handler = () => setTracked(readStorage());
    window.addEventListener('tracked-miners-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('tracked-miners-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    const next = new Set(readStorage());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeStorage(next);
  }, []);

  return { tracked, toggle };
}
