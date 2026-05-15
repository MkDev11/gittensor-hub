import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLiveReposAsyncServer } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const repoCount = (db.prepare('SELECT COUNT(DISTINCT full_name) as c FROM repo_meta').get() as { c: number } | undefined)?.c ?? 0;
  const issueCount = (db.prepare('SELECT COUNT(*) as c FROM issues').get() as { c: number } | undefined)?.c ?? 0;
  const pullCount = (db.prepare('SELECT COUNT(*) as c FROM pulls').get() as { c: number } | undefined)?.c ?? 0;
  const lastFetch = (db
    .prepare('SELECT MAX(last_issues_fetch) as t FROM repo_meta')
    .get() as { t: string | null } | undefined)?.t ?? null;
  const errors = db
    .prepare('SELECT full_name, last_fetch_error FROM repo_meta WHERE last_fetch_error IS NOT NULL LIMIT 10')
    .all();

  // Denominator must match what the poller actually sweeps — mirror the
  // dedup in `poller.ts:getAllRepos()` so user-added SN74 repos aren't
  // double-counted.
  const { repos: liveRepos } = await getLiveReposAsyncServer();
  const sn74Names = new Set(liveRepos.map((r) => r.fullName.toLowerCase()));
  const userExtras = (db
    .prepare('SELECT full_name FROM user_repos')
    .all() as Array<{ full_name: string }>).filter((u) => !sn74Names.has(u.full_name.toLowerCase())).length;
  const reposTotal = liveRepos.length + userExtras;

  return NextResponse.json({
    repos_cached: repoCount,
    repos_total: reposTotal,
    issues_cached: issueCount,
    pulls_cached: pullCount,
    last_fetch: lastFetch,
    recent_errors: errors,
  });
}
