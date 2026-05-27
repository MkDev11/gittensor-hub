import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLiveReposAsyncServer } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const { repos: liveRepos } = await getLiveReposAsyncServer();
  const liveKeys = liveRepos.map((r) => r.fullName.toLowerCase());

  if (liveKeys.length === 0) {
    return NextResponse.json({
      repos_cached: 0,
      repos_total: 0,
      issues_cached: 0,
      pulls_cached: 0,
      last_fetch: null,
      recent_errors: [],
    });
  }

  const placeholders = liveKeys.map(() => '?').join(',');
  const repoCount = (db
    .prepare(`SELECT COUNT(DISTINCT LOWER(full_name)) as c FROM repo_meta WHERE LOWER(full_name) IN (${placeholders})`)
    .get(...liveKeys) as { c: number } | undefined)?.c ?? 0;
  const issueCount = (db
    .prepare(`SELECT COUNT(DISTINCT LOWER(repo_full_name) || char(35) || number) as c FROM issues WHERE LOWER(repo_full_name) IN (${placeholders})`)
    .get(...liveKeys) as { c: number } | undefined)?.c ?? 0;
  const pullCount = (db
    .prepare(`SELECT COUNT(DISTINCT LOWER(repo_full_name) || char(35) || number) as c FROM pulls WHERE LOWER(repo_full_name) IN (${placeholders})`)
    .get(...liveKeys) as { c: number } | undefined)?.c ?? 0;
  const lastFetch = (db
    .prepare(`SELECT MAX(last_issues_fetch) as t FROM repo_meta WHERE LOWER(full_name) IN (${placeholders})`)
    .get(...liveKeys) as { t: string | null } | undefined)?.t ?? null;
  const errors = db
    .prepare(`SELECT full_name, last_fetch_error FROM repo_meta WHERE LOWER(full_name) IN (${placeholders}) AND last_fetch_error IS NOT NULL LIMIT 10`)
    .all(...liveKeys);

  return NextResponse.json({
    repos_cached: repoCount,
    repos_total: liveRepos.length,
    issues_cached: issueCount,
    pulls_cached: pullCount,
    last_fetch: lastFetch,
    recent_errors: errors,
  });
}
