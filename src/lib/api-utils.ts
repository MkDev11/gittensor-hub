import { getLiveReposAsyncServer } from '@/lib/repos-server';

type LogValue = string | number | boolean | null | undefined;
type LogMeta = Record<string, LogValue>;

const SLOW_ROUTE_STAGE_MS = 1_000;
const SLOW_ROUTE_TOTAL_MS = 2_500;

export function positiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function normalizeRepoList(raw: string | null): string[] | null {
  if (raw === null) return null;
  const seen = new Set<string>();
  const repos: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push(name);
  }
  return repos;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function formatLogMeta(meta: LogMeta): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === null || value === undefined || value === '') continue;
    const safe = String(value).replace(/\s+/g, '_').slice(0, 120);
    parts.push(`${key}=${safe}`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function createRequestTimer(route: string, context: LogMeta = {}) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const stages: Array<{ name: string; ms: number }> = [];

  function recordStage(name: string, start: number, meta: LogMeta = {}) {
    const ms = Date.now() - start;
    stages.push({ name, ms });
    if (ms >= SLOW_ROUTE_STAGE_MS) {
      console.warn(`[${route}] slow stage request=${requestId} stage=${name} ms=${ms}${formatLogMeta({ ...context, ...meta })}`);
    }
  }

  return {
    timeSync<T>(name: string, fn: () => T, meta?: LogMeta): T {
      const start = Date.now();
      try {
        return fn();
      } finally {
        recordStage(name, start, meta);
      }
    },
    async time<T>(name: string, fn: () => Promise<T>, meta?: LogMeta): Promise<T> {
      const start = Date.now();
      try {
        return await fn();
      } finally {
        recordStage(name, start, meta);
      }
    },
    done(meta: LogMeta = {}) {
      const ms = Date.now() - startedAt;
      if (ms >= SLOW_ROUTE_TOTAL_MS) {
        const stageSummary = stages.map((s) => `${s.name}:${s.ms}`).join(',');
        console.warn(`[${route}] slow request request=${requestId} ms=${ms}${formatLogMeta({ ...context, ...meta, stages: stageSummary })}`);
      }
    },
  };
}

export async function resolveRepoScope(reqRepos: string[] | null): Promise<string[]> {
  const { repos: liveRepos } = await getLiveReposAsyncServer();
  const allowed = new Map<string, string>();
  for (const r of liveRepos) allowed.set(r.fullName.toLowerCase(), r.fullName);

  if (reqRepos !== null) {
    const scoped: string[] = [];
    for (const name of reqRepos) {
      const allowedName = allowed.get(name.toLowerCase());
      if (allowedName) scoped.push(allowedName);
    }
    return scoped;
  }

  return Array.from(allowed.values());
}
