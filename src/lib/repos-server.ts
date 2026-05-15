// Server-only: this module imports `db` (better-sqlite3) and must never be
// imported by client components. The `repos.ts` sibling exports the bundled
// snapshot and other client-safe helpers.
import { ALL_REPOS, type RepoEntry } from './repos';
import { getDb } from './db';

// Live source. We poll entrius/gittensor:main/master_repositories.json every
// 5 minutes. Per-poll semantics:
//   * Repos present in upstream  → weight set to live's weight.
//   * Repos previously seen but absent upstream → weight set to 0.
//   * Repos new to upstream → row inserted with live's weight.
//   * Nothing is ever deleted.
const REMOTE_URL =
  'https://raw.githubusercontent.com/entrius/gittensor/main/gittensor/validator/weights/master_repositories.json';
const REFRESH_MS = 5 * 60 * 1000;

interface MasterRepoEntry {
  weight: number;
  inactive_at?: string | null;
}

let lastFetchedAt = 0;
let inFlight: Promise<void> | null = null;
let seeded = false;

// On cold start, populate repo_weights from the bundled snapshot so the
// dashboard has *something* to render before the first live poll completes.
// Subsequent polls overwrite these with live weights (or 0).
function seedFromBundledIfEmpty(): void {
  if (seeded) return;
  const db = getDb();
  const c = (db.prepare('SELECT COUNT(*) AS c FROM repo_weights').get() as { c: number }).c;
  if (c === 0) {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO repo_weights (full_name, weight, updated_at) VALUES (?, ?, ?)`,
    );
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const r of ALL_REPOS) insert.run(r.fullName, r.weight, now);
    });
    tx();
    console.log(`[repos] seeded repo_weights from bundled (${ALL_REPOS.length} rows)`);
  }
  seeded = true;
}

async function refreshLiveIfStale(): Promise<void> {
  seedFromBundledIfEmpty();
  const age = Date.now() - lastFetchedAt;
  if (lastFetchedAt > 0 && age < REFRESH_MS) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const r = await fetch(REMOTE_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Record<string, MasterRepoEntry>;

      // Build a case-insensitive lookup of live weights. GitHub repo names
      // are case-insensitive, so we should not treat `entrius/OC-1` and
      // `entrius/oc-1` as different repos.
      const liveByLc = new Map<string, { fullName: string; weight: number }>();
      for (const [fn, ent] of Object.entries(data)) {
        liveByLc.set(fn.toLowerCase(), { fullName: fn, weight: ent.weight });
      }

      const db = getDb();
      const existing = db
        .prepare('SELECT full_name, weight FROM repo_weights')
        .all() as Array<{ full_name: string; weight: number }>;
      const existingLc = new Set(existing.map((r) => r.full_name.toLowerCase()));

      const upsert = db.prepare(
        `INSERT INTO repo_weights (full_name, weight, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`,
      );
      const now = new Date().toISOString();
      let zeroed = 0;
      let updated = 0;
      let added = 0;
      const tx = db.transaction(() => {
        // Existing repos: set to live weight, or 0 if upstream dropped them.
        for (const e of existing) {
          const live = liveByLc.get(e.full_name.toLowerCase());
          if (live) {
            if (e.weight !== live.weight) {
              upsert.run(e.full_name, live.weight, now);
              updated += 1;
            }
          } else if (e.weight !== 0) {
            upsert.run(e.full_name, 0, now);
            zeroed += 1;
          }
        }
        // Brand-new live entries: add with their live weight.
        for (const [lc, live] of liveByLc.entries()) {
          if (existingLc.has(lc)) continue;
          upsert.run(live.fullName, live.weight, now);
          added += 1;
        }
      });
      tx();
      lastFetchedAt = Date.now();
      console.log(
        `[repos] live sync: ${liveByLc.size} upstream | ${added} added, ${updated} re-weighted, ${zeroed} zeroed`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[repos] live fetch failed (${msg})`);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function readAll(): RepoEntry[] {
  try {
    const rows = getDb()
      .prepare('SELECT full_name, weight FROM repo_weights')
      .all() as Array<{ full_name: string; weight: number }>;
    if (rows.length === 0) return ALL_REPOS;
    // Pick up inactiveAt from the bundled snapshot when available — the live
    // master file carries it, but we don't currently surface it from
    // repo_weights, so the bundled snapshot remains the source for that flag.
    const bundledByLc = new Map(ALL_REPOS.map((r) => [r.fullName.toLowerCase(), r]));
    return rows.map((r) => {
      const [owner, name] = r.full_name.split('/');
      return {
        fullName: r.full_name,
        owner,
        name,
        weight: r.weight,
        inactiveAt: bundledByLc.get(r.full_name.toLowerCase())?.inactiveAt ?? null,
      };
    });
  } catch {
    return ALL_REPOS;
  }
}

function buildList(): RepoEntry[] {
  return readAll().sort((a, b) => b.weight - a.weight);
}

export function getLiveReposServer(): RepoEntry[] {
  void refreshLiveIfStale();
  return buildList();
}

export async function getLiveReposAsyncServer(): Promise<{
  repos: RepoEntry[];
  source: 'live' | 'bundled';
  fetchedAt: number;
}> {
  await refreshLiveIfStale();
  return {
    repos: buildList(),
    source: lastFetchedAt > 0 ? 'live' : 'bundled',
    fetchedAt: lastFetchedAt,
  };
}
