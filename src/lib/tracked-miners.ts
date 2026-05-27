'use client';

import { useCallback } from 'react';
import { useStorageValue } from './use-storage-value';

const STORAGE_KEY = 'gittensor.trackedMiners';
const EVENT_NAME = 'tracked-miners-changed';
const EMPTY: Set<string> = new Set();

function parse(raw: string | null): Set<string> {
  if (!raw) return new Set();
  const arr = JSON.parse(raw);
  return new Set(Array.isArray(arr) ? arr : []);
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

export function useTrackedMiners() {
  const [tracked, setTracked] = useStorageValue<Set<string>>(
    STORAGE_KEY,
    parse,
    serialize,
    EMPTY,
    EVENT_NAME,
  );

  const toggle = useCallback(
    (id: string) => {
      const next = readFresh();
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setTracked(next);
    },
    [setTracked],
  );

  return { tracked, toggle };
}
