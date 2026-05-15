import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, IssueRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface AggIssueRow extends IssueRow {
  repo_weight: number | null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const repoFilter = url.searchParams.get('repos');
  const repoSet = repoFilter ? new Set(repoFilter.split(',').filter(Boolean)) : null;
  // Watcher mode: caller passes `?since=ISO` to receive only newly-cached
  // issues. Filters on first_seen_at so we surface anything the poller picked
  // up after the watcher's baseline, regardless of GitHub's created_at.
  const since = url.searchParams.get('since');

  const db = getReadDb();
  const rows = since
    ? (db
        .prepare(
          `SELECT id, repo_full_name, number, title, NULL as body, state, state_reason,
                  author_login, author_association, labels, comments,
                  created_at, updated_at, closed_at, html_url, fetched_at, first_seen_at
           FROM issues
           WHERE first_seen_at > ?
           ORDER BY first_seen_at DESC
           LIMIT 200`
        )
        .all(since) as IssueRow[])
    : (db
        .prepare(
          `SELECT id, repo_full_name, number, title, NULL as body, state, state_reason,
                  author_login, author_association, labels, comments,
                  created_at, updated_at, closed_at, html_url, fetched_at, first_seen_at
           FROM issues
           ORDER BY updated_at DESC
           LIMIT 2000`
        )
        .all() as IssueRow[]);

  const filtered = repoSet ? rows.filter((r) => repoSet.has(r.repo_full_name)) : rows;

  const repoCount = new Set(filtered.map((r) => r.repo_full_name)).size;

  return NextResponse.json({
    count: filtered.length,
    repo_count: repoCount,
    issues: filtered.map((r) => ({
      ...r,
      labels: r.labels ? JSON.parse(r.labels) : [],
    })),
  });
}
