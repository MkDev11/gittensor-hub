// Server-side fetch of a repo's maintainer logins from the gittensor mirror,
// used to exclude maintainers' own PRs/issues from the responsiveness figures
// (a maintainer self-merging their own PR isn't "serving miners"). Shared by the
// maintainer-stats and fairness routes. Successful results are memoised briefly
// to spare the mirror when a page grades many repos at once; failures are NOT
// cached, so a transient outage retries rather than sticking on "no maintainers".
const MIRROR_BASE_URL = 'https://mirror.gittensor.io';
const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { at: number; logins: Set<string> }>();

/** Lowercased maintainer logins for `owner/name`. `null` when the mirror is
 *  unavailable (caller then applies no maintainer exclusion). */
export async function fetchMaintainerLogins(owner: string, name: string): Promise<Set<string> | null> {
  const key = `${owner}/${name}`.toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.logins;

  try {
    const url = `${MIRROR_BASE_URL}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/maintainers`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { maintainers?: Array<{ login?: string }> };
    const set = new Set<string>();
    for (const m of body.maintainers ?? []) {
      const login = (m.login ?? '').trim().toLowerCase();
      if (login) set.add(login);
    }
    cache.set(key, { at: now, logins: set });
    return set;
  } catch {
    return null;
  }
}
