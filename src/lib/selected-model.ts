'use client';

import { useEffect, useState } from 'react';
import { isValidModelId, type Effort, type ModelId } from '@/lib/models';

const STORAGE_KEY = 'gittensor.selectedModel';
const EFFORT_KEY = 'gittensor.modelEffort';
const THINKING_KEY = 'gittensor.modelThinking';
const DEFAULT_MODEL: ModelId = 'claude-opus-4-7';

export type { Effort };
const DEFAULT_EFFORT: Effort = 'high';
const VALID_EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'max']);

/**
 * Global persisted model + reasoning preferences. Components can read any
 * subset (`useSelectedModel`, `useSelectedEffort`, `useThinkingEnabled`) and
 * each subscribes to cross-tab updates. Storage keys are stable — bumping
 * them would silently reset every user's choices.
 */
export function useSelectedModel(): { model: ModelId; setModel: (m: ModelId) => void } {
  const [model, setModelState] = useState<ModelId>(DEFAULT_MODEL);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isValidModelId(saved)) setModelState(saved);
    const handler = () => {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && isValidModelId(v)) setModelState(v);
    };
    window.addEventListener('selected-model-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('selected-model-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const setModel = (m: ModelId) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, m);
    setModelState(m);
    window.dispatchEvent(new Event('selected-model-changed'));
  };

  return { model, setModel };
}

export function useSelectedEffort(): { effort: Effort; setEffort: (e: Effort) => void } {
  const [effort, setEffortState] = useState<Effort>(DEFAULT_EFFORT);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(EFFORT_KEY) as Effort | null;
    if (saved && VALID_EFFORTS.has(saved)) setEffortState(saved);
    const handler = () => {
      const v = localStorage.getItem(EFFORT_KEY) as Effort | null;
      if (v && VALID_EFFORTS.has(v)) setEffortState(v);
    };
    window.addEventListener('selected-effort-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('selected-effort-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  const setEffort = (e: Effort) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(EFFORT_KEY, e);
    setEffortState(e);
    window.dispatchEvent(new Event('selected-effort-changed'));
  };
  return { effort, setEffort };
}

export function useThinkingEnabled(): { thinking: boolean; setThinking: (v: boolean) => void } {
  const [thinking, setThinkingState] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(THINKING_KEY);
    if (saved === '0' || saved === '1') setThinkingState(saved === '1');
    const handler = () => {
      const v = localStorage.getItem(THINKING_KEY);
      if (v === '0' || v === '1') setThinkingState(v === '1');
    };
    window.addEventListener('thinking-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('thinking-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  const setThinking = (v: boolean) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(THINKING_KEY, v ? '1' : '0');
    setThinkingState(v);
    window.dispatchEvent(new Event('thinking-changed'));
  };
  return { thinking, setThinking };
}
