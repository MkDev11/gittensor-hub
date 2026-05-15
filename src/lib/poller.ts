import { getLiveReposServer as getLiveRepos } from '@/lib/repos-server';
import { refreshIssuesIfStale, refreshPullsIfStale } from '@/lib/refresh';
import { getDb } from '@/lib/db';

interface RepoTuple {
  owner: string;
  name: string;
  weight: number;
}

function loadUserRepos(): RepoTuple[] {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT full_name, weight FROM user_repos')
      .all() as Array<{ full_name: string; weight: number }>;
    return rows.map((r) => {
      const [owner, name] = r.full_name.split('/');
      return { owner, name, weight: r.weight };
    });
  } catch {
    return [];
  }
}

function getAllRepos(): RepoTuple[] {
  // `getLiveRepos()` returns the live-fetched master_repositories.json when
  // available, falling back to the bundled snapshot. The async refresh runs
  // out-of-band so this remains synchronous and cheap on every cycle.
  const sn74 = getLiveRepos();
  const sn74Names = new Set(sn74.map((r) => r.fullName));
  const user = loadUserRepos().filter((u) => !sn74Names.has(`${u.owner}/${u.name}`));
  return [...sn74.map((r) => ({ owner: r.owner, name: r.name, weight: r.weight })), ...user];
}

const TIER1_INTERVAL_MS = 20_000;       // High-priority sweep (top-weight repos): every 20s
const TIER2_INTERVAL_MS = 600_000;      // Full sweep across all repos: every 10 min
const REPO_PAUSE_MS = 300;              // Pause between repos (top-30 in ~9s; ~200/min still under PAT quota)

const TIER1_TOP_N = 10;                 // Top-weighted repos refreshed often (cycle ~15s under 20s tick)

let started = false;
// Per-tier locks so a single tier never overlaps itself, but tier-1 and
// tier-2 can run concurrently. Previously a single shared lock meant tier-2
// (216 repos × ~1-2s ≈ 5-10 minutes) blocked tier-1 entirely, so the user's
// top-weighted repos drifted past their 60s SLA. Concurrent overlap is safe
// because refresh.ts dedupes per-repo via `inFlightIssues` / `inFlightPulls`
// and the 30s stale-check turns redundant calls into instant no-ops.
let tier1Running = false;
let tier2Running = false;

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function refreshOne(owner: string, name: string) {
  try {
    await Promise.all([refreshIssuesIfStale(owner, name, false), refreshPullsIfStale(owner, name, false)]);
  } catch {
    // swallow per-repo errors so the cycle continues
  }
}

async function runTier1() {
  if (tier1Running) return;
  tier1Running = true;
  try {
    const all = getAllRepos();
    const top = all
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, TIER1_TOP_N);
    // Always include user-added repos in the high-priority tier so they refresh quickly.
    const userRepos = loadUserRepos();
    const merged = [...top];
    for (const u of userRepos) {
      if (!merged.some((r) => r.owner === u.owner && r.name === u.name)) merged.push(u);
    }
    for (const r of merged) {
      await refreshOne(r.owner, r.name);
      await sleep(REPO_PAUSE_MS);
    }
  } finally {
    tier1Running = false;
  }
}

async function runTier2() {
  if (tier2Running) return;
  tier2Running = true;
  try {
    for (const r of getAllRepos()) {
      await refreshOne(r.owner, r.name);
      await sleep(REPO_PAUSE_MS);
    }
  } finally {
    tier2Running = false;
  }
}

export function startPoller() {
  if (started) return;
  started = true;

  // Don't block the server start — kick everything off async.
  setTimeout(() => {
    runTier1().catch(() => {});
  }, 2_000);

  setInterval(() => {
    runTier1().catch(() => {});
  }, TIER1_INTERVAL_MS);

  setTimeout(() => {
    runTier2().catch(() => {});
  }, 30_000);

  setInterval(() => {
    runTier2().catch(() => {});
  }, TIER2_INTERVAL_MS);
}
