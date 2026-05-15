import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';

export const dynamic = 'force-dynamic';

interface BadgeRow {
  full_name: string;
  issues_count: number;
  pulls_count: number;
  owner_comments_count: number;
  issues_source: string | null;
  pulls_source: string | null;
  comments_source: string | null;
  updated_at: string;
}

interface SourceRow {
  last_issues_fetch: string | null;
  last_pulls_fetch: string | null;
  comments_source: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; name: string } },
) {
  const full = `${params.owner}/${params.name}`;
  const db = getDb();

  const source = db
    .prepare(
      `SELECT
         m.last_issues_fetch,
         m.last_pulls_fetch,
         (SELECT MAX(updated_at) FROM issue_comments WHERE repo_full_name = ?) AS comments_source
       FROM repo_meta m
       WHERE m.full_name = ?`,
    )
    .get(full, full) as SourceRow | undefined;

  const issuesSource = source?.last_issues_fetch ?? null;
  const pullsSource = source?.last_pulls_fetch ?? null;
  const commentsSource = source?.comments_source ?? null;

  const etag = buildEtag(['repo-badges-v1', full, issuesSource, pullsSource, commentsSource]);
  const cached = db
    .prepare('SELECT * FROM repo_badges WHERE full_name = ?')
    .get(full) as BadgeRow | undefined;

  if (
    cached &&
    cached.issues_source === issuesSource &&
    cached.pulls_source === pullsSource &&
    cached.comments_source === commentsSource
  ) {
    const notModified = etagNotModified(req, etag);
    if (notModified) return notModified;
    return NextResponse.json(toResponse(cached), { headers: withEtagHeaders(etag) });
  }

  const issuesCount = (db
    .prepare('SELECT COUNT(*) AS c FROM issues WHERE repo_full_name = ?')
    .get(full) as { c: number }).c;
  const pullsCount = (db
    .prepare('SELECT COUNT(*) AS c FROM pulls WHERE repo_full_name = ?')
    .get(full) as { c: number }).c;
  const ownerCommentsCount = (db
    .prepare(
      `SELECT COUNT(*) AS c FROM issue_comments
       WHERE repo_full_name = ? AND author_association = 'OWNER'`,
    )
    .get(full) as { c: number }).c;

  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO repo_badges
       (full_name, issues_count, pulls_count, owner_comments_count,
        issues_source, pulls_source, comments_source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(full_name) DO UPDATE SET
       issues_count = excluded.issues_count,
       pulls_count = excluded.pulls_count,
       owner_comments_count = excluded.owner_comments_count,
       issues_source = excluded.issues_source,
       pulls_source = excluded.pulls_source,
       comments_source = excluded.comments_source,
       updated_at = excluded.updated_at`,
  ).run(full, issuesCount, pullsCount, ownerCommentsCount, issuesSource, pullsSource, commentsSource, updatedAt);

  return NextResponse.json(
    {
      repo: full,
      issues_count: issuesCount,
      pulls_count: pullsCount,
      owner_comments_count: ownerCommentsCount,
      updated_at: updatedAt,
    },
    { headers: withEtagHeaders(etag) },
  );
}

function toResponse(row: BadgeRow) {
  return {
    repo: row.full_name,
    issues_count: row.issues_count,
    pulls_count: row.pulls_count,
    owner_comments_count: row.owner_comments_count,
    updated_at: row.updated_at,
  };
}
