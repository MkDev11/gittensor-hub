import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';

export const dynamic = 'force-dynamic';

/**
 * Per-repo "last activity" timestamp — the most recent issue or PR
 * `updated_at` we have cached for that repo. The sidebar uses this to mark
 * inactive repos and push them to the bottom of the list.
 *
 * Cheap because it's pure SQL with `MAX()` over both indexed tables.
 */
export async function GET(req: NextRequest) {
  const db = getDb();

  // ETag — `repo_meta.last_issues_fetch + last_pulls_fetch` aggregated.
  // When the poller upserts new data anywhere, the latest fetch timestamp
  // moves and the cache invalidates.
  const cacheKey = (db
    .prepare(
      `SELECT MAX(COALESCE(last_issues_fetch, '')) || ':' || MAX(COALESCE(last_pulls_fetch, '')) AS k FROM repo_meta`,
    )
    .get() as { k: string }).k;
  const etag = buildEtag(['repo-staleness-v1', cacheKey]);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;

  const rows = db
    .prepare(
      `SELECT repo_full_name AS repo, MAX(updated_at) AS last_act FROM (
         SELECT repo_full_name, updated_at FROM issues
         UNION ALL
         SELECT repo_full_name, updated_at FROM pulls
       ) GROUP BY repo_full_name`,
    )
    .all() as Array<{ repo: string; last_act: string | null }>;

  const now = Date.now();
  const map: Record<string, { last_activity_at: string | null; days_since: number | null }> = {};
  for (const r of rows) {
    const ms = r.last_act ? new Date(r.last_act).getTime() : null;
    map[r.repo] = {
      last_activity_at: r.last_act,
      days_since: ms == null ? null : Math.floor((now - ms) / (24 * 3600_000)),
    };
  }

  return NextResponse.json({ map }, { headers: withEtagHeaders(etag) });
}
