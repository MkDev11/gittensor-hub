import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ActivityRow {
  repo: string;
  issues: number;
  pulls: number;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const since = url.searchParams.get('since') ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const db = getDb();

  const issueRows = db
    .prepare(
      `SELECT repo_full_name as repo, COUNT(*) as cnt
       FROM issues INDEXED BY idx_issues_seen_created_repo
       WHERE created_at > ? AND first_seen_at > ?
       GROUP BY repo_full_name`
    )
    .all(since, since) as Array<{ repo: string; cnt: number }>;

  const pullRows = db
    .prepare(
      `SELECT repo_full_name as repo, COUNT(*) as cnt
       FROM pulls INDEXED BY idx_pulls_seen_created_repo
       WHERE created_at > ? AND first_seen_at > ?
       GROUP BY repo_full_name`
    )
    .all(since, since) as Array<{ repo: string; cnt: number }>;

  const map: Record<string, ActivityRow> = {};
  for (const r of issueRows) map[r.repo] = { repo: r.repo, issues: r.cnt, pulls: 0 };
  for (const r of pullRows) {
    if (!map[r.repo]) map[r.repo] = { repo: r.repo, issues: 0, pulls: r.cnt };
    else map[r.repo].pulls = r.cnt;
  }

  return NextResponse.json({
    since,
    activity: map,
  });
}
