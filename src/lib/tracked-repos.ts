'use client';

import { useCallback } from 'react';
import { useStorageValue } from './use-storage-value';

const STORAGE_KEY = 'gittensor.trackedRepos';
const EVENT_NAME = 'tracked-repos-changed';
const EMPTY: Set<string> = new Set();

function repoKey(fullName: string): string {
  return fullName.trim().toLowerCase();
}

function dedupe(names: string[]): Set<string> {
  const byKey = new Map<string, string>();
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const key = repoKey(name);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, name);
  }
  return new Set(byKey.values());
}

function parse(raw: string | null): Set<string> {
  if (!raw) return new Set();
  const arr = JSON.parse(raw);
  return dedupe(Array.isArray(arr) ? arr : []);
}

function serialize(set: Set<string>): string {
  return JSON.stringify(Array.from(set));
}

function readFresh(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Set();
  }
}

export function useTrackedRepos() {
  const [tracked, setTracked] = useStorageValue<Set<string>>(
    STORAGE_KEY,
    parse,
    serialize,
    EMPTY,
    EVENT_NAME,
  );

  const toggle = useCallback(
    (fullName: string) => {
      const key = repoKey(fullName);
      if (!key) return;
      const next = readFresh();
      const existing = Array.from(next).find((name) => repoKey(name) === key);
      if (existing) next.delete(existing);
      else next.add(fullName.trim());
      setTracked(next);
    },
    [setTracked],
  );

  const clear = useCallback(() => setTracked(new Set()), [setTracked]);

  const setMany = useCallback(
    (names: string[]) => setTracked(dedupe(names)),
    [setTracked],
  );

  return { tracked, toggle, clear, setMany };
}

export function isTracked(set: Set<string>, fullName: string): boolean {
  const key = repoKey(fullName);
  if (!key) return false;
  for (const name of set) {
    if (repoKey(name) === key) return true;
  }
  return false;
}
