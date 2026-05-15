import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLiveReposAsyncServer as getLiveReposAsync } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

export interface AllReposEntry {
  full_name: string;
  owner: string;
  name: string;
  weight: number;
  source: 'sn74' | 'user';
  notes?: string | null;
  added_at?: string | null;
  issues_total: number;
  issues_open: number;
  pulls_total: number;
  pulls_open: number;
  pulls_merged: number;
  last_activity_at: string | null;
  last_fetch_at: string | null;
}

export async function GET() {
  // Shared live cache (also used by the poller). On cold start this awaits
  // the first fetch; on warm requests it returns the cached snapshot.
  const { repos: sn74Repos, source: sn74Source, fetchedAt: sn74FetchedAtMs } = await getLiveReposAsync();
  const sn74Map: Record<string, { weight: number }> = Object.fromEntries(
    sn74Repos.map((r) => [r.fullName, { weight: r.weight }]),
  );

  const db = getDb();

  // Per-repo aggregate stats
  const issueRows = db
    .prepare(
      `SELECT repo_full_name as repo,
              COUNT(*) as total,
              SUM(CASE WHEN state = 'open' THEN 1 ELSE 0 END) as open_count,
              MAX(updated_at) as last_activity
       FROM issues
       GROUP BY repo_full_name`
    )
    .all() as Array<{ repo: string; total: number; open_count: number; last_activity: string | null }>;
  const issueStats = new Map(issueRows.map((r) => [r.repo, r]));

  const pullRows = db
    .prepare(
      `SELECT repo_full_name as repo,
              COUNT(*) as total,
              SUM(CASE WHEN state = 'open' THEN 1 ELSE 0 END) as open_count,
              SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as merged_count,
              MAX(updated_at) as last_activity
       FROM pulls
       GROUP BY repo_full_name`
    )
    .all() as Array<{
      repo: string;
      total: number;
      open_count: number;
      merged_count: number;
      last_activity: string | null;
    }>;
  const pullStats = new Map(pullRows.map((r) => [r.repo, r]));

  const metaRows = db
    .prepare('SELECT full_name, last_issues_fetch, last_pulls_fetch FROM repo_meta')
    .all() as Array<{ full_name: string; last_issues_fetch: string | null; last_pulls_fetch: string | null }>;
  const metaStats = new Map(metaRows.map((r) => [r.full_name, r]));

  const enrich = (full: string): {
    issues_total: number;
    issues_open: number;
    pulls_total: number;
    pulls_open: number;
    pulls_merged: number;
    last_activity_at: string | null;
    last_fetch_at: string | null;
  } => {
    const i = issueStats.get(full);
    const p = pullStats.get(full);
    const m = metaStats.get(full);
    const issuesActivity = i?.last_activity ?? null;
    const pullsActivity = p?.last_activity ?? null;
    const lastActivity = [issuesActivity, pullsActivity].filter(Boolean).sort().reverse()[0] ?? null;
    const lastFetch = [m?.last_issues_fetch, m?.last_pulls_fetch].filter(Boolean).sort().reverse()[0] ?? null;
    return {
      issues_total: i?.total ?? 0,
      issues_open: i?.open_count ?? 0,
      pulls_total: p?.total ?? 0,
      pulls_open: p?.open_count ?? 0,
      pulls_merged: p?.merged_count ?? 0,
      last_activity_at: lastActivity,
      last_fetch_at: lastFetch,
    };
  };

  const sn74Entries: AllReposEntry[] = Object.entries(sn74Map).map(([fullName, { weight }]) => {
    const [owner, name] = fullName.split('/');
    return { full_name: fullName, owner, name, weight, source: 'sn74', ...enrich(fullName) };
  });

  const userRows = db
    .prepare('SELECT full_name, weight, notes, added_at FROM user_repos')
    .all() as Array<{ full_name: string; weight: number; notes: string | null; added_at: string }>;

  const sn74Set = new Set(sn74Entries.map((e) => e.full_name));
  const userEntries: AllReposEntry[] = userRows
    .filter((u) => !sn74Set.has(u.full_name))
    .map((u) => {
      const [owner, name] = u.full_name.split('/');
      return {
        full_name: u.full_name,
        owner,
        name,
        weight: u.weight,
        source: 'user' as const,
        notes: u.notes,
        added_at: u.added_at,
        ...enrich(u.full_name),
      };
    });

  const all = [...sn74Entries, ...userEntries].sort((a, b) => b.weight - a.weight);

  return NextResponse.json({
    sn74_count: sn74Entries.length,
    user_count: userEntries.length,
    sn74_fetched_at: sn74FetchedAtMs > 0 ? new Date(sn74FetchedAtMs).toISOString() : null,
    sn74_source: sn74Source === 'live' ? 'github' : 'pending',
    repos: all,
  });
}
