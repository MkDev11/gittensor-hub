// Server-side cache of the registered Gittensor miner set, used to restrict the
// maintainer scorecard to miners' PRs/issues (the local `pulls`/`issues` tables
// hold *every* GitHub contributor; only miner work is relevant to the subnet).
//
// Source of truth is the upstream validator API — the same `…/miners` feed the
// /api/miners and per-repo miners routes read. We cache the derived login set
// for a minute and fall back to the last-good set (or null) on upstream failure
// so a transient outage degrades to "unfiltered" rather than an empty scorecard.
import type { Miner } from '@/types/entities';

const MINERS_URL = 'https://api.gittensor.io/miners';
const TTL_MS = 60_000;

interface Cached {
  fetchedAt: number;
  logins: Set<string>;
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

async function refresh(): Promise<Cached> {
  const r = await fetch(MINERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`upstream miners ${r.status}`);
  const miners = (await r.json()) as Pick<Miner, 'githubUsername'>[];
  const logins = new Set<string>();
  for (const m of miners) {
    const login = (m.githubUsername ?? '').trim().toLowerCase();
    if (login) logins.add(login);
  }
  const next: Cached = { fetchedAt: Date.now(), logins };
  cache = next;
  return next;
}

/**
 * Lowercased GitHub usernames of every registered Gittensor miner. Cached for
 * ~60s. Returns the last-good set if a refresh fails, or `null` if we have
 * never successfully fetched — callers treat `null` as "skip miner filtering".
 */
export async function getGittensorMinerLogins(): Promise<Set<string> | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.logins;
  if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
  try {
    return (await inFlight).logins;
  } catch {
    return cache?.logins ?? null;
  }
}
