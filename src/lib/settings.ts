'use client';

import { useEffect, useState, useCallback } from 'react';
import { useStorageValue } from './use-storage-value';

const STORAGE_KEY = 'gittensor.settings';
const EVENT_NAME = 'settings-changed';

export type IssueDefaultState = 'all' | 'open' | 'completed' | 'not_planned' | 'closed_other';
export type ContentDisplayMode = 'modal' | 'accordion' | 'side';
export type LayoutMode = 'sidebar' | 'top-nav';

export interface AppSettings {
  defaultIssueState: IssueDefaultState;
  showLabelsInTable: boolean;
  pollIntervalMs: number;
  uiTickMs: number;
  notificationsEnabled: boolean;
  showRateLimit: boolean;
  defaultRepoSort: 'weight' | 'name' | 'tracked';
  contentDisplay: ContentDisplayMode;
  renderMarkdown: boolean;
  autoExpandFirst: boolean;
  pageSize: number;
  layout: LayoutMode;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultIssueState: 'all',
  showLabelsInTable: true,
  pollIntervalMs: 1000,
  uiTickMs: 1000,
  notificationsEnabled: true,
  showRateLimit: true,
  defaultRepoSort: 'weight',
  contentDisplay: 'modal',
  renderMarkdown: true,
  autoExpandFirst: false,
  pageSize: 25,
  layout: 'sidebar',
};

function parse(raw: string | null): AppSettings {
  if (!raw) return DEFAULT_SETTINGS;
  const parsed = JSON.parse(raw) as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    layout: parsed.layout === 'top-nav' || parsed.layout === 'sidebar'
      ? parsed.layout
      : DEFAULT_SETTINGS.layout,
  };
}

function serialize(s: AppSettings): string {
  return JSON.stringify(s);
}

function readFresh(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useStorageValue<AppSettings>(
    STORAGE_KEY,
    parse,
    serialize,
    DEFAULT_SETTINGS,
    EVENT_NAME,
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const update = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings({ ...readFresh(), [key]: value });
    },
    [setSettings],
  );

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), [setSettings]);

  return { settings, update, reset, hydrated };
}

// useSession hits the server-side `/api/auth/me` endpoint. Sign-in / sign-out
// happen via dedicated routes — there's no client-side session toggle anymore.
export interface AuthSession {
  authenticated: boolean;
  username: string | null;
  isAdmin: boolean;
  avatarUrl: string | null;
  status: 'pending' | 'approved' | 'rejected' | null;
  loading: boolean;
}

const EMPTY: AuthSession = {
  authenticated: false,
  username: null,
  isAdmin: false,
  avatarUrl: null,
  status: null,
  loading: true,
};

export function useSession(): AuthSession & { signOut: () => Promise<void> } {
  const [session, setSession] = useState<AuthSession>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setSession({
          authenticated: true,
          username: String(j.username ?? ''),
          isAdmin: !!j.is_admin,
          avatarUrl: j.avatar_url ?? null,
          status: j.status ?? null,
          loading: false,
        });
      } else {
        setSession({ ...EMPTY, loading: false });
      }
    } catch {
      setSession({ ...EMPTY, loading: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    // `kind: 'logout'` means the caller already cleared the cookie — refetching
    // /api/auth/me would just produce a 401. Skip the fetch and reset locally.
    const handler = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind === 'logout') {
        setSession({ ...EMPTY, loading: false });
        return;
      }
      void refresh();
    };
    window.addEventListener('session-changed', handler);
    return () => window.removeEventListener('session-changed', handler);
  }, [refresh]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setSession({ ...EMPTY, loading: false });
    window.dispatchEvent(new CustomEvent('session-changed', { detail: { kind: 'logout' } }));
  }, []);

  return { ...session, signOut };
}
